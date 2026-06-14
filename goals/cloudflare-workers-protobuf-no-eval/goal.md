# Cloudflare Workers Protobuf Eval Compatibility

Move this Temporal TypeScript SDK fork away from protobuf runtime dynamic code generation on Cloudflare-targeted client paths. The implementation should remove or isolate protobufjs reflection/eval behavior for `@temporalio/client`, relevant `@temporalio/common` proto utilities, and `@temporalio/cloud`, while preserving exported APIs so the fork remains a drop-in replacement for the official SDK.

Use `facts.md` as the accepted shared understanding for scope, compatibility requirements, and verification expectations.

Use `plan.md` as the approved execution plan.

Done means the accepted facts are satisfied, the approved plan's verification checks pass, Cloudflare-targeted protobuf paths avoid runtime string code generation during request handling, and fork-specific divergence is documented in a way that keeps upstream rebases manageable.
