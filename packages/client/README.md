# `@temporalio/client`

[![NPM](https://img.shields.io/npm/v/@temporalio/client?style=for-the-badge)](https://www.npmjs.com/package/@temporalio/client)

Part of [Temporal](https://temporal.io)'s [TypeScript SDK](https://docs.temporal.io/typescript/introduction/).

- [Client docs](https://docs.temporal.io/typescript/clients)
- [API reference](https://typescript.temporal.io/api/namespaces/client)
- [Sample projects](https://github.com/temporalio/samples-typescript)

## Cloudflare Workers client path

This fork includes a Cloudflare Workers-compatible client subpath for application code that needs the high-level
Temporal client API in a Worker:

```ts
import { Client, CloudflareConnection } from '@temporalio/client/cloudflare';

export default {
  async fetch(_request, env) {
    const connection = await CloudflareConnection.connect({
      bridgeUrl: env.TEMPORAL_BRIDGE_URL,
      address: env.TEMPORAL_ADDRESS,
      tls: true,
      apiKey: env.TEMPORAL_API_KEY,
    });
    const client = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });
    const systemInfo = await client.connection.workflowService.getSystemInfo({});

    return Response.json({ systemInfo });
  },
};
```

The subpath preserves the normal `Client` surface and uses an explicit `CloudflareConnection`. It does not export the
Node `Connection` class or the grpc-js retry interceptor adapter, and its import tests block `@grpc/grpc-js` and
`node:http2`.

### Bridge contract

Cloudflare Workers cannot use the SDK's Node grpc-js transport directly. The first supported Worker transport sends
unary protobuf requests over HTTPS `fetch` to a bridge endpoint. The bridge then forwards to Temporal Cloud or
self-hosted Temporal using a native gRPC-capable runtime.

The Worker sends a JSON request envelope:

```json
{
  "version": 1,
  "serviceName": "temporal.api.workflowservice.v1.WorkflowService",
  "methodName": "GetSystemInfo",
  "request": "<base64 protobuf request bytes>",
  "metadata": [{ "key": "Authorization", "value": "Bearer <api-key>" }],
  "deadline": "2026-06-14T12:00:00.000Z",
  "target": { "address": "<temporal-endpoint>", "tls": true }
}
```

A successful bridge response is:

```json
{ "response": "<base64 protobuf response bytes>" }
```

A service error response is:

```json
{
  "error": {
    "code": 5,
    "message": "namespace not found",
    "details": "namespace not found",
    "metadata": [{ "key": "grpc-status-details-bin", "value": "<base64 details>", "binary": true }]
  }
}
```

### Limitations

Cloudflare compatibility applies to `@temporalio/client` only. Running Temporal Workers, Activities, Workflow sandbox
code, Nexus Operations, or the Node-native Worker runtime inside Cloudflare Workers is out of scope.

The Cloudflare connection path does not support grpc-js `credentials`, `callCredentials`, `channelArgs`, interceptors,
or mTLS client certificates. Use bridge-side configuration for native gRPC details that cannot be represented in the
Worker request envelope.

### Manual verification checklist

1. Deploy or run an HTTPS bridge that accepts the envelope above and forwards unary requests with Node `@grpc/grpc-js`.
2. Deploy a Cloudflare Worker with the compatibility flags required by your bundle, typically `nodejs_compat`.
3. Import from `@temporalio/client/cloudflare` and construct `CloudflareConnection.connect({ bridgeUrl, address, tls: true, apiKey })`.
4. Call `client.connection.workflowService.getSystemInfo({})` against a real Temporal endpoint.
5. Start a short workflow through `client.workflow.start` in a controlled namespace.
6. Confirm API key auth, custom metadata, deadline failure, abort cancellation, retryable bridge failure, and `NamespaceNotFoundError` mapping.
