# Research: Cloudflare Workers protobuf eval compatibility

date: 2026-06-13
git_commit: 69d25a34876d85b8d58298dbc5ef0cda2f34bc0e
branch: main
repository: sdk-typescript
topic: cloudflare-workers-protobuf-eval
tags: [protobuf, cloudflare-workers, protobufjs, temporal-client, data-converter]
status: research

## Research Question

Where does this SDK currently rely on protobuf runtimes or generated protobuf code that can conflict with Cloudflare Workers' restriction on dynamic code generation, and what current repository constraints would affect a future move toward `@bufbuild/protobuf` or another protobuf mechanism?

## Summary

The checkout currently uses `protobufjs` as the runtime for Temporal SDK protobuf definitions. `@temporalio/proto` depends on `protobufjs` 7.5.8 and `long`, and its build script generates a `json-module` JavaScript artifact plus TypeScript declarations via `protobufjs-cli`.

There are two distinct protobuf surfaces:

- SDK/service protobufs: client, worker, cloud, and common packages import `@temporalio/proto` for Temporal service/core message types and service stubs.
- User payload protobufs: protobuf payload support is optional through `DefaultPayloadConverterWithProtobufs`; the default payload converter intentionally excludes protobuf converters so protobuf JSON support is not included in workflow bundles unless explicitly selected.

The local code contains an immediate dynamic-code pattern in `packages/common/src/converter/protobuf-payload-converters.ts`: `globalThis.constructor.constructor('return globalThis.Buffer')()`. Separately, upstream `protobufjs` reflection setup uses `Function(...)` when generating type-specific constructors, encoders, decoders, verifiers, and converters.

Cloudflare's current Worker docs state that `eval()` and `new Function` are not allowed for security reasons, and the compatibility flags page documents a startup-only `allow_eval_during_startup` flag. That runtime constraint aligns with the reported `EvalError: Code generation from strings disallowed for this context`.

The repository does not currently contain `@bufbuild/protobuf`, `protobuf-es`, `connectrpc`, `buf.gen.yaml`, `protoc-gen-es`, `ts-proto`, or `protobuf-ts` in runtime package manifests. The only Buf-related reference found is in the test proto Makefile for installing the Buf CLI.

## Detailed Findings

### Runtime Support Posture

The root README says `@temporalio/client` is believed to work in several server-side JavaScript environments including Cloudflare Workers, while noting that the SDK does not regularly test those environments and does not officially support them. The same section distinguishes Worker-level features and says they depend on Node-specific APIs such as Node-API native modules, `worker_threads`, `vm`, `AsyncLocalStorage`, and `async_hooks`.

Relevant local references:

- `README.md:63` documents "Other JavaScript runtime environments".
- `README.md:65` mentions Cloudflare Workers for `@temporalio/client`.
- `README.md:70` through `README.md:86` list Node-specific Worker-level dependencies and discourage non-Node Worker execution.

External runtime references used:

- Cloudflare Workers JavaScript standards: https://developers.cloudflare.com/workers/runtime-apis/web-standards/
- Cloudflare compatibility flags, "Enable eval during startup": https://developers.cloudflare.com/workers/configuration/compatibility-flags/

### Package Dependency Shape

`@temporalio/proto` is the central SDK protobuf package:

- `packages/proto/package.json:2` names the package `@temporalio/proto`.
- `packages/proto/package.json:24` through `packages/proto/package.json:27` list runtime dependencies on `long` and `protobufjs` 7.5.8.
- `packages/proto/package.json:29` through `packages/proto/package.json:30` list `protobufjs-cli` as a dev dependency.

`@temporalio/common` depends on `@temporalio/proto` and `proto3-json-serializer`:

- `packages/common/package.json:14` through `packages/common/package.json:19`.

`@temporalio/worker` also has direct runtime dependencies on `@temporalio/proto` and `protobufjs`:

- `packages/worker/package.json:18` through `packages/worker/package.json:38`.

`pnpm-lock.yaml` confirms the graph includes `protobufjs@7.5.8`, `@protobufjs/codegen@2.0.5`, and `proto3-json-serializer@2.0.0`.

### Generated SDK Proto Artifact Shape

The SDK proto build script uses `protobufjs-cli` to generate two outputs from SDK core and Temporal service protos:

- `packages/proto/scripts/compile-proto.ts:6` through `packages/proto/scripts/compile-proto.ts:7` import `pbjs` and `pbts`.
- `packages/proto/scripts/compile-proto.ts:27` through `packages/proto/scripts/compile-proto.ts:35` define shared `pbjs` options including CommonJS wrapping, `--force-long`, `--no-verify`, and root name `__temporal`.
- `packages/proto/scripts/compile-proto.ts:38` through `packages/proto/scripts/compile-proto.ts:43` generate a `json-module` JavaScript file and a temporary `static-module` file used only for declarations.
- `packages/proto/scripts/compile-proto.ts:56` emits `root.d.ts` from the temporary static module.

The checked-in runtime entry point for the generated protos loads `protobufjs/light`, configures `long`, imports the generated `json-module`, and patches the root:

- `packages/proto/protos/root.js:1` through `packages/proto/protos/root.js:9`.

The generated `json-module.js` itself is not checked in this fresh checkout under `packages/proto/protos/`; only `index.js`, `index.d.ts`, and `root.js` are present before a build.

### Existing Protobuf Library Design Notes

`docs/protobuf-libraries.md` records a December 2021 library survey for the protobuf data converters. Its criteria were TypeScript message types, runtime ability to detect protobuf messages without function annotations, and spec-compliant proto3 JSON.

The documented current solution is:

- Use `protobufjs` with `proto3-json-serializer`.
- Have users use runtime-loaded messages and `Class.create`.
- Patch `json-module` output.

References:

- `docs/protobuf-libraries.md:1` through `docs/protobuf-libraries.md:5` list the original criteria.
- `docs/protobuf-libraries.md:9` through `docs/protobuf-libraries.md:16` summarize protobufjs.
- `docs/protobuf-libraries.md:18` through `docs/protobuf-libraries.md:24` summarize `proto3-json-serializer`.
- `docs/protobuf-libraries.md:50` through `docs/protobuf-libraries.md:54` document the current solution.
- `docs/protobuf-libraries.md:56` through `docs/protobuf-libraries.md:97` show the expected user root, payload converter, client, and workflow pattern.
- `docs/protobuf-libraries.md:114` through `docs/protobuf-libraries.md:123` list earlier future-work ideas centered on changing protobufjs output or generated classes.

The repository search found no current `@bufbuild/protobuf`, `protobuf-es`, `connectrpc`, `buf.gen.yaml`, `protoc-gen-es`, `ts-proto`, or `protobuf-ts` usage in source or package manifests.

External library references used:

- Protobuf.js README/source repository: https://github.com/protobufjs/protobuf.js/
- Protobuf.js `util/codegen.js`, where generated functions are finalized with `Function`: https://raw.githubusercontent.com/protobufjs/protobuf.js/master/src/util/codegen.js
- Protobuf.js `type.js`, where reflected types set up generated encode/decode/verify/fromObject/toObject functions: https://raw.githubusercontent.com/protobufjs/protobuf.js/master/src/type.js
- Buf Protobuf-ES repository: https://github.com/bufbuild/protobuf-es
- Buf code generation docs: https://buf.build/docs/generate/

### Direct Dynamic-Code Pattern In Local Source

`packages/common/src/converter/protobuf-payload-converters.ts` contains:

- `packages/common/src/converter/protobuf-payload-converters.ts:17`: `globalThis.constructor.constructor('return globalThis.Buffer')()`.

That expression obtains the outer/global `Buffer` constructor through the `Function` constructor path. It is used by:

- `packages/common/src/converter/protobuf-payload-converters.ts:178` through `packages/common/src/converter/protobuf-payload-converters.ts:183`, which temporarily assigns `globalThis.Buffer` when it is missing.
- `packages/common/src/converter/protobuf-payload-converters.ts:121` through `packages/common/src/converter/protobuf-payload-converters.ts:135`, where JSON protobuf serialization calls `proto3-json-serializer.toProto3JSON`.
- `packages/common/src/converter/protobuf-payload-converters.ts:139` through `packages/common/src/converter/protobuf-payload-converters.ts:151`, where JSON protobuf deserialization calls `proto3-json-serializer.fromProto3JSON`.

The same file imports `proto3-json-serializer` at module top level:

- `packages/common/src/converter/protobuf-payload-converters.ts:1`.

### Optional User Payload Protobuf Path

The default converter does not include protobuf converters:

- `packages/common/src/converter/payload-converter.ts:327` through `packages/common/src/converter/payload-converter.ts:336`.
- `packages/common/src/converter/payload-converter.ts:339` through `packages/common/src/converter/payload-converter.ts:348` document the default converter's JSON and `Uint8Array` support and point to protobuf support.

The protobuf-enabled converter composes protobuf JSON before protobuf binary:

- `packages/common/src/converter/protobuf-payload-converters.ts:229` through `packages/common/src/converter/protobuf-payload-converters.ts:241`.

The protobuf binary converter detects protobufjs messages by `$type`, derives a namespaced message type, and calls `value.$type.encode(value).finish()`:

- `packages/common/src/converter/protobuf-payload-converters.ts:89` through `packages/common/src/converter/protobuf-payload-converters.ts:97`.
- `packages/common/src/converter/protobuf-payload-converters.ts:192` through `packages/common/src/converter/protobuf-payload-converters.ts:207`.
- `packages/common/src/converter/protobuf-payload-converters.ts:209` through `packages/common/src/converter/protobuf-payload-converters.ts:215`.

Deserialization requires a protobufjs `Root`, looks up message types by metadata, and calls `messageType.decode(...)`:

- `packages/common/src/converter/protobuf-payload-converters.ts:37` through `packages/common/src/converter/protobuf-payload-converters.ts:62`.
- `packages/common/src/converter/protobuf-payload-converters.ts:100` through `packages/common/src/converter/protobuf-payload-converters.ts:105`.

Tests exercise binary protobuf payload conversion and JSON protobuf payload conversion:

- `packages/test/src/test-payload-converter.ts:89` through `packages/test/src/test-payload-converter.ts:107`.
- `packages/test/src/test-payload-converter.ts:137` through `packages/test/src/test-payload-converter.ts:173`.

The test custom payload converter imports `DefaultPayloadConverterWithProtobufs` and passes a patched protobufjs root:

- `packages/test/src/payload-converters/proto-payload-converter.ts:1` through `packages/test/src/payload-converters/proto-payload-converter.ts:7`.

### SDK Service Client Proto Path

`@temporalio/client` imports `@temporalio/proto` at runtime through `packages/client/src/types.ts`:

- `packages/client/src/types.ts:11`.
- `packages/client/src/types.ts:19` through `packages/client/src/types.ts:28` define request/response aliases from `proto`.
- `packages/client/src/types.ts:47` and nearby fields expose proto enum and message types on public interfaces.

The client connection creates protobufjs RPC service stubs:

- `packages/client/src/connection.ts:366` through `packages/client/src/connection.ts:407` call `WorkflowService.create`, `OperatorService.create`, `TestService.create`, and `HealthService.create`.
- `packages/client/src/connection.ts:501` through `packages/client/src/connection.ts:545` provide the `RPCImpl`.
- `packages/client/src/connection.ts:529` through `packages/client/src/connection.ts:537` pass already-encoded request data to `grpc.Client.makeUnaryRequest` with identity serializers/deserializers.

The Cloud Operations client follows the same service-stub pattern for `CloudService` and `HealthService`:

- `packages/cloud/src/types.ts:1` through `packages/cloud/src/types.ts:4`.
- `packages/cloud/src/cloud-operations-client.ts:345` through `packages/cloud/src/cloud-operations-client.ts:355`.

### Common Proto JSON Utilities

`packages/common/src/proto-utils.ts` imports `proto3-json-serializer`, imports all of `@temporalio/proto`, patches the root, and looks up History and Payload types at module load:

- `packages/common/src/proto-utils.ts:1` through `packages/common/src/proto-utils.ts:3`.
- `packages/common/src/proto-utils.ts:22` through `packages/common/src/proto-utils.ts:25`.

It then uses `fromProto3JSON`, `toProto3JSON`, `History.fromObject`, and `Payload.create`:

- `packages/common/src/proto-utils.ts:101` through `packages/common/src/proto-utils.ts:108`.
- `packages/common/src/proto-utils.ts:115` through `packages/common/src/proto-utils.ts:117`.
- `packages/common/src/proto-utils.ts:140` through `packages/common/src/proto-utils.ts:148`.

This file is a separate protobuf JSON utility path from the optional `DefaultPayloadConverterWithProtobufs` path.

### Workflow Bundle Boundary

There is an explicit regression test requiring workflow bundles to avoid `@temporalio/proto` sources:

- `packages/test/src/test-bundler.ts:190` through `packages/test/src/test-bundler.ts:227`.

The test comments state that pulling `@temporalio/proto` into a workflow bundle would be an unexpectedly large dependency or bundle-size signal. This is the clearest current boundary between workflow code and SDK protobuf runtime code.

### Upstream protobufjs Dynamic Code Generation

The upstream protobufjs runtime supports reflection and static code generation. The README describes runtime reflection and static code generation support. The source path used by reflection creates JavaScript source strings and finalizes them with `Function(...)`:

- `src/util/codegen.js` in protobufjs builds function bodies and returns `Function(source)()` or `Function.apply(...)`.
- `src/type.js` calls generator paths for constructor, encode, decode, verify, fromObject, and toObject setup.
- `src/encoder.js` and `src/decoder.js` build type-specific encoder/decoder functions through `util.codegen`.

This matters to the current repository because `packages/proto/protos/root.js` loads a protobufjs `json-module` root rather than a fully static runtime file. Reflection `Type` methods such as `.encode`, `.decode`, `.fromObject`, and `.create` are used throughout the SDK and tests.

### Current Alternative-Library Footprint

Local search found:

- No `@bufbuild/protobuf` dependency.
- No `protobuf-es` package name.
- No `@connectrpc/*` dependency.
- No `buf.gen.yaml`.
- No `protoc-gen-es`.
- No `ts-proto` or `protobuf-ts` package dependency.

The existing protobuf library survey mentions `google-protobuf`, `ts-proto`, and `protoc-gen-ts`, but not `@bufbuild/protobuf` or Protobuf-ES. Buf appears only in `packages/testing/proto/Makefile` as a CLI install target for test proto tooling.

## Code References

- `README.md:63` through `README.md:89` - documented runtime support boundary.
- `packages/proto/package.json:24` through `packages/proto/package.json:30` - `@temporalio/proto` protobufjs dependencies.
- `packages/proto/scripts/compile-proto.ts:26` through `packages/proto/scripts/compile-proto.ts:60` - protobufjs CLI generation path.
- `packages/proto/protos/root.js:1` through `packages/proto/protos/root.js:9` - runtime root imports `protobufjs/light` and generated `json-module`.
- `docs/protobuf-libraries.md:50` through `docs/protobuf-libraries.md:54` - documented current user protobuf payload solution.
- `packages/common/src/converter/protobuf-payload-converters.ts:17` - direct `Function`-constructor pattern in local source.
- `packages/common/src/converter/protobuf-payload-converters.ts:79` through `packages/common/src/converter/protobuf-payload-converters.ts:153` - protobuf binary and JSON payload converter behavior.
- `packages/common/src/converter/protobuf-payload-converters.ts:229` through `packages/common/src/converter/protobuf-payload-converters.ts:241` - protobuf-enabled default converter composition.
- `packages/common/src/converter/payload-converter.ts:327` through `packages/common/src/converter/payload-converter.ts:336` - default converter excludes protobuf support.
- `packages/common/src/proto-utils.ts:1` through `packages/common/src/proto-utils.ts:25` - common proto JSON utilities import and patch `@temporalio/proto`.
- `packages/client/src/types.ts:11` - runtime import of `@temporalio/proto` in client types module.
- `packages/client/src/connection.ts:366` through `packages/client/src/connection.ts:407` - client service stubs from protobufjs service classes.
- `packages/client/src/connection.ts:501` through `packages/client/src/connection.ts:545` - client `RPCImpl` wiring.
- `packages/cloud/src/types.ts:1` through `packages/cloud/src/types.ts:4` - cloud service type/stub export from `@temporalio/proto`.
- `packages/test/src/test-bundler.ts:190` through `packages/test/src/test-bundler.ts:227` - workflow bundle regression boundary excluding `@temporalio/proto`.
- `packages/test/src/test-payload-converter.ts:89` through `packages/test/src/test-payload-converter.ts:173` - protobuf payload converter test coverage.

## Open Questions

- Which exact deployed Cloudflare Worker entry point fails: `@temporalio/client` only, a custom payload converter, `proto-utils`, `@temporalio/cloud`, or an attempted Temporal Worker runtime?
- Does the failing bundle execute protobuf code during Worker startup, request handling, or both?
- Is the deployment using Cloudflare's `allow_eval_during_startup` compatibility flag, and if so, does the observed failure occur outside startup?
- Which generated protobuf operations are exercised before failure: service stub creation, request encode, response decode, `fromObject`, `create`, `lookupType`, JSON conversion, or custom payload conversion?
- Is the application using protobuf payloads, or is protobufjs only present through SDK service definitions?
- Are package consumers relying on protobufjs message-instance detection via `$type`, or only on plain interfaces/types?
- Does the target Cloudflare deployment use Node.js compatibility mode, and which Node APIs are available in that configuration?
