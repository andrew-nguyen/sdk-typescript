# Suggested Commands

- Install dependencies: `pnpm install --frozen-lockfile`.
- Full build: `pnpm build`.
- Clean rebuild: `pnpm run rebuild`.
- Regenerate protobuf artifacts only: `pnpm run build:protos` or `pnpm -F @temporalio/proto run build:protos`.
- Build a package: `pnpm -F @temporalio/client run build`, `pnpm -F @temporalio/proto run build`, or `pnpm -F <package>... run build` when dependencies must build too.
- Full test suite: `pnpm test`; tests generally assume a local Temporal dev server.
- Test package harness directly: `pnpm ava` from root, or `pnpm -C packages/test exec ava <test-file>`.
- Lint/format check: `pnpm run lint:check`.
- Autoformat/lint fix: `pnpm run lint` or `pnpm run format` depending on scope.