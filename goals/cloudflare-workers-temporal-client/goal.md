# Goal: Cloudflare Workers Temporal Client Compatibility

Enable this Temporal TypeScript SDK fork to support a Cloudflare Workers-compatible `@temporalio/client` path that can be used as a drop-in high-level client for existing Temporal client application code. The first required output is a decision-ready implementation path that determines whether the right fix belongs at the protobuf layer, the gRPC/transport layer, or a small combination of both; the plan must keep fork-specific changes isolated so they remain easy to rebase onto upstream.

Use `facts.md` as the shared understanding for scope, constraints, and verification requirements.

Use `plan.md` as the approved execution plan. Start with the neutral decision matrix before implementing a transport path, and treat gRPC-Web as one candidate option rather than a premise.

Done when the selected path is documented, implemented behind the unchanged high-level client surface where in scope, verified by Worker-safe import/bundle checks that do not load Node gRPC code, covered by focused protobuf/transport tests and package build checks, and accompanied by a manual Cloudflare-compatible Temporal client connection checklist.
