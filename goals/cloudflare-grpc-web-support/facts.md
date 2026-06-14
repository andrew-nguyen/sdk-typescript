# Facts

- The goal adds a Cloudflare Workers-compatible @temporalio/client connection path that uses fetch-compatible gRPC-Web instead of @grpc/grpc-js.
- The Cloudflare-compatible path is a drop-in replacement for existing Temporal SDK client users after connection construction; existing Client APIs should continue to work without application workflow code changes.
- The implementation should remain easy to rebase against upstream by keeping changes isolated to transport and connection creation rather than rewriting broad client APIs or generated protobuf surfaces.
- The gRPC-Web transport targets a gRPC-Web compatible endpoint; before development, the plan must verify whether direct Temporal Server or Temporal Cloud endpoints support gRPC-Web and otherwise document the proxy requirement.
- Running Temporal Workers, Activities, Workflow sandbox code, or Nexus Operations inside Cloudflare Workers is out of scope.
- A full protobuf runtime migration is out of scope unless a small protobuf change is strictly required for the Cloudflare-safe client transport or import path.
- The first pass supports unary client RPCs used by @temporalio/client service stubs and does not add new streaming or Worker-polling behavior.
- The gRPC-Web path preserves static metadata and API key authorization headers.
- The gRPC-Web path preserves deadline or timeout behavior and abort cancellation where fetch-compatible runtimes support it.
- The gRPC-Web path maps gRPC-Web response status, trailers, and network failures into the SDK's existing service error shape closely enough for retry and error helpers to keep working.
- Automated verification includes transport unit tests for encoding, decoding, metadata, deadlines or aborts, and error mapping.
- Automated verification includes a Worker-bundle smoke test proving the Cloudflare-safe entry path imports without @grpc/grpc-js or other Node gRPC dependencies.
- The final documentation includes a manual end-to-end check against a gRPC-Web compatible Temporal endpoint when CI cannot provide a real endpoint.
