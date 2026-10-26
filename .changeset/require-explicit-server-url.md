---
"@vorionsys/agent-sdk": minor
---

**Breaking:** `serverUrl` is now required, and the SDK no longer has a default server.

Before this release, leaving out `serverUrl` connected to `wss://api.aurais.ai/ws`
with your API key in the connection URL. That host does not resolve today, so
whoever controls the domain could start receiving keys at any time. Now `new AuraisAgent()` throws
unless you pass an absolute `wss` URL (plain `ws` is accepted for `localhost`
and `127.0.0.1` only).

To upgrade, pass the URL of the server you actually run:

```ts
new AuraisAgent({ apiKey, serverUrl: "wss://your-aurais-server.example/ws" });
```
