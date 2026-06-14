# Cloudflare Workers Temporal Client Compatibility Plan

## Solution Approach

The first output is a decision package that determines the best path forward. It must compare protobuf-level, grpc-js compatibility, fetch/native gRPC, gRPC-Web, Cloudflare socket/native gRPC, and bridge/proxy options before selecting an implementation direction.

Current evidence leans toward the remaining blocker being transport/import related, but this plan must not preselect the answer. gRPC-Web is one candidate path, not the assumed solution and not excluded up front.

Current validation shows the protobuf path is already much healthier than the prior research baseline:

- `packages/proto/protos/root.js` loads `static-module` instead of `protobufjs/light` reflection output.
- `packages/proto/src/patch-protobuf-root.ts` has static-root lookup and service patching support.
- `packages/common/src/proto-utils.ts` uses generated static protobuf methods instead of `proto3-json-serializer`.
- `packages/test/src/test-cloudflare-protobuf-no-eval.ts` passes and proves the current proto/common/cloud no-eval smoke coverage.

The remaining confirmed blocker is that `@temporalio/client` still eagerly imports Node gRPC transport code. The built client entry fails immediately when `@grpc/grpc-js` is blocked. Cloudflare Workers currently exposes Node compatibility for many APIs, but its Node `http2` API is documented as partially supported and non-functional, while `@grpc/grpc-js` is a Node.js implementation.

The plan should make a recommendation only after the option analysis scores each path on:

- Cloudflare runtime feasibility
- drop-in impact on existing client application code
- ability to connect to Temporal Cloud and self-hosted Temporal
- support for required unary client RPC behavior
- implementation size and verification burden
- upstream rebase cost
- whether the path requires external infrastructure

## Ordered Steps

1. Preserve and document the static-protobuf baseline.

   Files/systems:
   - `packages/proto/scripts/compile-proto.ts`
   - `packages/proto/protos/root.js`
   - `packages/proto/protos/static-module.js`
   - `packages/proto/src/patch-protobuf-root.ts`
   - `packages/common/src/proto-utils.ts`
   - `packages/common/src/converter/protobuf-payload-converters.ts`
   - `packages/test/src/test-cloudflare-protobuf-no-eval.ts`
   - `packages/proto/README.md`

   Work:
   - Keep the generated protobuf runtime on `static-module`.
   - Keep `patchProtobufRoot` compatible with static roots and legacy protobufjs roots.
   - Do not start a full Protobuf-ES or Buf migration unless a later transport spike proves the static protobuf facade cannot support required service request/response encoding.
   - Add a short note to the plan or docs that protobuf is currently a prerequisite, not the remaining primary blocker.

   Verification:
   - `./node_modules/.bin/tsx ./packages/proto/scripts/compile-proto.ts`
   - `./node_modules/.bin/tsc --build packages/proto/tsconfig.json packages/common/tsconfig.json packages/client/tsconfig.json packages/cloud/tsconfig.json packages/test/tsconfig.json`
   - `cd packages/test && node_modules/.bin/ava ./lib/test-cloudflare-protobuf-no-eval.js`

   Current result:
   - Direct `tsx` plus `tsc --build` passed after allowing `tsx` to create its local IPC pipe.
   - `test-cloudflare-protobuf-no-eval.js` passed with 3 tests.
   - `pnpm` verification was blocked by local Corepack signature issues, so direct tool binaries were used for this planning pass.

2. Build the decision matrix and select the path.

   Files/systems:
   - `goals/cloudflare-workers-temporal-client/plan.md`
   - Optional `goals/cloudflare-workers-temporal-client/decision.md`
   - `packages/client/src/connection.ts`
   - `packages/client/src/base-client.ts`
   - `packages/client/src/index.ts`
   - `packages/client/src/grpc-retry.ts`
   - `packages/client/src/errors.ts`
   - `packages/client/src/helpers.ts`
   - `packages/proto/src/patch-protobuf-root.ts`
   - `packages/common/src/proto-utils.ts`

   Work:
   - Compare these options without implementing any one path first:
     - **Protobuf-only:** continue static protobuf work and leave transport alone.
     - **grpc-js on Workers:** rely on Cloudflare `nodejs_compat` and existing `@grpc/grpc-js`.
     - **Fetch native gRPC:** implement native gRPC over ordinary Worker `fetch`.
     - **gRPC-Web:** add a gRPC-Web/fetch connection path and document any required proxy.
     - **Socket native gRPC:** implement native gRPC over Cloudflare `cloudflare:sockets`.
     - **Bridge/proxy:** add a Worker-safe HTTPS transport to a Node or edge bridge that performs native gRPC.
   - For each option, answer:
     - What repo files change?
     - Does it keep high-level `Client` usage unchanged?
     - Does it require a new import path or only new connection construction?
     - Does it require external infrastructure?
     - Does it work with Temporal Cloud's documented gRPC endpoints or only a proxy?
     - Can it preserve metadata, API keys, deadlines, aborts, retries, and service error details?
     - What automated tests would prove the claim?
     - What is the upstream rebase cost?
   - Avoid isolated proof-of-concepts that only show one preferred path works. Use bounded evidence: docs, code inspection, import checks, tiny protocol checks, and fake transports.
   - Produce a short recommendation section with one selected path, one fallback path, and explicit reasons rejected or deferred for the others.

   Verification:
   - The decision matrix cites the local code references and primary external docs used.
   - The selected path explicitly satisfies every accepted fact or records a blocker.
   - The selected path includes concrete implementation and verification steps.

   Current result:
   - Added `goals/cloudflare-workers-temporal-client/decision.md`.
   - Selected a Worker-safe HTTPS bridge transport plus the existing static-protobuf baseline.
   - Rejected grpc-js on Workers because Cloudflare still lists Node `http2` as non-functional.
   - Deferred direct socket native gRPC because it requires an in-repo HTTP/2/gRPC client over `cloudflare:sockets`.
   - Rejected gRPC-Web for the first implementation because native Temporal endpoints are not gRPC-Web endpoints and a proxy would still be required.

3. Make the high-level client import graph transport-neutral if the selected path needs a Worker-safe client bundle.

   Files/systems:
   - `packages/client/src/index.ts`
   - `packages/client/src/base-client.ts`
   - `packages/client/src/errors.ts`
   - `packages/client/src/grpc-retry.ts`
   - `packages/client/src/helpers.ts`
   - `packages/client/src/workflow-client.ts`
   - `packages/client/src/schedule-client.ts`
   - `packages/client/src/activity-client.ts`
   - `packages/client/src/async-completion-client.ts`
   - `packages/client/src/task-queue-client.ts`
   - `packages/client/src/nexus-client.ts`
   - `packages/client/src/types.ts`

   Work:
   - Add a runtime-neutral `grpc-status` module with the numeric status enum currently imported from `@grpc/grpc-js`.
   - Add a runtime-neutral service error and metadata shape that satisfies `isGrpcServiceError`, `isGrpcDeadlineError`, `isGrpcCancelledError`, `rethrowKnownErrorTypes`, and `getGrpcStatusDetails`.
   - Move retry decision/backoff logic out of `grpc-retry.ts` into a transport-neutral module. Keep `makeGrpcRetryInterceptor` in a Node-only adapter that imports `@grpc/grpc-js`.
   - Remove top-level `Connection` import from `base-client.ts`. The default Node connection can be lazily loaded only on Node paths, while Worker-safe paths must require an explicit Worker connection or use a Worker-safe entrypoint default.
   - Keep the existing root package API working for Node users, but create a Worker-safe subpath such as `@temporalio/client/cloudflare` or `@temporalio/client/worker` that does not re-export Node `Connection` or grpc-js retry adapters.

   Verification:
   - Existing Node client builds still pass.
   - A restricted import test blocks `@grpc/grpc-js` and successfully imports the Worker-safe client subpath.
   - The same restricted import test should still fail for the Node root entry if root remains intentionally Node-oriented.
   - Existing high-level client tests continue to pass for Node connection behavior.

   Current evidence:
   - `packages/client/src/connection.ts:1` and `packages/client/src/connection.ts:2` import `node:async_hooks` and `@grpc/grpc-js`.
   - `packages/client/src/base-client.ts:5` imports `Connection` at module load and `packages/client/src/base-client.ts:66` calls `Connection.lazy()` by default.
   - `packages/client/src/index.ts:59` through `packages/client/src/index.ts:67` re-export Node `Connection` and `grpc-retry`.
   - `packages/client/src/errors.ts:2`, `packages/client/src/grpc-retry.ts:2`, and multiple high-level client files import grpc-js status constants.
   - A local import check that blocks `@grpc/grpc-js` fails on `require('./packages/client/lib')` with `blocked @grpc/grpc-js`.

   Current result:
   - Added runtime-neutral `packages/client/src/grpc-status.ts`.
   - Added runtime-neutral retry policy module `packages/client/src/grpc-retry-policy.ts`.
   - Kept `packages/client/src/grpc-retry.ts` as the Node grpc-js interceptor adapter.
   - Moved high-level client modules off grpc-js status imports.
   - Changed `packages/client/src/base-client.ts` to lazy-load the default Node `Connection` only when no explicit connection is provided.
   - Added Worker-safe `packages/client/src/cloudflare.ts` and root stubs `packages/client/cloudflare.js` / `packages/client/cloudflare.d.ts`.

4. Extract shared connection behavior without rewriting client APIs.

   Files/systems:
   - `packages/client/src/connection.ts`
   - New `packages/client/src/connection-shared.ts`
   - New `packages/client/src/connection-context.ts` if AsyncLocalStorage abstraction is needed
   - `packages/client/src/types.ts`

   Work:
   - Preserve the Node `Connection` class as the default Node implementation.
   - Extract only the shared pieces needed by both Node and Worker connections:
     - default metadata (`client-name`, `client-version`)
     - API key handling and `setApiKey`
     - metadata scoping
     - deadline and abort scoping
     - namespace header injection
     - protobuf service stub creation from `WorkflowService.create`, `OperatorService.create`, `TestService.create`, and `HealthService.create`
   - Keep `ConnectionLike` as the stable high-level contract.
   - Keep fork divergence small: no broad rewrite of `WorkflowClient`, `Client`, or generated protobuf service types.

   Verification:
   - Existing `packages/test/src/test-client-connection.ts` behavior remains covered for Node.
   - New shared helper tests cover namespace metadata, nested metadata merge, API key update, deadlines, aborts, and `ensureConnected` behavior independent of transport.

   Current result:
   - Added `packages/client/src/connection-shared.ts`.
   - Shared default client metadata, API key ref handling, metadata merge order, service stub creation, and namespace header injection across Node `Connection` and `CloudflareConnection`.
   - Existing Node connection behavior is covered by `test-client-connection.js`.
   - Cloudflare fake-transport tests cover namespace metadata, nested metadata merge, API key update, deadlines, aborts, retries, and `ensureConnected`.

5. Implement the selected transport path behind `ConnectionLike`.

   Files/systems:
   - New `packages/client/src/<selected>-connection.ts`
   - New `packages/client/src/<selected>-transport.ts`
   - New Worker-safe entrypoint such as `packages/client/src/cloudflare.ts` or `packages/client/src/worker.ts`
   - New tests under `packages/test/src/`

   Work:
   - Build a minimal transport interface below protobufjs `RPCImpl`: `(serviceName, method, requestBytes, metadata, deadline, abortSignal) -> responseBytes | serviceError`.
   - Implement only the selected path from step 2.
   - Keep gRPC-Web, socket native gRPC, and bridge work conditional on the decision matrix outcome:
     - If **gRPC-Web** wins: implement unary gRPC-Web/fetch framing and document the proxy or endpoint requirement.
     - If **socket native gRPC** wins: implement unary native gRPC over `cloudflare:sockets` and scope the HTTP/2 work explicitly.
     - If **bridge/proxy** wins: implement the Worker-side HTTPS transport and document the bridge contract.
     - If **grpc-js on Workers** wins despite current evidence: document which Cloudflare Node APIs make it viable and add runtime tests proving it.
     - If **fetch native gRPC** wins: document how trailers/status details are represented and add tests proving error mapping.
   - Limit the first implementation to unary RPCs used by `@temporalio/client`.
   - Reject or clearly document unsupported Node grpc-js options on any non-Node connection path:
     - `credentials`
     - `callCredentials`
     - `channelArgs`
     - grpc-js interceptors
     - mTLS client certificates, unless the selected runtime path supports them.

   Verification:
   - Unit tests with an in-memory fake transport prove protobuf request encoding, response decoding, metadata, API key headers, deadlines, aborts, retry decisions, and error mapping.
   - A Worker import test proves the subpath imports without `@grpc/grpc-js`.
   - A manual Cloudflare Worker E2E checklist runs one simple unary call, preferably `getSystemInfo`, against a real Temporal endpoint or a controlled test endpoint once the native transport exists.

   Decision gate after spike:
   - Continue only if the selected path remains small enough to isolate and verify.
   - If the selected path expands beyond the accepted scope, stop and update the decision matrix rather than drifting into a broad rewrite.

   Current result:
   - Added `packages/client/src/cloudflare-connection.ts`.
   - Implemented `CloudflareConnection`, `CloudflareBridgeTransport`, `CloudflareServiceError`, and a narrow `CloudflareTransport` interface under protobufjs `RPCImpl`.
   - The selected path stayed isolated to a Worker subpath and shared helpers; the Node root entry remains Node-oriented.

6. Define the fallback if the selected direct path is too large.

   Files/systems:
   - New Worker-safe client transport under `packages/client/src/`
   - Optional separate bridge package or documented external service outside this SDK fork

   Work:
   - Use the fallback selected in step 2, which may be a gRPC-Web proxy, a narrow HTTPS bridge protocol, or another documented option.
   - Worker client sends protobuf request bytes, service name, method name, metadata, deadline, and auth over ordinary HTTPS/fetch to the bridge.
   - Bridge runs in Node or another native gRPC-capable environment and forwards to Temporal with the existing `@grpc/grpc-js` stack.
   - Keep the high-level SDK `Client` unchanged; only connection construction and deployment topology change.
   - Document any operational tradeoff versus direct Temporal connectivity, especially external infrastructure requirements.

   Verification:
   - Same fake-transport unit tests as step 5.
   - Manual E2E follows the selected fallback topology.
   - Worker import/bundle checks still prove no `@grpc/grpc-js` in the Worker bundle.

7. Add Worker-safe import and bundle regression tests.

   Files/systems:
   - New `packages/test/src/test-client-cloudflare-import.ts`
   - New `packages/test/src/test-client-cloudflare-connection.ts`
   - Extend `packages/test/src/test-cloudflare-protobuf-no-eval.ts` only if it remains focused and readable

   Work:
   - Build a restricted CommonJS or bundled import test modeled on the existing no-eval test.
   - Block `@grpc/grpc-js`, `node:http2`, and Node gRPC transport code.
   - Import the Worker-safe client subpath and construct a `Client` with the Worker connection.
   - Run fake unary RPCs through normal `Client` APIs instead of only testing the transport in isolation.
   - Keep Node root import tests separate so the Node path can continue to expose `Connection` and grpc-js retry helpers.

   Verification:
   - `./node_modules/.bin/tsc --build packages/client/tsconfig.json packages/test/tsconfig.json`
   - `cd packages/test && node_modules/.bin/ava ./lib/test-client-cloudflare-import.js`
   - `cd packages/test && node_modules/.bin/ava ./lib/test-client-cloudflare-connection.js`
   - `cd packages/test && node_modules/.bin/ava ./lib/test-cloudflare-protobuf-no-eval.js`

   Current result:
   - Added `packages/test/src/test-client-cloudflare-import.ts`.
   - Added `packages/test/src/test-client-cloudflare-connection.ts`.
   - The import test blocks `@grpc/grpc-js`, `node:http2`, and `http2` while importing `@temporalio/client/cloudflare`.
   - The connection test drives `Client.workflow.count` through a fake Cloudflare transport.
   - The connection test covers API key metadata, namespace metadata, deadlines, abort cancellation, retryable service errors, and `grpc-status-details-bin` known error mapping.

8. Document usage, limitations, and fork divergence.

   Files/systems:
   - `README.md`
   - `packages/client/README.md`
   - `packages/proto/README.md`
   - Optional fork note under `goals/cloudflare-workers-temporal-client/` or an established repo docs location

   Work:
   - Document that Cloudflare compatibility applies to `@temporalio/client`, not Temporal Workers.
   - Document the Worker-safe import path and connection construction.
   - Document required Cloudflare compatibility flags:
     - `nodejs_compat` if keeping Node-compatible modules such as `node:crypto` and `node:os`
     - or `nodejs_als` only if the final path removes broader Node dependencies and only needs AsyncLocalStorage
   - Document unsupported grpc-js options on the Worker path.
   - Document whether the final chosen transport is direct native gRPC over sockets or the HTTPS bridge fallback.
   - Keep a short fork-divergence note explaining which files intentionally differ from upstream and how to rebase them.

   Verification:
   - Docs examples compile or are mirrored in smoke tests.
   - The README does not imply that Worker-level Temporal runtime features run in Cloudflare Workers.

   Current result:
   - Updated `packages/client/README.md` with Cloudflare subpath usage, bridge envelope, limitations, and manual E2E checklist.
   - Updated root `README.md` to distinguish the Node root entry, the Cloudflare client subpath, and out-of-scope Worker runtime features.

## Risks And Open Questions

- Any path that avoids `@grpc/grpc-js` still needs a transport story for Temporal's service RPCs. The decision matrix must make that tradeoff explicit rather than assuming the answer.
- The direct native-gRPC path requires either a Worker-compatible HTTP/2 client over `cloudflare:sockets` or a small in-repo unary HTTP/2 implementation.
- Cloudflare Workers supports outbound TCP sockets, but sockets cannot be created in global scope and every open TCP socket counts against open connection limits. Connection pooling must be designed around Worker request lifecycle constraints.
- Cloudflare Node compatibility supports many APIs, but Node `http2` is listed as partially supported and non-functional; relying on grpc-js through `nodejs_compat` is not a credible path.
- Temporal Cloud and self-hosted Temporal endpoints are documented as gRPC endpoints on port 7233. Any gRPC-Web, bridge, or proxy path must document how it reaches those native gRPC endpoints.
- Fetch-based native gRPC needs evidence that Cloudflare exposes the gRPC requirements needed by the SDK, especially trailers and status details.
- The Worker-safe subpath is the rebase-friendly target. Making unchanged `import { Client, Connection } from '@temporalio/client'` work in Workers would require deeper package-root changes and should be deferred unless explicitly required.
- Optional user protobuf payload converters still accept legacy protobufjs roots. They should not be expanded as part of this goal unless they are pulled into the required client import path.

## External Sources

- Cloudflare Workers Node.js compatibility documents `nodejs_compat`, supported APIs, and `node:http2` as a partially supported non-functional API: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Cloudflare Workers TCP sockets document `cloudflare:sockets`, TLS options, request-scope constraints, and connection limits: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- Cloudflare Workers protocols reference lists outbound HTTP/HTTPS via fetch and outbound direct TCP via `connect()`: https://developers.cloudflare.com/workers/reference/protocols/
- Cloudflare network gRPC docs describe proxied native gRPC requirements as TLS, HTTP/2, ALPN, and `application/grpc` content types: https://developers.cloudflare.com/network/grpc-connections/
- Temporal Cloud namespace docs describe namespaces as using gRPC endpoints: https://docs.temporal.io/cloud/namespaces
- Temporal self-hosted deployment docs expose the frontend gRPC service on port 7233 in the standard Docker Compose path: https://docs.temporal.io/self-hosted-guide/deployment
- grpc-node documents `@grpc/grpc-js` as the Node.js pure JavaScript gRPC implementation: https://github.com/grpc/grpc-node
- gRPC-Web docs say gRPC-Web clients connect through a special proxy and binary mode supports unary calls only; this is relevant to the gRPC-Web option in the decision matrix: https://github.com/grpc/grpc-web
