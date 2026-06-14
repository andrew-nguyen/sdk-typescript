# Tech Stack

- Package manager: pnpm, workspace-managed. Root `package.json` requires `pnpm >= 10.27.0`; `pnpm-workspace.yaml` sets `ignoreScripts: true` and a two-week `minimumReleaseAge` except for `@temporalio/*` and `nexus-rpc`.
- Runtime support: official Node support is Node 20, 22, and 24. Root `package.json` engines require Node >=20 and Rust >=1.53.0.
- Language/tooling: TypeScript 5.6.x, tsx for scripts, ESLint 9, Prettier 3, commitlint 20.
- Native/core pieces: `packages/core-bridge` includes Rust and SDK Core submodule content; full builds can compile Rust/native artifacts.
- Protobuf stack: `@temporalio/proto` depends on `protobufjs` 7.5.8 and `long`; root pnpm config patches `protobufjs@7.5.8` via `patches/protobufjs@7.5.8.patch`; proto generation uses `protobufjs-cli` from `packages/proto/scripts/compile-proto.ts`.
- Client transport: `@temporalio/client` depends on `@grpc/grpc-js`, `@temporalio/common`, `@temporalio/proto`, `abort-controller`, `long`, `nexus-rpc`, and `uuid`.