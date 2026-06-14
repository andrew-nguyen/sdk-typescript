# Core

- Temporal TypeScript SDK monorepo; upstream repository metadata points at `temporalio/sdk-typescript`.
- Workspace packages are declared in `pnpm-workspace.yaml`; major SDK packages live under `packages/` and contrib integrations under `contrib/`.
- Read `mem:tech_stack` for package manager, runtime, and dependency pins.
- Read `mem:conventions` for repo-specific development constraints and boundaries.
- Read `mem:suggested_commands` for common build/test/lint commands.
- Read `mem:task_completion` before claiming code changes are done.
- Client-level runtime support is distinct from Worker-level runtime support: README says `@temporalio/client` is believed to work in server-side JS environments including Cloudflare Workers, while Worker-level features rely on Node-specific APIs and are discouraged outside authentic Node.js.
- `packages/proto` is `@temporalio/proto`; `packages/client` is `@temporalio/client`; `packages/common` provides shared converters/proto utilities used by client and worker surfaces.