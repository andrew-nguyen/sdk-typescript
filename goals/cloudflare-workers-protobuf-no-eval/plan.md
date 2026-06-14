# Cloudflare Workers Protobuf Eval Compatibility Plan

## Solution Approach

Make `@temporalio/proto` remain the public contract, but stop shipping a protobufjs reflection `json-module` root as the runtime implementation for Cloudflare-targeted paths. The lowest-churn path is to use the protobufjs `static-module` output that this repo already generates temporarily for declarations, promote it to the runtime artifact, and add only the compatibility shims needed to preserve existing exports, service `.create(...)` behavior, message static methods, enum objects, and any `lookupType` use.

Keep a full Protobuf-ES migration as a fallback or narrow internal helper, not the first move. Current Protobuf-ES docs confirm static schema-based `create`, `toBinary`, `fromBinary`, JSON helpers, and service descriptors, but services do not include an RPC transport. A direct migration would create more facade work than protobufjs static output and would be harder to rebase against upstream.

## Ordered Steps

1. Establish baseline compatibility and failing checks.
   - Touch: `packages/proto/scripts/compile-proto.ts`, `packages/proto/protos/index.js`, `packages/proto/protos/index.d.ts`, `packages/proto/protos/root.js`, `packages/client/src/types.ts`, `packages/client/src/connection.ts`, `packages/cloud/src/types.ts`, `packages/cloud/src/cloud-operations-client.ts`, `packages/common/src/proto-utils.ts`, `packages/common/src/converter/protobuf-payload-converters.ts`, `packages/test/src/test-bundler.ts`, new focused tests under `packages/test/src/`.
   - Add a runtime contract test for exported protobuf APIs used by client-facing packages:
     - `import * as proto from '@temporalio/proto'` and default import both work.
     - `temporal`, `google`, `grpc`, and `coresdk` namespaces exist.
     - representative message statics still exist: `.create`, `.encode(...).finish()`, `.decode`, `.fromObject`, and `.toObject` where currently exposed.
     - representative service statics still work: `WorkflowService.create`, `OperatorService.create`, `TestService.create`, `CloudService.create`, and `Health.create`.
     - service wrappers call the provided `RPCImpl` with protobufjs-compatible method metadata containing the method name and encoded request bytes.
   - Add a Cloudflare-style red test that imports and exercises `@temporalio/proto`, `@temporalio/common/lib/proto-utils`, and `@temporalio/cloud` in an environment where string code generation is disallowed. Prefer `workerd` or Miniflare if added; otherwise use a bundled Node `vm` smoke test with `codeGeneration: { strings: false }`.
   - Add a static scan test or script for Cloudflare-targeted outputs that fails on `eval(`, `new Function`, `Function(`, and `constructor.constructor`, with explicit allowlists only for out-of-scope worker runtime files.
   - Verification: these new checks should fail on the current reflection root and direct Buffer shim before implementation.

2. Promote protobufjs static-module output to the `@temporalio/proto` runtime.
   - Touch: `packages/proto/scripts/compile-proto.ts`, `packages/proto/protos/root.js`, generated files under `packages/proto/protos/`, `packages/proto/package.json`, and possibly `pnpm-lock.yaml`.
   - Change the proto build to emit a static runtime artifact instead of using `json-module.js` plus `protobufjs/light` reflection at runtime. Keep generated files isolated under `packages/proto/protos/` so upstream proto changes remain a normal regeneration.
   - Keep `packages/proto/protos/index.js` exporting `./root` and keep `packages/proto/protos/index.d.ts` exporting `./root` so package entry points remain unchanged.
   - Remove the runtime path through `protobufjs/light`, `@protobufjs/codegen`, and reflection `Type` code generation from `@temporalio/proto`.
   - If `protobufjs/minimal` remains as a static runtime dependency, verify by scan and smoke test that it does not invoke string code generation in the shipped path.
   - Verification: `pnpm --filter @temporalio/proto run build`; dynamic-code scan against `packages/proto/protos` and built `packages/proto/lib`; contract test for message and service statics.

3. Preserve protobufjs-like facade behavior without broad call-site churn.
   - Touch: `packages/proto/protos/root.js`, optional generated compatibility helpers under `packages/proto/protos/compat/`, `packages/proto/src/patch-protobuf-root.ts`.
   - If static-module output already preserves service classes and message statics, keep `packages/client` and `packages/cloud` source unchanged except for erased type imports if needed.
   - If static-module output does not provide `lookupType`, generate a small registry keyed by fully qualified type name that returns the corresponding static message constructor or descriptor.
   - If static-module output does not provide protobufjs-compatible services, generate service wrappers with `.create(rpcImpl, false, false)` that serialize requests with the static message encoder, call `rpcImpl(method, requestData, callback)`, and decode responses with the static message decoder.
   - Keep `patchProtobufRoot` exported for downstream users. Make it handle both legacy protobufjs reflection roots and the new static facade, or make it a documented no-op for the static facade while preserving current behavior for user-supplied legacy roots.
   - Verification: no client/cloud service call-site rewrites unless the contract test proves they are necessary; TypeScript builds for `@temporalio/client`, `@temporalio/cloud`, `@temporalio/common`, and `@temporalio/worker` still pass.

4. Replace `@temporalio/common` SDK proto JSON utilities with eval-free helpers.
   - Touch: `packages/common/src/proto-utils.ts`, `packages/common/package.json`, `packages/test/src/test-proto-utils.ts`, new golden JSON fixtures if needed.
   - Remove the module-load `patchProtobufRoot(proto).lookupType(...)` dependency from `proto-utils`.
   - Reimplement `historyFromJSON`, `historyToJSON`, `payloadToJSON`, and `JSONToPayload` using static generated constructors and an eval-free JSON conversion path.
   - First try protobufjs static-module `fromObject`/`toObject` with explicit options for enums, longs, bytes, and defaults, preserving the existing enum casing and null payload fixes.
   - If static protobufjs JSON conversion cannot match current proto3 JSON behavior, use a narrow internal Protobuf-ES-generated schema/helper only for these JSON utilities while keeping public SDK exports unchanged.
   - Keep existing behavior covered by `test-proto-utils.ts`, especially history enum conversion and null payload data.
   - Verification: `pnpm --filter @temporalio/common run build`; `pnpm -C packages/test exec ava ./lib/test-proto-utils.js`; Cloudflare-style smoke test imports and exercises these utilities without string code generation.

5. Assess and isolate optional protobuf payload converters.
   - Touch: `packages/common/src/converter/protobuf-payload-converters.ts`, `packages/common/src/protobufs.ts`, `docs/protobuf-libraries.md`, `packages/test/src/test-payload-converter.ts`.
   - Remove the direct `globalThis.constructor.constructor('return globalThis.Buffer')()` pattern.
   - Keep `DefaultPayloadConverterWithProtobufs`, `ProtobufJsonPayloadConverter`, and `ProtobufBinaryPayloadConverter` exports unchanged.
   - Decide after implementation spike whether the legacy protobufjs-root converter can be Cloudflare-safe:
     - If yes, support only eval-free/static roots and add tests that cover that supported input shape.
     - If no, document that legacy protobufjs roots remain supported for Node-style environments but are outside the Cloudflare must-pass scope, and add a test that importing the module itself no longer triggers string code generation.
   - Preserve the default payload converter behavior that excludes protobuf converters from ordinary workflow bundles.
   - Verification: `pnpm -C packages/test exec ava ./lib/test-payload-converter.js`; dynamic-code scan includes `packages/common/src/converter/protobuf-payload-converters.ts` and built output.

6. Keep workflow bundle boundaries intact.
   - Touch: `packages/test/src/test-bundler.ts` only if the test needs to include new generated paths in its diagnostics.
   - Ensure the static protobuf runtime is not accidentally imported by `@temporalio/workflow` runtime code.
   - Keep type-only imports from `@temporalio/proto` type-only.
   - Verification: `pnpm -C packages/test exec ava ./lib/test-bundler.js`; the existing source-map assertion still reports no `@temporalio/proto` sources in standard workflow bundles.

7. Update docs and fork divergence notes.
   - Touch: `docs/protobuf-libraries.md`, `packages/proto/README.md`, and a short fork note if the repo has an established location for fork-specific changes.
   - Document that SDK service protos use static generated runtime code for Cloudflare compatibility.
   - Document the optional protobuf payload converter decision from step 5.
   - Document how to regenerate protos and how to rerun the Cloudflare eval checks.
   - Verification: docs mention the new generator/runtime path and no longer describe `json-module` reflection as the shipped SDK proto runtime.

8. Run final verification.
   - Build:
     - `pnpm --filter @temporalio/proto run build`
     - `pnpm --filter @temporalio/common run build`
     - `pnpm --filter @temporalio/client run build`
     - `pnpm --filter @temporalio/cloud run build`
     - `pnpm --filter @temporalio/test run build`
   - Focused tests:
     - `pnpm -C packages/test exec ava ./lib/test-proto-utils.js`
     - `pnpm -C packages/test exec ava ./lib/test-payload-converter.js`
     - `pnpm -C packages/test exec ava ./lib/test-bundler.js`
     - `pnpm -C packages/test exec ava ./lib/test-cloudflare-protobuf-no-eval.js`
   - Static scan:
     - run the new no-dynamic-codegen script against built `packages/proto`, `packages/common`, `packages/client`, and `packages/cloud` outputs.
   - Full confidence pass:
     - `pnpm run build`
     - targeted test suite above again after full build.

## Risks And Open Questions

- `@temporalio/client` and `@temporalio/cloud` also depend on Node-oriented pieces such as `@grpc/grpc-js` and `node:async_hooks`. This plan addresses the protobuf eval blocker only; a true end-to-end Cloudflare transport smoke test may reveal non-protobuf blockers.
- protobufjs static-module output is expected to avoid runtime code generation, but the implementation must prove that by inspecting generated output and running the no-codegen smoke test.
- `proto3-json-serializer` is tied to protobufjs reflection metadata. Replacing it without JSON behavior drift is the highest behavioral-risk area.
- The exported API compatibility bar is strict. Any missing generated static, namespace, service, enum, default import, or type alias must be treated as a blocker, not a downstream migration task.
- Optional user protobuf roots are likely the hardest part to make Cloudflare-safe because protobufjs reflection can be introduced by user-generated roots. The plan intentionally allows documenting that as outside must-pass scope if the SDK module itself no longer triggers dynamic code generation.
- Startup-only `allow_eval_during_startup` is allowed if it materially simplifies the solution, but the preferred implementation should not need it for protobuf code paths.
- This checkout currently has no `node_modules` or built `lib` directories, so implementation will need dependency installation before verification commands can run.
