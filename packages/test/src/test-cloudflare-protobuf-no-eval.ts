import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test, { type ExecutionContext } from 'ava';

const projectRoot = path.resolve(__dirname, '../../..');
const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));
const builtinModuleNames = new Set([...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)]);

test.serial('client-facing proto facade preserves protobufjs-compatible exports', async (t) => {
  clearCloudflareTargetModuleCache();

  const protoStar = (await import('@temporalio/proto')) as any;
  const protoDefault = protoStar.default;

  for (const root of [protoStar, protoDefault]) {
    t.truthy(root.temporal);
    t.truthy(root.google);
    t.truthy(root.grpc);
    t.truthy(root.coresdk);
  }

  assertMessageStatics(t, protoDefault.temporal.api.common.v1.Payload, {
    metadata: { encoding: Buffer.from('json/plain') },
    data: Buffer.from('hello'),
  });
  assertMessageStatics(t, protoDefault.temporal.api.history.v1.History, { events: [] });
  assertMessageStatics(t, protoDefault.temporal.api.workflowservice.v1.StartWorkflowExecutionRequest, {
    namespace: 'default',
    workflowId: 'workflow-id',
  });
  assertMessageStatics(t, protoDefault.google.rpc.Status, { code: 0, message: 'ok' });

  await assertUnaryService(t, {
    service: protoDefault.temporal.api.workflowservice.v1.WorkflowService,
    methodName: 'getSystemInfo',
    expectedProtoMethodName: 'GetSystemInfo',
    requestType: protoDefault.temporal.api.workflowservice.v1.GetSystemInfoRequest,
    request: {},
    responseType: protoDefault.temporal.api.workflowservice.v1.GetSystemInfoResponse,
    response: {},
  });
  await assertUnaryService(t, {
    service: protoDefault.temporal.api.operatorservice.v1.OperatorService,
    methodName: 'addSearchAttributes',
    expectedProtoMethodName: 'AddSearchAttributes',
    requestType: protoDefault.temporal.api.operatorservice.v1.AddSearchAttributesRequest,
    request: { namespace: 'default' },
    responseType: protoDefault.temporal.api.operatorservice.v1.AddSearchAttributesResponse,
    response: {},
  });
  await assertUnaryService(t, {
    service: protoDefault.temporal.api.testservice.v1.TestService,
    methodName: 'getCurrentTime',
    expectedProtoMethodName: 'GetCurrentTime',
    requestType: protoDefault.google.protobuf.Empty,
    request: {},
    responseType: protoDefault.temporal.api.testservice.v1.GetCurrentTimeResponse,
    response: {},
  });
  await assertUnaryService(t, {
    service: protoDefault.temporal.api.cloud.cloudservice.v1.CloudService,
    methodName: 'getNamespace',
    expectedProtoMethodName: 'GetNamespace',
    requestType: protoDefault.temporal.api.cloud.cloudservice.v1.GetNamespaceRequest,
    request: { namespace: 'default' },
    responseType: protoDefault.temporal.api.cloud.cloudservice.v1.GetNamespaceResponse,
    response: {},
  });
  await assertUnaryService(t, {
    service: protoDefault.grpc.health.v1.Health,
    methodName: 'check',
    expectedProtoMethodName: 'Check',
    requestType: protoDefault.grpc.health.v1.HealthCheckRequest,
    request: { service: 'temporal.api.workflowservice.v1.WorkflowService' },
    responseType: protoDefault.grpc.health.v1.HealthCheckResponse,
    response: {},
  });
});

test.serial('Cloudflare-targeted protobuf paths do not use string code generation', (t) => {
  clearCloudflareTargetModuleCache();

  const load = createRestrictedCommonJsLoader();
  const proto = load('@temporalio/proto');
  const protoUtils = load('@temporalio/common/lib/proto-utils');
  const protobufs = load('@temporalio/common/lib/protobufs');
  const cloud = load('@temporalio/cloud');

  const payload = proto.temporal.api.common.v1.Payload.create({
    metadata: { encoding: Buffer.from('json/plain') },
    data: Buffer.from('hello'),
  });
  const encoded = proto.temporal.api.common.v1.Payload.encode(payload).finish();
  const decoded = proto.temporal.api.common.v1.Payload.decode(encoded);
  t.is(Buffer.from(decoded.data).toString(), 'hello');

  const payloadJson = protoUtils.payloadToJSON(payload);
  const roundTrippedPayload = protoUtils.JSONToPayload(payloadJson);
  t.is(Buffer.from(roundTrippedPayload.data).toString(), 'hello');

  t.is(typeof protobufs.ProtobufJsonPayloadConverter, 'function');
  t.is(typeof protobufs.ProtobufBinaryPayloadConverter, 'function');
  t.is(typeof protobufs.DefaultPayloadConverterWithProtobufs, 'function');
  t.truthy(cloud.CloudOperationsClient);
  t.truthy(cloud.CloudOperationsConnection);
});

test('Cloudflare-targeted source and build outputs do not contain dynamic codegen patterns', (t) => {
  const violations = scanDynamicCodegenViolations([
    'packages/proto/protos',
    'packages/proto/lib',
    'packages/common/src/proto-utils.ts',
    'packages/common/src/converter/protobuf-payload-converters.ts',
    'packages/common/lib',
    'packages/client/lib',
    'packages/cloud/lib',
  ]);

  t.deepEqual(violations, []);
});

function assertMessageStatics(t: ExecutionContext, messageType: any, value: Record<string, unknown>): void {
  for (const staticMethod of ['create', 'encode', 'decode', 'fromObject', 'toObject']) {
    t.is(typeof messageType[staticMethod], 'function');
  }

  const message = messageType.create(value);
  const fromObject = messageType.fromObject(messageType.toObject(message, { bytes: String, longs: String }));
  const encoded = messageType.encode(fromObject).finish();
  const decoded = messageType.decode(encoded);
  t.deepEqual(
    messageType.toObject(decoded, { bytes: String, longs: String }),
    messageType.toObject(fromObject, { bytes: String, longs: String })
  );
}

async function assertUnaryService(
  t: ExecutionContext,
  options: {
    service: any;
    methodName: string;
    expectedProtoMethodName: string;
    requestType: any;
    request: Record<string, unknown>;
    responseType: any;
    response: Record<string, unknown>;
  }
): Promise<void> {
  t.is(typeof options.service.create, 'function');

  let seenCall: { methodName: string; requestData: Uint8Array } | undefined;
  const request = options.requestType.create(options.request);
  const response = options.responseType.create(options.response);
  const service = options.service.create(
    (method: { name: string }, requestData: Uint8Array, callback: Function) => {
      seenCall = { methodName: method.name, requestData };
      callback(null, options.responseType.encode(response).finish());
    },
    false,
    false
  );

  t.is(typeof service[options.methodName], 'function');
  t.true(Object.prototype.propertyIsEnumerable.call(service, options.methodName));

  const result = await service[options.methodName](request);
  t.truthy(seenCall);
  t.is(seenCall?.methodName, options.expectedProtoMethodName);
  t.deepEqual(
    options.requestType.toObject(options.requestType.decode(seenCall!.requestData), { longs: String, bytes: String }),
    options.requestType.toObject(request, { longs: String, bytes: String })
  );
  t.deepEqual(
    options.responseType.toObject(result, { longs: String, bytes: String }),
    options.responseType.toObject(response, { longs: String, bytes: String })
  );
}

function createRestrictedCommonJsLoader(): (request: string) => any {
  const blockedCodeGeneration = () => {
    throw new EvalError('String code generation is disabled for this Cloudflare-style smoke test');
  };
  const context = vm.createContext(
    {
      AbortController,
      AbortSignal,
      ArrayBuffer,
      Buffer,
      DataView,
      Error,
      EvalError,
      Function: blockedCodeGeneration,
      Promise,
      TextDecoder,
      TextEncoder,
      Uint8Array,
      URL,
      URLSearchParams,
      clearImmediate,
      clearInterval,
      clearTimeout,
      console,
      constructor: { constructor: blockedCodeGeneration },
      eval: blockedCodeGeneration,
      process,
      queueMicrotask,
      setImmediate,
      setInterval,
      setTimeout,
    },
    {
      codeGeneration: { strings: false, wasm: false },
      name: 'cloudflare-protobuf-no-eval',
    }
  );
  (context as any).global = context;
  (context as any).globalThis = context;

  const moduleCache = new Map<string, { exports: any }>();

  const load = (
    request: string,
    parentFilename = path.join(projectRoot, 'packages/test/lib/no-eval-entry.js')
  ): any => {
    if (builtinModuleNames.has(request)) {
      return require(request);
    }

    const resolved = createRequire(parentFilename).resolve(request);
    if (resolved.endsWith('.node')) {
      return require(resolved);
    }
    if (moduleCache.has(resolved)) {
      return moduleCache.get(resolved)!.exports;
    }

    const module = {
      exports: {},
      filename: resolved,
      id: resolved,
      loaded: false,
      require: undefined as unknown,
    };
    moduleCache.set(resolved, module);

    if (resolved.endsWith('.json')) {
      module.exports = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      module.loaded = true;
      return module.exports;
    }

    const dirname = path.dirname(resolved);
    const localRequire = (childRequest: string) => load(childRequest, resolved);
    localRequire.resolve = (childRequest: string) => {
      if (builtinModuleNames.has(childRequest)) {
        return childRequest;
      }
      return createRequire(resolved).resolve(childRequest);
    };
    module.require = localRequire;

    const source = fs.readFileSync(resolved, 'utf8');
    const wrappedSource = `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`;
    const script = new vm.Script(wrappedSource, { filename: resolved });
    const compiledModule = script.runInContext(context);
    compiledModule(module.exports, localRequire, module, resolved, dirname);
    module.loaded = true;

    return module.exports;
  };

  return (request: string) => load(request);
}

function scanDynamicCodegenViolations(relativeTargets: string[]): string[] {
  const runtimeFiles = relativeTargets.flatMap((relativeTarget) =>
    listRuntimeFiles(path.join(projectRoot, relativeTarget)).map((filename) => path.relative(projectRoot, filename))
  );
  const patterns = [
    { name: 'eval(', regex: /\beval\s*\(/ },
    { name: 'new Function', regex: /\bnew\s+Function\b/ },
    { name: 'Function(', regex: /(^|[^\w$.])Function\s*\(/ },
    { name: 'constructor.constructor', regex: /constructor\s*\.\s*constructor/ },
    { name: 'protobufjs/light reflection runtime', regex: /protobufjs\/light/ },
    { name: '@protobufjs/codegen runtime', regex: /@protobufjs\/codegen/ },
  ];

  const violations: string[] = [];
  for (const relativeFile of runtimeFiles) {
    const absoluteFile = path.join(projectRoot, relativeFile);
    const content = fs.readFileSync(absoluteFile, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const { name, regex } of patterns) {
      lines.forEach((line, index) => {
        if (regex.test(line)) {
          violations.push(`${relativeFile}:${index + 1}: ${name}: ${line.trim()}`);
        }
      });
    }
  }

  return violations;
}

function listRuntimeFiles(target: string): string[] {
  if (!fs.existsSync(target)) {
    return [];
  }

  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return isRuntimeFile(target) ? [target] : [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRuntimeFiles(entryPath));
    } else if (entry.isFile() && isRuntimeFile(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

function isRuntimeFile(filename: string): boolean {
  return /\.(?:cjs|mjs|js|ts)$/.test(filename) && !filename.endsWith('.d.ts') && !filename.endsWith('.js.map');
}

function clearCloudflareTargetModuleCache(): void {
  for (const filename of Object.keys(require.cache)) {
    if (
      filename.includes(`${path.sep}packages${path.sep}proto${path.sep}`) ||
      filename.includes(`${path.sep}packages${path.sep}common${path.sep}`) ||
      filename.includes(`${path.sep}packages${path.sep}client${path.sep}`) ||
      filename.includes(`${path.sep}packages${path.sep}cloud${path.sep}`) ||
      filename.includes(`${path.sep}node_modules${path.sep}.pnpm${path.sep}protobufjs`) ||
      filename.includes(`${path.sep}node_modules${path.sep}.pnpm${path.sep}@protobufjs`) ||
      filename.includes(`${path.sep}node_modules${path.sep}.pnpm${path.sep}proto3-json-serializer`)
    ) {
      delete require.cache[filename];
    }
  }
}
