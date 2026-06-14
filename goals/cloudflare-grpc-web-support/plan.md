# Cloudflare gRPC-Web Client Support Plan

## Solution Approach

Add a Cloudflare-compatible client connection path that implements the existing `ConnectionLike` contract using fetch-compatible gRPC-Web. Keep the current Node `@grpc/grpc-js` connection as the default Node path, but remove eager Node gRPC imports from shared high-level client modules so a Worker-safe entry can import `Client` plus a gRPC-Web `Connection` without bundling `@grpc/grpc-js`.

The first implementation should target unary protobuf gRPC-Web (`application/grpc-web+proto`) against a gRPC-Web compatible endpoint or proxy. Current Temporal docs describe Temporal Server and Temporal Cloud as exposing native gRPC endpoints, while gRPC-Web docs describe the web protocol as requiring a compatible server/proxy layer, so endpoint/proxy validation is a pre-development gate.

## Ordered Steps

1. Verify the endpoint/proxy assumption before development.

   Files/systems: docs only, plus any temporary local notes under `goals/cloudflare-grpc-web-support/` if needed.

   Work:
   - Confirm whether the target Temporal deployment has direct gRPC-Web support.
   - If not, document the required proxy shape, for example Envoy `grpc_web` in front of Temporal Frontend.
   - Record that Temporal Cloud direct gRPC-Web is not assumed unless proven by official docs or a live endpoint test.

   Verification:
   - Manual: confirm one target endpoint or proxy can accept `application/grpc-web+proto` unary requests.
   - Documentation check: README or package docs must say that a gRPC-Web compatible endpoint/proxy is required.

2. Make shared client code transport-neutral where it blocks Worker-safe imports.

   Files/systems:
   - `packages/client/src/errors.ts`
   - `packages/client/src/grpc-retry.ts`
   - `packages/client/src/types.ts`
   - `packages/client/src/base-client.ts`
   - `packages/client/src/workflow-client.ts`
   - `packages/client/src/schedule-client.ts`
   - `packages/client/src/activity-client.ts`
   - `packages/client/src/task-queue-client.ts`
   - `packages/client/src/nexus-client.ts`
   - `packages/client/src/async-completion-client.ts`
   - `packages/client/src/helpers.ts`

   Work:
   - Add a small runtime-neutral gRPC status module, then replace high-level runtime imports of `@grpc/grpc-js` status constants.
   - Add a runtime-neutral service-error/metadata shape that remains compatible with `isGrpcServiceError`, `isGrpcDeadlineError`, `isGrpcCancelledError`, and helpers that read `grpc-status-details-bin`.
   - Change `base-client.ts` so it does not eagerly import `./connection` just to build a default connection. It can lazy-load the Node connection only when no connection is supplied.
   - Keep `grpc-retry.ts` public API working for Node, but avoid eager `@grpc/grpc-js` imports from Worker-safe entry paths. Split the Node interceptor adapter if needed.

   Verification:
   - `pnpm -C packages/client run build`
   - `pnpm -C packages/test run build`
   - `pnpm -C packages/test exec ava ./lib/test-client-connection.js`
   - Worker-safe import smoke test added in step 5 fails if `@grpc/grpc-js` is resolved.

3. Extract only the connection helpers needed to avoid duplication.

   Files/systems:
   - `packages/client/src/connection.ts`
   - New `packages/client/src/connection-shared.ts` or similarly named helper module

   Work:
   - Preserve the current Node `Connection` behavior in `connection.ts`; it currently creates service stubs around `WorkflowService.create`, `OperatorService.create`, `TestService.create`, and `HealthService.create`.
   - Move only broadly shared logic into a helper: API key function setup, default SDK metadata, call context handling, service stub construction, and namespace header injection.
   - Do not rewrite generated protobuf service surfaces.

   Verification:
   - Existing Node connection tests still pass.
   - Diff review shows `connection.ts` remains mostly Node gRPC setup plus delegation to shared helpers.

4. Add the fetch/gRPC-Web transport and connection.

   Files/systems:
   - New `packages/client/src/grpc-web-transport.ts`
   - New `packages/client/src/grpc-web-connection.ts`
   - New Worker-safe entry file such as `packages/client/src/cloudflare.ts` or `packages/client/src/grpc-web.ts`

   Work:
   - Implement unary gRPC-Web framing around protobufjs `RPCImpl`: request path `/${serviceName}/${method.name}`, one 5-byte-prefixed protobuf request frame, response data frame parsing, and final trailer-frame parsing.
   - Send fetch headers for gRPC-Web protobuf requests, static metadata, namespace metadata, API key authorization, client name, and client version.
   - Encode binary metadata values for `-bin` headers and decode binary response metadata such as `grpc-status-details-bin` for existing error helpers.
   - Convert deadlines into `grpc-timeout` and an abortable fetch timeout.
   - Merge caller abort signals with the timeout signal and map aborts to `CANCELLED` or `DEADLINE_EXCEEDED` consistently.
   - Map gRPC-Web trailers and fetch/network failures into the SDK's service-error shape.
   - Add a fetch retry loop using the existing retry decision/backoff semantics, without relying on grpc-js interceptors.
   - Reject unsupported Node-only options clearly in the gRPC-Web connection path: `credentials`, `callCredentials`, `channelArgs`, grpc-js interceptors, and client certificate TLS.
   - Use Cloudflare `nodejs_compat` for supported Node compatibility APIs such as `AsyncLocalStorage` if the implementation keeps that dependency; otherwise add a narrow context abstraction.

   Verification:
   - Unit tests cover success encode/decode, headers, binary metadata, namespace injection, API key updates, deadlines, aborts, gRPC status errors, status details, and retry attempts.
   - Manual check against a gRPC-Web proxy proves a `Client` can call `getSystemInfo` or another simple unary RPC.

5. Add automated Worker-safety tests.

   Files/systems:
   - New `packages/test/src/test-client-grpc-web-connection.ts`
   - New or extended `packages/test/src/test-cloudflare-protobuf-no-eval.ts`
   - `packages/test/package.json` only if the default AVA glob is insufficient

   Work:
   - Build a fake fetch implementation that validates gRPC-Web request frames and returns gRPC-Web response/trailer frames.
   - Instantiate the gRPC-Web connection and use normal `Client` APIs with it.
   - Add a restricted-loader smoke test modeled on `test-cloudflare-protobuf-no-eval.ts` that imports the Worker-safe client entry and fails if `@grpc/grpc-js`, Node gRPC channel code, dynamic string code generation, or protobuf reflection codegen is loaded.
   - Keep the existing Node `test-client-connection.ts` suite as regression coverage for the default Node transport.

   Verification:
   - `pnpm -C packages/test run build`
   - `pnpm -C packages/test exec ava ./lib/test-client-grpc-web-connection.js`
   - `pnpm -C packages/test exec ava ./lib/test-cloudflare-protobuf-no-eval.js`
   - `pnpm -C packages/test exec ava ./lib/test-client-connection.js`

6. Document usage and limitations.

   Files/systems:
   - `README.md`
   - `packages/client/README.md`
   - Optional package docs under `packages/docs/docs/` if this repo expects generated docs updates for client runtime support

   Work:
   - Show the Cloudflare-compatible import and connection construction.
   - Document `nodejs_compat` if required.
   - Document the gRPC-Web compatible endpoint/proxy requirement.
   - List unsupported first-pass features: running Temporal Workers in Cloudflare Workers, native gRPC channel credentials, mTLS client certs from fetch, grpc-js interceptors/channel args, streaming, and broad protobuf runtime migration.
   - Add a manual end-to-end checklist for testing against a real gRPC-Web compatible Temporal endpoint.

   Verification:
   - Documentation examples compile or are covered by a smoke import test.
   - The README no longer overstates Cloudflare support for `@temporalio/client` without the gRPC-Web endpoint/proxy caveat.

## Important Code References

- `packages/client/src/connection.ts:1` and `packages/client/src/connection.ts:2` eagerly import `node:async_hooks` and `@grpc/grpc-js`.
- `packages/client/src/connection.ts:343` through `packages/client/src/connection.ts:418` create service stubs from protobufjs service classes.
- `packages/client/src/connection.ts:501` through `packages/client/src/connection.ts:545` is the current unary `RPCImpl` bridge to `client.makeUnaryRequest`.
- `packages/client/src/types.ts:99` through `packages/client/src/types.ts:106` expose protobufjs service classes that the gRPC-Web path can reuse.
- `packages/client/src/types.ts:132` through `packages/client/src/types.ts:175` define `ConnectionLike`, the contract the gRPC-Web connection should implement.
- `packages/client/src/base-client.ts:5` and `packages/client/src/base-client.ts:65` through `packages/client/src/base-client.ts:67` eagerly load the Node connection when no connection is supplied.
- `packages/client/src/index.ts:59` through `packages/client/src/index.ts:67` re-export Node connection and grpc retry modules from the package root.
- `packages/test/src/test-client-connection.ts:63` through `packages/test/src/test-client-connection.ts:141` are useful parity tests for metadata, deadlines, API keys, and aborts.
- `packages/test/src/test-cloudflare-protobuf-no-eval.ts:82` through `packages/test/src/test-cloudflare-protobuf-no-eval.ts:121` provide a precedent for Cloudflare-style restricted import tests.

## Risks And Open Questions

- Direct Temporal Server or Temporal Cloud gRPC-Web support is not assumed. The safest plan is to require and document a gRPC-Web compatible endpoint or proxy unless official docs or endpoint tests prove otherwise.
- If the desired user experience is unchanged `import { Client, Connection } from '@temporalio/client'` in Cloudflare, package root import safety requires more work because `index.ts` currently re-exports Node connection and grpc retry modules. A Worker-specific subpath is the smaller, easier-to-rebase first pass.
- Cloudflare `nodejs_compat` currently covers several non-gRPC Node APIs used by the client, including `AsyncLocalStorage`, `node:crypto`, and `node:events`; supporting Workers without `nodejs_compat` would be a larger compatibility project.
- Fetch cannot provide grpc-js channel credentials, call credentials, or client certificate TLS in the same way Node gRPC can. The gRPC-Web path should reject unsupported options early.
- gRPC-Web text mode and streaming are out of scope for this first pass.

## Sources

- Cloudflare Workers Node.js compatibility: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Cloudflare Workers AsyncLocalStorage: https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/
- gRPC-Web protocol: https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md
- gRPC-Web architecture overview: https://grpc.io/blog/state-of-grpc-web/
- Temporal Server frontend API reference: https://docs.temporal.io/self-hosted-guide/server-frontend-api-reference
- Temporal Cloud namespace gRPC endpoint docs: https://docs.temporal.io/cloud/namespaces
