# Remote HTTP MCP, auth, and approval UX

## What changed

- Added a remote MCP server endpoint at `/mcp` using Streamable HTTP JSON response mode.
- Added bearer-token authentication via `config/remote-auth.json`.
- Added approval-request lifecycle with browser approval pages.

## Why this matters

`stdio` is good for local process-spawned MCP servers. Remote MCP deployments should use HTTP-based transports so clients can connect over the network.

## Demo auth model

This repo uses demo bearer tokens. That is good enough to prove server-side enforcement and approval routing. It is not a replacement for a production OAuth/IdP flow.

## Approval UX

When a plan is marked as requiring approval, the server creates an approval request and returns an approval URL. An approver opens the page, authenticates with an approver token, and approves or rejects the request.

## Next production step

Replace the demo bearer-token middleware with MCP transport-level authorization backed by your enterprise IdP, and replace the simple approval page with a proper approval service or client-side elicitation flow.


## Temporary no-auth mode for VS Code demos

For the current demo setup, bearer auth is disabled in `config/fabric-config.json` by setting `remoteHttp.requireBearerAuth` to `false`. This makes the remote server easier to connect from VS Code while you validate the MCP flow.

VS Code configuration is in `.vscode/mcp.json` and points to the remote MCP endpoint directly:

```json
{
  "servers": {
    "mcp-fabric-remote": {
      "type": "http",
      "url": "http://localhost:3333/mcp"
    }
  }
}
```

When you want to harden it again, turn `requireBearerAuth` back on and restore transport-level auth.
