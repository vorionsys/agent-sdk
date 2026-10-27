# @vorionsys/agent-sdk

## 0.2.0

### Minor Changes

- 574ff99: **Breaking:** `serverUrl` is now required, and the SDK no longer has a default server.

  Before this release, leaving out `serverUrl` connected to `wss://api.aurais.ai/ws`
  with your API key in the connection URL. That host does not resolve today, so
  whoever controls the domain could start receiving keys at any time. Now `new AuraisAgent()` throws
  unless you pass an absolute `wss` URL (plain `ws` is accepted for `localhost`
  and `127.0.0.1` only).

  To upgrade, pass the URL of the server you actually run:

  ```ts
  new AuraisAgent({ apiKey, serverUrl: "wss://your-aurais-server.example/ws" });
  ```

## 0.1.2

### Patch Changes

- e85a5d3: Extract `agent-sdk` into its own standalone repository (`vorionsys/agent-sdk`) with tokenless OIDC trusted publishing + provenance. Relicensed Apache-2.0. (Package name unchanged; a future rebrand to `@vorionsys/aurais-agent-sdk` is tracked separately.)

## 0.1.0

- Initial release
- TypeScript SDK for connecting AI agents to Aurais Mission Control
- WebSocket-based real-time communication
- Event-driven architecture with EventEmitter3
