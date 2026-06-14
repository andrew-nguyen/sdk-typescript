# Facts

- The first output of this goal is a decision-ready implementation plan, not immediate feature implementation.
- The plan must identify whether the best path forward is at the protobuf layer, the gRPC/transport layer, or a small combination of both.
- The plan must evaluate gRPC-Web neutrally as one option among several paths, without assuming it is the solution or excluding it before the decision analysis.
- The compatibility target is @temporalio/client plus the @temporalio/proto and @temporalio/common code paths required by that client surface.
- Running Temporal Workers, Activities, Workflow sandbox code, Nexus Operations, or the Node-native Worker runtime inside Cloudflare Workers is out of scope.
- The high-level @temporalio/client API must remain unchanged for application code that already uses Temporal client workflows.
- The implementation path must keep this fork easy to rebase onto upstream by isolating fork-specific changes and avoiding broad rewrites of client APIs or generated protobuf surfaces.
- The existing static-protobuf work must be evaluated as the current protobuf baseline and preserved if it solves the no-eval requirement without excessive upstream divergence.
- Cloudflare-targeted client import and request paths must not rely on eval, new Function, Function constructors, or protobuf runtime reflection code generation.
- The plan must investigate the current gRPC blockers in @temporalio/client, including @grpc/grpc-js, node:async_hooks, connection construction, retry helpers, metadata, deadlines, aborts, and service error mapping.
- The chosen path must preserve metadata, API key authorization, deadlines or timeouts, abort cancellation, retry behavior, and service error helper compatibility for supported unary client RPCs.
- Automated verification must include a Worker-safe import or bundle check proving the Cloudflare-targeted client path does not load @grpc/grpc-js or other Node gRPC transport code.
- Automated verification must include focused tests for whichever protobuf and transport path the plan selects, plus relevant package build checks.
- The final plan must include a manual end-to-end verification path for a real Cloudflare-compatible Temporal client connection, even if CI cannot run that check.
