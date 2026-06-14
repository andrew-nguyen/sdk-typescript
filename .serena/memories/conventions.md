# Conventions

- All `@temporalio/*` packages in a consumer project must use the same version; README notes this is usually enforced by peer dependencies but can need care in complex monorepos.
- Prefer narrow package-boundary changes because the repo is an upstream Temporal SDK fork/monorepo; broad rewrites increase rebase cost.
- Generated protobuf artifacts live under `packages/proto/protos/`; source protos come from `packages/core-bridge/sdk-core/crates/common/protos/...`.
- Root lint script fixes with ESLint and Prettier, then runs recursive package lint scripts; use `lint:check` for non-mutating validation.
- Workflow bundle size and Node dependency boundaries are important: existing tests protect against unexpectedly pulling `@temporalio/proto` sources into workflow bundles.
- Do not assume Worker-level features are intended to run on Cloudflare Workers; README only makes the Cloudflare Workers statement for client-level features.