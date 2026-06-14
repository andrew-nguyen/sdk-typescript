import type * as proto from 'protobufjs';
import { type temporal } from '@temporalio/proto';
import pkg from './pkg';
import type { Metadata } from './types';
import { HealthService, OperatorService, TestService, WorkflowService } from './types';

export interface ApiKeyFnRef {
  fn?: () => string;
}

export interface TemporalServiceStubs {
  workflowService: WorkflowService;
  operatorService: OperatorService;
  testService: TestService | undefined;
  healthService: HealthService;
}

/**
 * Plugin to control connection configuration.
 *
 * @experimental Plugins is an experimental feature; APIs may change without notice.
 */
export interface ConnectionPlugin<Options = unknown> {
  /**
   * Gets the name of this plugin.
   */
  get name(): string;

  /**
   * Hook called when creating a connection to allow modification of configuration.
   */
  configureConnection?(options: Options): Options;
}

export function makeApiKeyFnRef(apiKey: string | (() => string) | undefined): ApiKeyFnRef {
  const apiKeyFnRef: ApiKeyFnRef = {};
  setApiKeyFnRef(apiKeyFnRef, apiKey);
  return apiKeyFnRef;
}

export function setApiKeyFnRef(apiKeyFnRef: ApiKeyFnRef, apiKey: string | (() => string) | undefined): void {
  if (apiKey == null) {
    return;
  }
  if (typeof apiKey === 'string') {
    if (apiKey === '') {
      throw new TypeError('`apiKey` must not be an empty string');
    }
    apiKeyFnRef.fn = () => apiKey;
  } else {
    apiKeyFnRef.fn = apiKey;
  }
}

export function addDefaultClientMetadata(metadata: Metadata): void {
  metadata['client-name'] ??= 'temporal-typescript';
  metadata['client-version'] ??= pkg.version;
}

export function mergeRpcMetadata(
  staticMetadata: Metadata,
  scopedMetadata: Metadata | undefined,
  apiKeyFnRef: ApiKeyFnRef
): Metadata {
  const merged: Metadata = {};
  if (apiKeyFnRef.fn) {
    const apiKey = apiKeyFnRef.fn();
    if (apiKey) merged.Authorization = `Bearer ${apiKey}`;
  }
  Object.assign(merged, staticMetadata);
  if (scopedMetadata != null) {
    Object.assign(merged, scopedMetadata);
  }
  return merged;
}

export function createTemporalServiceStubs(
  createRpcImpl: (serviceName: string) => proto.RPCImpl,
  options: { supportsTestService?: boolean } = {}
): TemporalServiceStubs {
  return {
    workflowService: WorkflowService.create(
      createRpcImpl('temporal.api.workflowservice.v1.WorkflowService'),
      false,
      false
    ),
    operatorService: OperatorService.create(
      createRpcImpl('temporal.api.operatorservice.v1.OperatorService'),
      false,
      false
    ),
    testService: options.supportsTestService
      ? TestService.create(createRpcImpl('temporal.api.testservice.v1.TestService'), false, false)
      : undefined,
    healthService: HealthService.create(createRpcImpl('grpc.health.v1.Health'), false, false),
  };
}

export function withNamespaceHeaderInjector(
  workflowService: temporal.api.workflowservice.v1.WorkflowService,
  withMetadata: <ReturnType>(metadata: Metadata, fn: () => Promise<ReturnType>) => Promise<ReturnType>
): temporal.api.workflowservice.v1.WorkflowService {
  const wrapper: any = {};

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  for (const [methodName, methodImpl] of Object.entries(workflowService) as [string, Function][]) {
    if (typeof methodImpl !== 'function') continue;

    wrapper[methodName] = (...args: any[]) => {
      const namespace = args[0]?.namespace;
      if (namespace) {
        return withMetadata({ 'temporal-namespace': namespace }, () => methodImpl.apply(workflowService, args));
      } else {
        return methodImpl.apply(workflowService, args);
      }
    };
  }
  return wrapper as WorkflowService;
}
