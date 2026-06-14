import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'ava';

const projectRoot = path.resolve(__dirname, '../../..');
const builtinModuleNames = new Set([...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)]);

test.serial('Cloudflare client subpath imports without Node gRPC transport modules', (t) => {
  const loadedRequests: string[] = [];
  const load = createRestrictedCommonJsLoader(loadedRequests);

  const client = load('@temporalio/client/cloudflare');

  t.is(typeof client.Client, 'function');
  t.is(typeof client.WorkflowClient, 'function');
  t.is(typeof client.CloudflareConnection, 'function');
  t.is(typeof client.CloudflareBridgeTransport, 'function');
  t.is(typeof client.defaultGrpcRetryOptions, 'function');
  t.false(loadedRequests.includes('@grpc/grpc-js'));
  t.false(loadedRequests.includes('node:http2'));
  t.false(loadedRequests.includes('http2'));
});

function createRestrictedCommonJsLoader(loadedRequests: string[]): (request: string) => any {
  const context = vm.createContext(
    {
      AbortController,
      AbortSignal,
      ArrayBuffer,
      Buffer,
      DataView,
      Error,
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
      fetch,
      process,
      queueMicrotask,
      setImmediate,
      setInterval,
      setTimeout,
    },
    {
      name: 'cloudflare-client-import',
    }
  );
  (context as any).global = context;
  (context as any).globalThis = context;

  const moduleCache = new Map<string, { exports: any }>();

  const load = (
    request: string,
    parentFilename = path.join(projectRoot, 'packages/test/lib/cloudflare-import-entry.js')
  ): any => {
    loadedRequests.push(request);
    if (request === '@grpc/grpc-js' || request === 'node:http2' || request === 'http2') {
      throw new Error(`blocked ${request}`);
    }
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
