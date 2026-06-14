# Task Completion

- For source changes that affect TypeScript packages, run a focused package build first, e.g. `pnpm -F @temporalio/client run build` or `pnpm -F @temporalio/proto run build`.
- For protobuf generation changes, run `pnpm run build:protos` and inspect generated artifacts before broader builds.
- For cross-package changes, run `pnpm build` when feasible; note that full build can be expensive because it includes protobuf/native/Rust bridge work.
- Run focused tests for touched behavior; root `pnpm test` is broad and assumes a local Temporal server.
- Run `pnpm run lint:check` before finalizing code changes when feasible; use `pnpm run lint` only when intentional formatting/fixing is acceptable.
- When implementing Cloudflare Worker compatibility, include a Worker-style/no-dynamic-eval verification path if the change claims Workers support.