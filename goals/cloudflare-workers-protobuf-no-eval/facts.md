# Facts

- The Cloudflare Workers compatibility target is the client-facing SDK surface: `@temporalio/client`, the `@temporalio/common` proto utilities used by that path, and `@temporalio/cloud`.
- The Node-native `@temporalio/worker` runtime is out of scope for Cloudflare Workers compatibility.
- Cloudflare-targeted protobuf paths must not call `eval`, `new Function`, `Function(...)`, or indirect `Function` constructors at module load time or request handling time.
- The implementation should use a staged static generated protobuf implementation behind the existing `@temporalio/proto` facade instead of relying on protobufjs runtime reflection code generation.
- The implementation may use Cloudflare's startup-only `allow_eval_during_startup` compatibility flag if it materially simplifies the solution, but Cloudflare-targeted request handling must still avoid runtime dynamic code generation.
- Every exported API must remain unchanged so this fork is a drop-in replacement for the official SDK and downstream users do not need to modify their code.
- Private generated internals, protobuf build scripts, and adapter implementation details may change when the public facade remains stable.
- The existing workflow bundle boundary that keeps `@temporalio/proto` out of workflow bundles must remain enforced.
- The optional protobuf payload converter path must be assessed, with the final implementation either making it Cloudflare-safe for supported inputs or documenting and testing it as outside the must-pass Cloudflare scope.
- Upstream mergeability should be protected by narrow source edits, an isolated generated layer, adapters instead of broad call-site churn, and documentation of fork-specific divergence.
- Verification must include focused unit tests, package build checks, a Cloudflare-style smoke test where dynamic code generation is disallowed, and a scan for dynamic code generation patterns in Cloudflare-targeted output.
