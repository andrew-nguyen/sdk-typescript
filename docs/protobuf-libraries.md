Loren & Roey surveyed the available protobuf libraries in Dec '21 for use with our `ProtobufBinaryDataConverter` and `ProtobufJsonDataConverter`. The main criteria was:

- A. TypeScript types for messages
- B. Being able to check at runtime whether an object passed to the SDK as input or returned to the SDK from a workflow/query/activity is meant to be protobuf-serialized, without adding annotations to the functions.
- C. Spec-compliant [proto3 JSON encoding](https://developers.google.com/protocol-buffers/docs/proto3#json) so that the TS SDK is interoperable with the other SDKs

## Options

### protobufjs

A and B, but not C.

- Most popular lib (5M downloads/wk)
- Fairly inactive maintainers (infrequent updates, many open PRs & issues)
- [Non-standard](https://github.com/protobufjs/protobuf.js/issues/1304) JSON serialization
- Message classes with generated types and runtime-checkable instances

### proto3-json-serializer

C

- Adds spec-compliant JSON encoding to protobufjs
- Maintained by responsive Googlers, 900k downloads/wk
- Requires runtime-loaded messages (not compatible with generated classes)

### google-protobuf

B

- Official Google lib, 800k downloads/wk
- No types or JSON encoding
- Compiler installed separately (not on npm)

### ts-proto

A and some of C

- Generates TS interfaces and encoding functions
- Designed for POJOs (no instances of message classes), so can't do B
- JSON encoding is probably [not yet fully spec compliant](https://github.com/stephenh/ts-proto/pull/448#issuecomment-998166664)

### protoc-gen-ts

A and B

- Plugin for Google's `protoc` compiler
- Generated classes extend `google-protobuf`'s Message, but doesn't add JSON
- Maintainer [seems interested in JSON encoding](https://github.com/protocolbuffers/protobuf/issues/4540#issuecomment-915609405), but isn't there yet (only has `to/fromObject` methods—need eg a fromJSON that converts the below base64 to a bytearray, and a toJSON that converts a bytearray to base64)

## Current solution

- The SDK service protos in `@temporalio/proto` ship a `protobufjs` `static-module` runtime generated as `packages/proto/protos/static-module.js`.
- `packages/proto/protos/root.js` wraps that generated static root with `patchProtobufRoot()` so existing namespace exports, message statics, service `.create(...)`, and `lookupType`/`lookupService` style helpers remain available.
- This fork intentionally does not ship the SDK proto runtime through `json-module` + `protobufjs/light`; Cloudflare-targeted client paths must be able to import and exercise SDK protos without runtime string code generation.
- Optional user protobuf payload converters still accept legacy protobufjs roots. Those user-supplied roots may use protobufjs reflection in Node-style environments, but the SDK converter module itself must import without `eval`, `new Function`, or `constructor.constructor`.
- The protobuf JSON payload converter uses protobufjs `toObject`/`fromObject` with base64 bytes for user protobuf messages rather than a global `Buffer` lookup through dynamic code generation.

```ts
// static-module.js generated with:
// pbjs -t static-module -w commonjs -o static-module.js *.proto

// protos/root.js
const { patchProtobufRoot } = require('@temporalio/common');
const unpatchedRoot = require('./static-module');
module.exports = patchProtobufRoot(unpatchedRoot);

// root.d.ts generated with:
// pbjs -t static-module *.proto | pbts -o root.d.ts -

// src/payload-converter.ts
import { DefaultPayloadConverterWithProtobufs } from '@temporalio/common/lib/protobufs';
import root from '../protos/root';

export const payloadConverter = new DefaultPayloadConverterWithProtobufs({ protobufRoot: root });

// src/worker.ts
const worker = Worker.create({ dataConverter: { payloadConverterPath: require.resolve('./payload-converter') }, ... });

// src/client.ts
import { foo } from '../protos/root';
import { dataConverter } from './payload-converter';

const client = new WorkflowClient(connection.service, {
  dataConverter: { payloadConverterPath: require.resolve('./payload-converter') }
});

await client.start(protoWorkflow, {
  args: [foo.bar.ProtoInput.create({ name: 'Proto', age: 1 })], // can't use `new foo.bar.ProtoInput()`
  taskQueue: 'tutorial',
  workflowId: 'my-business-id',
});

// src/workflows.ts
import { foo } from '../protos/root';

export async function protoWorkflow(input: foo.bar.ProtoInput): Promise<foo.bar.ProtoResult> {
  return foo.bar.ProtoResult.create({ sentence: `Name is ${input.name}` });
}
```

Regenerate SDK protos with:

```bash
pnpm --filter @temporalio/proto run build
```

Run the focused Cloudflare protobuf eval checks with:

```bash
pnpm --filter @temporalio/proto run build
pnpm --filter @temporalio/common run build
pnpm --filter @temporalio/client run build
pnpm --filter @temporalio/cloud run build
pnpm --filter @temporalio/test run build
pnpm -C packages/test exec ava ./lib/test-cloudflare-protobuf-no-eval.js
```

The focused test covers the exported proto facade contract, a Cloudflare-style no-string-codegen smoke test for `@temporalio/proto`, `@temporalio/common/lib/proto-utils`, and `@temporalio/cloud`, and a static scan of Cloudflare-targeted source/build outputs.

We originally were thinking of this, but the namespaces in `json-module.js` get lost through `patchProtobufRoot()`:

```ts
import * as generatedRoot from '../protos/json-module';

const patchProtobufRoot = <T>(x: T): T => x;
const root = patchProtobufRoot(generatedRoot);

function myWorkflowError(input: root.foo.bar.ProtoActivityInput) {
  return input.name;
}
```

On root in `root.foo.bar.ProtoActivityInput`, TS errors: `Cannot find namespace 'root'.`

## Future work

If we can get changes merged into `protobufjs` (or want to fork), we can do one or both of the below:

1. Change the `json-module` output to not have `nested` attributes so we don't have to patch
2. Add to the generated classes:

- spec-compliant `to/fromJSON` methods
- `typename` field that includes the namespace (eg `"foo.bar.MyMessage"`)
- "this is a generated file" comment @ top
