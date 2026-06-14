# Cloudflare Workers Temporal Client Decision

## Decision

Implement a Worker-safe client subpath backed by a narrow HTTPS bridge transport, while preserving the current static-protobuf baseline.

This is a small combination of protobuf and transport work:

- Protobuf layer: preserve the existing static `@temporalio/proto` facade because it already removes protobufjs reflection/eval from the required client path.
- Client import graph: split Node grpc-js-only pieces away from the high-level client modules that Worker code needs to import.
- Transport layer: add a `ConnectionLike` implementation for Cloudflare Workers that sends unary protobuf requests over ordinary `fetch` to a bridge endpoint. The bridge is responsible for native gRPC to Temporal Cloud or self-hosted Temporal.

The Worker-facing high-level surface remains the existing `Client`, `WorkflowClient`, schedules, task queues, async completion, and related client helpers. The Worker path uses a new subpath, `@temporalio/client/cloudflare`, and an explicit Worker connection. The root `@temporalio/client` entry remains Node-oriented and may continue to export `Connection` and grpc-js retry interceptors.

Fallback path: direct native gRPC over `cloudflare:sockets` if the bridge requirement becomes unacceptable. That fallback should not start until the bridge path is proven insufficient, because it requires an in-repo HTTP/2 client surface.

## Local Evidence

- `packages/client/src/connection.ts:1` and `packages/client/src/connection.ts:2` import `node:async_hooks` and `@grpc/grpc-js` at module load.
- `packages/client/src/connection.ts:60`, `packages/client/src/connection.ts:74`, `packages/client/src/connection.ts:91`, and `packages/client/src/connection.ts:103` expose grpc-js-specific option types in the Node `ConnectionOptions`.
- `packages/client/src/base-client.ts:5` imports `Connection`, and `packages/client/src/base-client.ts:66` defaults every high-level client to `Connection.lazy()`.
- `packages/client/src/index.ts:59` through `packages/client/src/index.ts:67` re-export Node `Connection` and `grpc-retry`.
- `packages/client/src/errors.ts:1` and `packages/client/src/errors.ts:2` import grpc-js only to describe service errors and status constants.
- `packages/client/src/grpc-retry.ts:1` through `packages/client/src/grpc-retry.ts:3` import grpc-js for both retry policy data and the Node interceptor adapter.
- High-level client modules import grpc-js status constants directly, so a Worker-safe subpath must move those constants into a runtime-neutral module before it can re-export the high-level clients.

## External Evidence

- Cloudflare Workers Node.js compatibility still lists Node `http2` as partially supported and non-functional, while `AsyncLocalStorage` is supported and can be enabled alone with `nodejs_als`: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Cloudflare Workers TCP sockets are available through `cloudflare:sockets`, support TLS options, and expose Web streams, but that still leaves HTTP/2 framing, ALPN behavior, flow control, trailers, and gRPC status mapping to this SDK fork: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- Cloudflare's network gRPC proxy support requires endpoints to speak TLS, HTTP/2, ALPN, and `application/grpc` content types: https://developers.cloudflare.com/network/grpc-connections/
- Temporal TypeScript clients connect with `Connection.connect({ address, tls, apiKey })`, and API key updates are supported through `connection.setApiKey`: https://docs.temporal.io/develop/typescript/client/temporal-client
- Native gRPC over HTTP/2 requires gRPC status in trailers and uses `grpc-status-details-bin` for structured details: https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md
- gRPC-Web is a different wire protocol designed for proxy translation and encodes trailers in the response body: https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md

## Matrix

| Option | Cloudflare feasibility | Drop-in high-level client impact | Temporal Cloud / self-hosted reach | Required behavior coverage | External infrastructure | Rebase cost | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Protobuf-only | High for no-eval imports | No client API changes | Does not solve transport | Does not address metadata, deadlines, aborts, retries, or service errors | No | Low | Rejected as incomplete |
| grpc-js on Workers | Low | Would preserve root API | The protocol target is right, but Cloudflare `node:http2` is non-functional | Existing Node behavior would work only if grpc-js ran, which current platform evidence contradicts | No | Low if it worked | Rejected |
| Fetch native gRPC | Unproven | Can fit behind `ConnectionLike` | Potentially direct if fetch exposes enough HTTP/2/gRPC semantics | Trailers and `grpc-status-details-bin` are the critical weak points | No | Medium | Deferred |
| gRPC-Web | Medium for Worker fetch | Can fit behind `ConnectionLike` | Requires a gRPC-Web proxy; native Temporal endpoints are not gRPC-Web endpoints | Unary calls are plausible, but proxy must preserve metadata, deadlines, details, and errors | Yes | Medium | Rejected for first implementation |
| Socket native gRPC | Medium technically, high implementation burden | Can fit behind `ConnectionLike` | Direct path to Temporal Cloud and self-hosted Temporal | Can preserve all behavior if a correct HTTP/2/gRPC client is built | No | High | Fallback, not first path |
| HTTPS bridge/proxy | High for Worker fetch | High-level `Client` remains unchanged with explicit Worker connection | Bridge reaches Temporal through existing Node grpc-js stack | Worker SDK can preserve metadata, API key, deadlines, aborts, retries, and service error shape over a narrow contract | Yes | Low to medium | Selected |

## Selected Transport Contract

The Worker SDK will define a minimal transport under the protobuf `RPCImpl` boundary:

```ts
invoke(request: {
  serviceName: string;
  methodName: string;
  request: Uint8Array;
  metadata: Metadata;
  deadline?: number | Date;
  abortSignal?: AbortSignal;
}): Promise<Uint8Array>
```

The default Cloudflare bridge transport sends this request to a configured HTTPS endpoint using `fetch`. The first bridge envelope should optimize for correctness and easy verification rather than wire efficiency:

- JSON request envelope with service name, method name, base64 protobuf request bytes, metadata entries, optional deadline, and bridge protocol version.
- JSON success response with base64 protobuf response bytes.
- JSON error response with service error code, details, message, and metadata entries including `grpc-status-details-bin` when present.
- API keys are applied as `Authorization: Bearer <key>` metadata before the bridge call, matching the existing Node `Connection` behavior.
- Abort signals are passed to `fetch`.
- Deadlines are represented both in the envelope and by local abort timeout behavior where possible.

Unsupported on the Cloudflare connection path:

- grpc-js `credentials`
- grpc-js `callCredentials`
- grpc-js `channelArgs`
- grpc-js interceptors
- mTLS client certificates, unless a future bridge contract explicitly supports them

## Implementation Steps

1. Add runtime-neutral grpc status and service error metadata types.
2. Move retry decision and backoff logic into a runtime-neutral module, keeping grpc-js interceptor construction in the Node adapter.
3. Remove grpc-js status imports from high-level client modules.
4. Introduce a Worker-safe subpath, `@temporalio/client/cloudflare`, that re-exports high-level client APIs but does not re-export Node `Connection` or grpc-js retry interceptors.
5. Add `CloudflareConnection` and a small bridge/fake transport seam behind `ConnectionLike`.
6. Add Worker-safe import and fake unary RPC tests that block `@grpc/grpc-js`, `node:http2`, and Node gRPC transport code.
7. Document the bridge contract, limitations, and manual Cloudflare Worker E2E checklist.

## Verification

Automated:

- `./node_modules/.bin/tsc --build packages/client/tsconfig.json packages/test/tsconfig.json`
- `cd packages/test && node_modules/.bin/ava ./lib/test-client-cloudflare-import.js`
- `cd packages/test && node_modules/.bin/ava ./lib/test-client-cloudflare-connection.js`
- `cd packages/test && node_modules/.bin/ava ./lib/test-cloudflare-protobuf-no-eval.js`

Manual:

1. Deploy or run a bridge that accepts the selected envelope and forwards unary requests to Temporal using Node `@grpc/grpc-js`.
2. Deploy a Cloudflare Worker with `nodejs_compat` or `nodejs_als`, depending on the final import graph.
3. In the Worker, import from `@temporalio/client/cloudflare`, create `CloudflareConnection.connect({ bridgeUrl, address, tls: true, apiKey })`, then create `new Client({ connection, namespace })`.
4. Call `client.connection.workflowService.getSystemInfo({})`.
5. Start a short workflow through `client.workflow.start` against a controlled namespace.
6. Confirm API key auth, custom metadata, deadline failure, abort cancellation, retryable bridge failure, and `NamespaceNotFoundError` mapping.
