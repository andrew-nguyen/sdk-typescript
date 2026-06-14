import test from 'ava';
import Long from 'long';
import { NamespaceNotFoundError } from '@temporalio/common';
import { google, temporal } from '@temporalio/proto';
import {
  Client,
  CloudflareConnection,
  CloudflareServiceError,
  defaultGrpcRetryOptions,
  grpcStatus,
  isGrpcCancelledError,
  isGrpcDeadlineError,
  isGrpcServiceError,
  type CloudflareTransport,
  type CloudflareTransportRequest,
} from '@temporalio/client/cloudflare';

test('CloudflareConnection drives high-level workflow calls through a Worker-safe transport', async (t) => {
  const transport = new RecordingTransport();
  const connection = CloudflareConnection.lazy({
    transport,
    apiKey: () => 'initial-key',
    metadata: { 'x-static': 'static-value' },
  });
  const client = new Client({ connection, namespace: 'default', identity: 'cloudflare-test' });
  const abortController = new AbortController();
  const deadline = new Date(Date.now() + 5_000);

  const result = await connection.withDeadline(deadline, () =>
    connection.withAbortSignal(abortController.signal, () =>
      connection.withMetadata({ 'x-scope': 'scope-value' }, () => client.workflow.count('WorkflowType = "demo"'))
    )
  );

  t.is(result.count, 7);
  t.is(transport.requests.length, 1);

  const request = transport.requests[0]!;
  t.is(request.serviceName, 'temporal.api.workflowservice.v1.WorkflowService');
  t.is(request.methodName, 'CountWorkflowExecutions');
  t.is(request.metadata.Authorization, 'Bearer initial-key');
  t.is(request.metadata['client-name'], 'temporal-typescript');
  t.truthy(request.metadata['client-version']);
  t.is(request.metadata['x-static'], 'static-value');
  t.is(request.metadata['x-scope'], 'scope-value');
  t.is(request.metadata['temporal-namespace'], 'default');
  t.is(request.deadline, deadline);
  t.is(request.abortSignal, abortController.signal);

  const decodedRequest = temporal.api.workflowservice.v1.CountWorkflowExecutionsRequest.decode(request.request);
  t.is(decodedRequest.namespace, 'default');
  t.is(decodedRequest.query, 'WorkflowType = "demo"');
});

test('CloudflareConnection connect checks getSystemInfo and setApiKey updates later requests', async (t) => {
  const transport = new RecordingTransport();
  const connection = await CloudflareConnection.connect({
    transport,
    apiKey: 'first-key',
  });
  const client = new Client({ connection, namespace: 'default', identity: 'cloudflare-test' });

  t.is(transport.requests.length, 1);
  t.is(transport.requests[0]?.methodName, 'GetSystemInfo');
  t.is(transport.requests[0]?.metadata.Authorization, 'Bearer first-key');

  await connection.ensureConnected();
  t.is(transport.requests.length, 1);

  connection.setApiKey('second-key');
  await client.workflow.count();

  t.is(transport.requests.length, 2);
  t.is(transport.requests[1]?.metadata.Authorization, 'Bearer second-key');
});

test('CloudflareConnection retries retryable service errors with the shared retry policy', async (t) => {
  const transport = new RecordingTransport();
  transport.failures.push(
    new CloudflareServiceError('unavailable', {
      code: grpcStatus.UNAVAILABLE,
      details: 'temporarily unavailable',
    })
  );
  const connection = CloudflareConnection.lazy({
    transport,
    retry: defaultGrpcRetryOptions({
      factor: 1,
      initialIntervalMs: () => 0,
      maxAttempts: 2,
      maxIntervalMs: () => 0,
      maxJitter: 0,
    }),
  });
  const client = new Client({ connection, namespace: 'default', identity: 'cloudflare-test' });

  const result = await client.workflow.count();

  t.is(result.count, 7);
  t.is(transport.requests.length, 2);
});

test('CloudflareConnection maps in-flight aborts to cancelled grpc service errors', async (t) => {
  const transport = new AbortRejectingTransport();
  const connection = CloudflareConnection.lazy({ transport, retry: false });
  const client = new Client({ connection, namespace: 'default', identity: 'cloudflare-test' });
  const abortController = new AbortController();

  const result = client.withAbortSignal(abortController.signal, () => client.workflow.count());
  abortController.abort();
  const err = await t.throwsAsync(result);

  t.true(isGrpcCancelledError(err));
});

test('Cloudflare service errors satisfy grpc service error helpers', (t) => {
  const deadline = new CloudflareServiceError('deadline', {
    code: grpcStatus.DEADLINE_EXCEEDED,
    details: 'deadline exceeded',
  });
  const cancelled = new CloudflareServiceError('cancelled', {
    code: grpcStatus.CANCELLED,
    details: 'cancelled',
  });

  t.true(isGrpcServiceError(deadline));
  t.true(isGrpcDeadlineError(deadline));
  t.false(isGrpcCancelledError(deadline));
  t.true(isGrpcServiceError(cancelled));
  t.true(isGrpcCancelledError(cancelled));
});

test('Cloudflare service errors preserve grpc status details for known error mapping', async (t) => {
  const connection = CloudflareConnection.lazy({
    transport: new NamespaceNotFoundTransport(),
    retry: false,
  });
  const client = new Client({ connection, namespace: 'missing-namespace', identity: 'cloudflare-test' });

  const err = await t.throwsAsync(client.workflow.count());

  t.true(err instanceof NamespaceNotFoundError);
});

class RecordingTransport implements CloudflareTransport {
  public readonly requests: CloudflareTransportRequest[] = [];
  public readonly failures: Error[] = [];

  async invoke(request: CloudflareTransportRequest): Promise<Uint8Array> {
    this.requests.push(request);
    const failure = this.failures.shift();
    if (failure != null) {
      throw failure;
    }

    if (
      request.serviceName === 'temporal.api.workflowservice.v1.WorkflowService' &&
      request.methodName === 'GetSystemInfo'
    ) {
      return temporal.api.workflowservice.v1.GetSystemInfoResponse.encode({}).finish();
    }

    if (
      request.serviceName === 'temporal.api.workflowservice.v1.WorkflowService' &&
      request.methodName === 'CountWorkflowExecutions'
    ) {
      return temporal.api.workflowservice.v1.CountWorkflowExecutionsResponse.encode({
        count: Long.fromNumber(7),
        groups: [],
      }).finish();
    }

    throw new Error(`Unexpected RPC ${request.serviceName}/${request.methodName}`);
  }
}

class AbortRejectingTransport implements CloudflareTransport {
  async invoke(request: CloudflareTransportRequest): Promise<Uint8Array> {
    return await new Promise((_resolve, reject) => {
      request.abortSignal?.addEventListener('abort', () => reject(new Error('fetch aborted')), { once: true });
    });
  }
}

class NamespaceNotFoundTransport implements CloudflareTransport {
  async invoke(): Promise<Uint8Array> {
    const detail = temporal.api.errordetails.v1.NamespaceNotFoundFailure.encode({
      namespace: 'missing-namespace',
    }).finish();
    const statusDetails = google.rpc.Status.encode({
      code: grpcStatus.NOT_FOUND,
      message: 'namespace not found',
      details: [
        {
          type_url: 'type.googleapis.com/temporal.api.errordetails.v1.NamespaceNotFoundFailure',
          value: detail,
        },
      ],
    }).finish();

    throw new CloudflareServiceError('namespace not found', {
      code: grpcStatus.NOT_FOUND,
      details: 'namespace not found',
      metadata: { 'grpc-status-details-bin': Buffer.from(statusDetails) },
    });
  }
}
