import { AsyncLocalStorage } from 'node:async_hooks';
import type * as proto from 'protobufjs';
import type { TLSConfig } from '@temporalio/common/lib/internal-non-workflow';
import { filterNullAndUndefined } from '@temporalio/common/lib/internal-workflow';
import type { Duration } from '@temporalio/common/lib/time';
import { msOptionalToNumber } from '@temporalio/common/lib/time';
import { isGrpcServiceError, ServiceError, type GrpcServiceError, type ServiceErrorMetadata } from './errors';
import { defaultGrpcRetryOptions, isRetryableError, type GrpcRetryOptions } from './grpc-retry-policy';
import { grpcStatus } from './grpc-status';
import type { CallContext, Metadata, MetadataValue } from './types';
import type { HealthService, OperatorService, TestService, WorkflowService } from './types';
import {
  addDefaultClientMetadata,
  type ConnectionPlugin,
  createTemporalServiceStubs,
  makeApiKeyFnRef,
  mergeRpcMetadata,
  setApiKeyFnRef,
  withNamespaceHeaderInjector,
} from './connection-shared';

export interface CloudflareTransportRequest {
  serviceName: string;
  methodName: string;
  request: Uint8Array;
  metadata: Metadata;
  deadline?: number | Date;
  abortSignal?: AbortSignal;
}

export interface CloudflareTransport {
  invoke(request: CloudflareTransportRequest): Promise<Uint8Array>;
  close?(): Promise<void> | void;
}

export interface CloudflareConnectionOptions {
  /**
   * Temporal target address for the bridge to reach, in `hostname:port` form.
   */
  address?: string;

  /**
   * Temporal target TLS mode for the bridge to use.
   *
   * Custom TLS objects are forwarded only as a signal that TLS is required; client certificates are not supported by
   * the Worker bridge transport.
   */
  tls?: TLSConfig | boolean | null;

  /**
   * HTTPS endpoint that accepts the Cloudflare bridge envelope.
   */
  bridgeUrl?: string | URL;

  /**
   * Optional custom transport for tests or non-standard bridge deployments.
   */
  transport?: CloudflareTransport;

  /**
   * Optional fetch implementation. Defaults to global fetch.
   */
  fetch?: typeof fetch;

  /**
   * Extra headers to send to the bridge endpoint.
   */
  bridgeHeaders?: Record<string, string>;

  /**
   * Optional mapping of gRPC metadata to send with each request to the server.
   * Setting the `Authorization` header is mutually exclusive with the {@link apiKey} option.
   */
  metadata?: Metadata;

  /**
   * API key for Temporal. This becomes the "Authorization" metadata value with "Bearer " prepended.
   */
  apiKey?: string | (() => string);

  /**
   * Milliseconds to wait until establishing a connection with the server.
   */
  connectTimeout?: Duration;

  /**
   * Retry policy for unary RPCs. Pass false to disable retries.
   */
  retry?: GrpcRetryOptions | false;

  /**
   * Plugins registered with clients built from this connection.
   */
  plugins?: ConnectionPlugin[];

  /**
   * Expose the test service on this connection.
   *
   * @internal
   */
  supportsTestService?: boolean;
}

export interface CloudflareBridgeTransportOptions {
  bridgeUrl: string | URL;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  target?: {
    address?: string;
    tls?: TLSConfig | boolean | null;
  };
}

interface CloudflareConnectionOptionsWithDefaults {
  transport: CloudflareTransport;
  metadata: Metadata;
  connectTimeoutMs: number;
  plugins: ConnectionPlugin[];
  retry?: GrpcRetryOptions;
  supportsTestService?: boolean;
}

interface CloudflareConnectionCtorOptions {
  readonly options: CloudflareConnectionOptionsWithDefaults;
  readonly workflowService: WorkflowService;
  readonly operatorService: OperatorService;
  readonly testService: TestService | undefined;
  readonly healthService: HealthService;
  readonly callContextStorage: AsyncLocalStorage<CallContext>;
  readonly apiKeyFnRef: { fn?: () => string };
}

export class CloudflareServiceErrorMetadata implements ServiceErrorMetadata {
  private readonly values = new Map<string, MetadataValue[]>();

  constructor(metadata: Record<string, MetadataValue | MetadataValue[]> = {}) {
    for (const [key, value] of Object.entries(metadata)) {
      this.set(key, value);
    }
  }

  get(key: string): MetadataValue[] {
    return this.values.get(key.toLowerCase()) ?? [];
  }

  set(key: string, value: MetadataValue | MetadataValue[]): void {
    this.values.set(key.toLowerCase(), Array.isArray(value) ? value : [value]);
  }

  toObject(): Record<string, MetadataValue[]> {
    return Object.fromEntries(this.values);
  }
}

export class CloudflareServiceError extends Error implements GrpcServiceError {
  public readonly code: grpcStatus;
  public readonly details: string;
  public readonly metadata: CloudflareServiceErrorMetadata;

  constructor(
    message: string,
    options: {
      code: grpcStatus;
      details?: string;
      metadata?: CloudflareServiceErrorMetadata | Record<string, MetadataValue | MetadataValue[]>;
    }
  ) {
    super(message);
    this.code = options.code;
    this.details = options.details ?? message;
    this.metadata =
      options.metadata instanceof CloudflareServiceErrorMetadata
        ? options.metadata
        : new CloudflareServiceErrorMetadata(options.metadata);
  }
}

export class CloudflareBridgeTransport implements CloudflareTransport {
  private readonly bridgeUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly headers: Record<string, string>;
  private readonly target: CloudflareBridgeTransportOptions['target'];

  constructor(options: CloudflareBridgeTransportOptions) {
    this.bridgeUrl = options.bridgeUrl.toString();
    this.fetchFn = options.fetch ?? globalThis.fetch;
    if (this.fetchFn == null) {
      throw new TypeError('CloudflareBridgeTransport requires a fetch implementation');
    }
    this.headers = options.headers ?? {};
    this.target = options.target;
  }

  async invoke(request: CloudflareTransportRequest): Promise<Uint8Array> {
    const response = await this.fetchFn(this.bridgeUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify({
        version: 1,
        serviceName: request.serviceName,
        methodName: request.methodName,
        request: bytesToBase64(request.request),
        metadata: encodeMetadata(request.metadata),
        deadline: request.deadline instanceof Date ? request.deadline.toISOString() : request.deadline,
        target: this.target
          ? {
              address: this.target.address,
              tls: this.target.tls == null ? this.target.tls : Boolean(this.target.tls),
            }
          : undefined,
      }),
      signal: request.abortSignal,
    });

    const payload = (await response.json().catch(() => undefined)) as CloudflareBridgeResponse | undefined;
    if (!response.ok || payload?.error != null) {
      throw errorFromBridgeResponse(response.status, payload);
    }
    if (typeof payload?.response !== 'string') {
      throw new CloudflareServiceError('Bridge response did not include protobuf response bytes', {
        code: grpcStatus.INTERNAL,
        details: 'Malformed bridge response',
      });
    }
    return base64ToBytes(payload.response);
  }
}

export class CloudflareConnection {
  public readonly options: CloudflareConnectionOptionsWithDefaults;

  /**
   * Used to ensure `ensureConnected` is called once.
   */
  protected connectPromise?: Promise<void>;

  public readonly workflowService: WorkflowService;
  public readonly operatorService: OperatorService;
  public readonly testService: TestService | undefined;
  public readonly healthService: HealthService;
  public readonly plugins: ConnectionPlugin[];

  readonly callContextStorage: AsyncLocalStorage<CallContext>;
  private readonly apiKeyFnRef: { fn?: () => string };

  protected static createCtorOptions(options: CloudflareConnectionOptions): CloudflareConnectionCtorOptions {
    if (options.apiKey) {
      if (options.metadata?.Authorization) {
        throw new TypeError(
          'Both `apiKey` option and `Authorization` header were provided, but only one makes sense to use at a time.'
        );
      }
    }
    const apiKeyFnRef = makeApiKeyFnRef(options.apiKey);

    const optionsWithDefaults = addDefaults(options);
    addDefaultClientMetadata(optionsWithDefaults.metadata);

    const callContextStorage = new AsyncLocalStorage<CallContext>();
    const services = createTemporalServiceStubs(
      (serviceName) =>
        this.generateRPCImplementation({
          serviceName,
          callContextStorage,
          staticMetadata: optionsWithDefaults.metadata,
          apiKeyFnRef,
          transport: optionsWithDefaults.transport,
          retry: optionsWithDefaults.retry,
        }),
      { supportsTestService: optionsWithDefaults.supportsTestService }
    );

    return {
      callContextStorage,
      ...services,
      options: optionsWithDefaults,
      apiKeyFnRef,
    };
  }

  static lazy(options: CloudflareConnectionOptions): CloudflareConnection {
    return new this(this.createCtorOptions(options));
  }

  static async connect(options: CloudflareConnectionOptions): Promise<CloudflareConnection> {
    const conn = this.lazy(options);
    await conn.ensureConnected();
    return conn;
  }

  protected constructor({
    options,
    workflowService,
    operatorService,
    testService,
    healthService,
    callContextStorage,
    apiKeyFnRef,
  }: CloudflareConnectionCtorOptions) {
    this.options = options;
    this.workflowService = withNamespaceHeaderInjector(workflowService, (metadata, fn) => this.withMetadata(metadata, fn));
    this.operatorService = operatorService;
    this.testService = testService;
    this.healthService = healthService;
    this.callContextStorage = callContextStorage;
    this.apiKeyFnRef = apiKeyFnRef;
    this.plugins = options.plugins ?? [];
  }

  async ensureConnected(): Promise<void> {
    if (this.connectPromise == null) {
      const deadline = Date.now() + this.options.connectTimeoutMs;
      this.connectPromise = (async () => {
        try {
          await this.withDeadline(deadline, () => this.workflowService.getSystemInfo({}));
        } catch (err) {
          if (isGrpcServiceError(err)) {
            // Ignore old servers.
            if (err.code !== grpcStatus.UNIMPLEMENTED) {
              throw new ServiceError('Failed to connect to Temporal server', { cause: err });
            }
          } else {
            throw err;
          }
        }
      })();
    }
    return this.connectPromise;
  }

  async withDeadline<ReturnType>(deadline: number | Date, fn: () => Promise<ReturnType>): Promise<ReturnType> {
    const cc = this.callContextStorage.getStore();
    return await this.callContextStorage.run({ ...cc, deadline }, fn);
  }

  async withAbortSignal<ReturnType>(abortSignal: AbortSignal, fn: () => Promise<ReturnType>): Promise<ReturnType> {
    const cc = this.callContextStorage.getStore();
    return await this.callContextStorage.run({ ...cc, abortSignal }, fn);
  }

  async withMetadata<ReturnType>(metadata: Metadata, fn: () => Promise<ReturnType>): Promise<ReturnType> {
    const cc = this.callContextStorage.getStore();
    return await this.callContextStorage.run(
      {
        ...cc,
        metadata: { ...cc?.metadata, ...metadata },
      },
      fn
    );
  }

  async withApiKey<ReturnType>(apiKey: string, fn: () => Promise<ReturnType>): Promise<ReturnType> {
    return await this.withMetadata({ Authorization: `Bearer ${apiKey}` }, fn);
  }

  setApiKey(apiKey: string | (() => string)): void {
    setApiKeyFnRef(this.apiKeyFnRef, apiKey);
  }

  public async close(): Promise<void> {
    await this.options.transport.close?.();
    this.callContextStorage.disable();
  }

  protected static generateRPCImplementation({
    serviceName,
    callContextStorage,
    staticMetadata,
    apiKeyFnRef,
    transport,
    retry,
  }: {
    serviceName: string;
    callContextStorage: AsyncLocalStorage<CallContext>;
    staticMetadata: Metadata;
    apiKeyFnRef: { fn?: () => string };
    transport: CloudflareTransport;
    retry?: GrpcRetryOptions;
  }): proto.RPCImpl {
    return (method: proto.Method | proto.rpc.ServiceMethod<proto.Message<any>, proto.Message<any>>, requestData, callback) => {
      const { metadata, deadline, abortSignal } = callContextStorage.getStore() ?? {};
      const requestMetadata = mergeRpcMetadata(staticMetadata, metadata, apiKeyFnRef);

      void invokeWithRetry(
        transport,
        {
          serviceName,
          methodName: method.name,
          request: requestData,
          metadata: requestMetadata,
          deadline,
          abortSignal,
        },
        retry
      ).then(
        (response) => callback(null, response),
        (err) => callback(err as Error)
      );
    };
  }

}

async function invokeWithRetry(
  transport: CloudflareTransport,
  request: CloudflareTransportRequest,
  retry?: GrpcRetryOptions
): Promise<Uint8Array> {
  let attempt = 1;
  for (;;) {
    throwIfAborted(request.abortSignal);
    try {
      return await transport.invoke(request);
    } catch (err) {
      if (request.abortSignal?.aborted) {
        throw cancelledServiceError();
      }
      if (retry == null || !isGrpcServiceError(err) || !isRetryableError(err) || !retry.retryableDecider(attempt, err)) {
        throw err;
      }
      await sleep(retry.delayFunction(attempt, err), request.abortSignal);
      attempt++;
    }
  }
}

function addDefaults(options: CloudflareConnectionOptions): CloudflareConnectionOptionsWithDefaults {
  const { bridgeUrl, transport, connectTimeout, retry, fetch, bridgeHeaders, address, tls, ...rest } = options;
  return {
    transport:
      transport ??
      new CloudflareBridgeTransport({
        bridgeUrl: requiredBridgeUrl(bridgeUrl),
        fetch,
        headers: bridgeHeaders,
        target: { address, tls },
      }),
    metadata: {},
    connectTimeoutMs: msOptionalToNumber(connectTimeout) ?? 10_000,
    plugins: [],
    retry: retry === false ? undefined : retry ?? defaultGrpcRetryOptions(),
    ...filterNullAndUndefined(rest),
  };
}

function requiredBridgeUrl(bridgeUrl: string | URL | undefined): string | URL {
  if (bridgeUrl == null) {
    throw new TypeError('CloudflareConnection requires either `transport` or `bridgeUrl`');
  }
  return bridgeUrl;
}

function throwIfAborted(abortSignal: AbortSignal | undefined): void {
  if (abortSignal?.aborted) {
    throw cancelledServiceError();
  }
}

function sleep(ms: number, abortSignal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(abortSignal);
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    abortSignal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(cancelledServiceError());
      },
      { once: true }
    );
  });
}

function cancelledServiceError(): CloudflareServiceError {
  return new CloudflareServiceError('The operation was cancelled', {
    code: grpcStatus.CANCELLED,
    details: 'Cancelled',
  });
}

function encodeMetadata(metadata: Metadata): CloudflareBridgeMetadataEntry[] {
  return Object.entries(metadata).map(([key, value]) =>
    typeof value === 'string' ? { key, value } : { key, value: bytesToBase64(value), binary: true }
  );
}

function decodeMetadata(entries: CloudflareBridgeMetadataEntry[] | undefined): Record<string, MetadataValue[]> {
  const metadata: Record<string, MetadataValue[]> = {};
  for (const entry of entries ?? []) {
    metadata[entry.key] = [entry.binary ? Buffer.from(entry.value, 'base64') : entry.value];
  }
  return metadata;
}

function errorFromBridgeResponse(statusCode: number, payload: CloudflareBridgeResponse | undefined): CloudflareServiceError {
  const error = payload?.error;
  return new CloudflareServiceError(error?.message ?? `Bridge request failed with HTTP ${statusCode}`, {
    code: error?.code ?? grpcStatus.UNAVAILABLE,
    details: error?.details ?? error?.message ?? `HTTP ${statusCode}`,
    metadata: decodeMetadata(error?.metadata),
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

interface CloudflareBridgeMetadataEntry {
  key: string;
  value: string;
  binary?: boolean;
}

interface CloudflareBridgeResponse {
  response?: string;
  error?: {
    code?: grpcStatus;
    message?: string;
    details?: string;
    metadata?: CloudflareBridgeMetadataEntry[];
  };
}
