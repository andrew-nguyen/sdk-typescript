# `@temporalio/proto`

[![NPM](https://img.shields.io/npm/v/@temporalio/proto?style=for-the-badge)](https://www.npmjs.com/package/@temporalio/proto)

Part of [Temporal](https://temporal.io)'s TypeScript SDK (see [docs](https://docs.temporal.io/typescript/introduction/) and [samples](https://github.com/temporalio/samples-typescript)).

You should usually not be using this package directly. Instead use:

- [`@temporalio/client`](https://typescript.temporal.io/api/namespaces/client)
- [`@temporalio/worker`](https://typescript.temporal.io/api/namespaces/worker)
- [`@temporalio/workflow`](https://typescript.temporal.io/api/namespaces/workflow)
- [`@temporalio/activity`](https://typescript.temporal.io/api/namespaces/activity)

## Generated runtime

This fork ships SDK protos as protobufjs `static-module` output in `protos/static-module.js`, wrapped by
`protos/root.js` to preserve the public `@temporalio/proto` facade. The wrapper keeps namespace exports,
message statics, service `.create(...)`, and `lookupType`/`lookupService` helpers available without loading the
protobufjs reflection runtime on client-facing paths.

Regenerate the runtime and declarations with:

```bash
pnpm --filter @temporalio/proto run build
```

After regeneration, run:

```bash
pnpm -C packages/test exec ava ./lib/test-cloudflare-protobuf-no-eval.js
```

That test verifies the exported facade and scans Cloudflare-targeted proto/client/common/cloud outputs for runtime
string-code-generation patterns.
