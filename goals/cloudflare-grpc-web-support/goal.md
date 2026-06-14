# Cloudflare gRPC-Web Client Support

Enable `@temporalio/client` usage from Cloudflare Workers by adding a fetch-compatible gRPC-Web client connection path for unary service RPCs. The change should preserve the existing high-level `Client` API after connection construction, keep the Node gRPC path intact, and stay easy to rebase against upstream by isolating transport changes.

The shared understanding is captured in [facts.md](facts.md). The approved execution plan is captured in [plan.md](plan.md).

Done means the accepted facts are implemented, automated verification for the facts marked with automated verification passes, endpoint/proxy requirements are documented, and a manual end-to-end check path exists for a real gRPC-Web compatible Temporal endpoint.
