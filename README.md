# MCP Fabric POC

A runnable MVP that scans backend services, generates a reusable service catalog, and exposes those capabilities through one MCP-facing runtime.

It includes:
- sample **trade**, **money-market**, **spring-style settlement-risk**, **broker money market**, **DTCC intraday**, and **reference-data** services
- a **hybrid scanner + cache** with AST analysis, source-reflection, OpenAPI import, and optional runtime probe validation
- a **generic MCP Fabric server** that exposes underlying APIs as MCP tools/resources/prompts
- a **VS Code extension** that can enrich catalogs with **Copilot** or **local Ollama**
- a **metrics scorecard** and **smoke test** for measurable demos
- persistent runtime state, audit trail, runtime status, and service health surfaces
- a large-result demo endpoint and systematic result shaping
- prompt files and instructions for more reliable VS Code agent behavior
- an architecture document with modules, data model, and sequence diagrams
- an improvement roadmap for production hardening

## Architecture docs

- `docs/architecture-document.md`
- `docs/data-model.sql`
- `docs/improvement-roadmap.md`

## Repo layout

- `apps/demo-services/trade-service` — runnable Node trade API
- `apps/demo-services/money-market-service` — runnable Node money-market API
- `apps/demo-services/settlement-risk-spring` — Spring-style source + runnable Node mock server
- `apps/demo-services/broker-money-market-service` — JPMC-style broker inventory, maturity ladder, top accounts, investor and issuer analytics
- `apps/demo-services/dtcc-intraday-service` — large intraday obligations dataset for realtime-style demos
- `apps/demo-services/reference-data-service` — investor, issuer, account, and counterparty link reference data
- `tools/generator-cli` — scan + cache + catalog generator
- `apps/mcp-fabric-server` — generic MCP runtime over generated catalogs
- `apps/vscode-extension` — Copilot/Ollama-powered catalog enrichment extension
- `tools/smoke-test` — simple API verification script

## Main run steps

### 1) Install dependencies

```bash
npm install
```

### 2) Start the sample backend services

```bash
npm run demo:start-services
```

This starts:
- trade service on `http://localhost:4010`
- money-market service on `http://localhost:4020`
- settlement-risk mock service on `http://localhost:4030`
- broker money market service on `http://localhost:4040`
- DTCC intraday service on `http://localhost:4050`
- reference-data service on `http://localhost:4060`

Keep this terminal open.

### 3) Optional smoke test for the sample services

Open a new terminal:

```bash
npm run demo:smoke-test
```

### 4) Generate or refresh catalogs

Open another terminal:

```bash
npm run demo:generate
```

This writes:
- `generated/cache-index.json`
- `generated/catalog/*.json`
- `generated/metrics/demo-scorecard.json`
- `generated/metrics/catalog-validation.json`
- `generated/metrics/runtime-probe-report.json`
- `.vscode/mcp.generated.json`
- updated `.vscode/mcp.json` with generated server registrations


### 4b) Generated VS Code MCP registration

The generator now also writes ready-to-use VS Code MCP configs:
- `.vscode/mcp.generated.json`
- `.vscode/mcp.json`

After running `npm run demo:generate`, VS Code can see:
- one shared remote server: `mcpFabricRemote`
- one generated stdio MCP server per scanned backend service

You can open the workspace in VS Code and use:
- `MCP: List Servers`
- `MCP: Reset Cached Tools`

This lets you test either the shared Fabric server or the generated per-service MCP runtimes directly from VS Code.


### 4c) Hybrid scan stages

The generator now uses four stages:
- static route scan
- AST-based handler analysis for JS/TS backends
- source-reflection for Java/Python/TypeScript models
- OpenAPI import and merge when `openapi.json` is present

It also writes per-tool confidence and optional runtime validation:
- `tool.confidence.tool`
- `tool.confidence.schema`
- `tool.validation`
- `generated/metrics/runtime-probe-report.json`

To enable live runtime probe validation, keep the sample services running and leave:
- `config/fabric-config.json -> scanner.enableRuntimeProbeValidation = true`

### 5) Start MCP Fabric

Open another terminal:

```bash
npm run demo:start-fabric
```

This is a **stdio MCP server**, so it waits quietly for a client. That is expected.

### 6) Connect from VS Code

Open the repo in VS Code.

The included `.vscode/mcp.json` points to the Fabric runtime.

### 7) Demo prompts

Try:
- `What services are available?`
- `Find trade T-1001`
- `Show settlement details for trade T-1002`
- `List money market rates for USD`
- `Show JPMC broker outstanding for USD, top accounts, and maturity ladder`
- `Get DTCC intraday summary for USD and enrich the largest issuer and investor`
- `Show reference data for issuer ISS-002 and investor INV-001`
- `Get counterparty CP-001 limits`
- `Show exposure for CP-001`
- `Which tool should I use for counterparty questions?`
- `Show catalog metrics`

## What the runtime exposes

### Dynamic API-backed tools

Generated tool names follow this pattern:
- `trade_service_get_trades_tradeid`
- `trade_service_get_trades_tradeid_settlement`
- `money_market_service_get_money_market_rates`
- `settlement_risk_spring_get_risk_limits_counterpartyid`

### Resources

- `catalog://services`
- `catalog://tools`
- `catalog://metrics`
- `catalog://validation`
- `catalog://runtime`
- `catalog://health`
- `catalog://audit/recent`
- `catalog://service/<serviceName>`

### Optional orchestration helper

- `fabric_plan_query`
- `fabric_execute_plan`
- `fabric_resolve_query`
- `fabric_set_session_context`
- `fabric_get_runtime_status`
- `fabric_refresh_service_health`
- `fabric_list_audit_events`
- `fabric_get_session_state`
- `fabric_clear_session`

These planning tools make resource usage, tool selection, semantic dependency ordering, execution trace, reusable session memory, entity-aware follow-ups, cross-tool entity chaining, and role-aware execution visible to the client.

## Clear run steps for the VS Code extension

### 1) Open the extension folder

```text
apps/vscode-extension
```

### 2) Install and compile

```bash
npm install
npm run compile
```

### 3) Start the extension host

Press `F5`.

### 4) Open a backend repo in the Extension Development Host

Run:

```text
MCP Fabric: Enrich Current Workspace
```

Choose either:
- **Copilot (VS Code entitlement)**
- **Local Ollama (Llama)**

### 5) Inspect outputs

The extension writes:
- `generated/catalog/<workspace>.json`
- `generated/cache-index.json`
- `generated/metrics/<workspace>-extension-metrics.json`

## Metrics you can show in the demo

The generator writes:
- `services_scanned`
- `routes_discovered`
- `mcp_tools_generated`
- `runtime_probe_summary`
- `tool_generation_rate`
- `cache_hits`
- `cache_misses`
- `framework_breakdown`
- `scan_duration_ms`
- `routing_confidence_examples`

## Troubleshooting

### `demo:start-fabric` looks stuck

That is expected. It is a stdio MCP server and waits for a client.

### Missing MCP SDK

From the repo root:

```bash
rm -rf node_modules package-lock.json apps/mcp-fabric-server/node_modules
npm install
```

### Regenerate catalogs after changing sample code

```bash
rm -f generated/cache-index.json
npm run demo:generate
```


## AI-ready planning flow

The MCP Fabric server now supports transparent planning and execution:

- `fabric_plan_query`
  - builds a visible action plan
  - lists resources the client should read
  - ranks candidate tools
  - marks whether approval is required
- `fabric_execute_plan`
  - executes a previously created plan
  - returns a full execution trace
- `fabric_resolve_query`
  - plan-first wrapper that can also auto-execute safe calls

Recommended demo flow:

1. Read `catalog://planner/system`
2. Call `fabric_plan_query`
3. Inspect returned `resourcesToRead` and `candidateTools`
4. For safe read-only requests, call `fabric_execute_plan`
5. Return answer with intent, plan, tools, execution trace, and evidence

Example queries:

- `For trade T-1001, get the trade and settlement details.`
- `Show USD rate from money market and explain which tool was used.`
- `Check whether CP-001 limit is enough for trade T-1001.`
- `Get trade T-1001 and then use that trade to check the correct counterparty limit automatically.`

For mutation-style prompts like `cancel trade T-1001`, the plan will mark `requiresApproval: true`.

## Session memory and conversation reuse

The runtime now supports lightweight in-memory session state keyed by `sessionId`.

What is stored per session:
- recent natural-language queries
- created plan ids
- recent successful tool results
- cached safe GET/read results for 15 minutes
- cache-hit and live-call counters

How to use it in a demo:

1. Call `fabric_plan_query` with a stable `sessionId`, for example `demo-1`.
2. Execute the plan with `fabric_execute_plan`.
3. Ask a follow-up that needs the same safe tool and arguments.
4. Reuse the same `sessionId`.
5. The execution trace will show `source: "session_cache"` instead of `source: "live_api"` when the cached result is reused.

Useful memory resources and tools:
- `memory://sessions`
- `memory://session/<sessionId>`
- `fabric_get_runtime_status`
- `fabric_refresh_service_health`
- `fabric_list_audit_events`
- `fabric_get_session_state`
- `fabric_clear_session`

Example memory-aware flow:

- First query: `For trade T-1001, get the trade and settlement details.`
- Follow-up query with same session: `Show the same trade again and include settlement.`
- The client should reuse the same `sessionId` so the second call can inspect session memory and skip repeated safe API calls when the arguments match.


## New AI-ready behaviors

### Entity-aware memory

Attach a `sessionId` to planning and execution calls. The runtime will remember entities like `tradeId`, `counterpartyId`, and `currency`, so follow-ups such as `show the same trade again` can reuse prior context.

### Role-based execution hooks

Set actor context with `fabric_set_session_context`. Tool-level access policies can require roles and entitlements. The demo catalogs include sample role policies for selected tools so you can show authorization success and failure.

### Large-result shaping

If an API returns a very large payload, the runtime returns a **systematic summary** inline and stores the full payload as a memory resource. This prevents dumping 10k rows into the chat while still keeping the full result accessible.

Useful resources:
- `memory://sessions`
- `memory://session/<sessionId>`
- `memory://session/<sessionId>/entities`
- `memory://session/<sessionId>/result/<resultId>`


## Cross-tool entity chaining

The runtime now supports plan-scoped chaining of entities across tools.

Example flow:
- first tool fetches `trade T-1001`
- runtime extracts `counterpartyId` from that result
- second tool can use that `counterpartyId` automatically

Resolution order for missing required parameters:
1. explicit arguments
2. entities learned from earlier tool results in the same plan
3. session memory from prior turns

You can verify this by planning and executing a query like:
- `Get trade T-1001 and then check its counterparty limit.`

In the execution trace, look for `resolvedFromMemory` entries with `source: "cross_tool_chain"`.


## Semantic dependency planning

The planner now tries to order tools semantically before execution.

What that means:
- if a later tool needs an entity such as `counterpartyId`
- and an earlier candidate tool can produce it from a `tradeId`
- the plan will prefer running the producer first

This is especially useful for prompts like:
- `Get trade T-1001 and then check its counterparty limit`
- `Find trade T-1002, then show settlement and counterparty exposure`

What to inspect in the plan output:
- `steps[*].type = semantic_dependency_planning`
- `transparency.dependencyAnalysis`
- `steps[*].orderedTools`
- `executionPolicy.semanticDependencyPlanningEnabled`

What to inspect in the execution output:
- `result.semanticPlanningSummary`
- `result.chainSummary`
- `result.executionTrace[*].resolvedFromMemory`


## Result synthesis

The MCP Fabric runtime now synthesizes a final business answer after multi-tool execution. `fabric_execute_plan` and `fabric_resolve_query` return:

- `synthesis.finalAnswer` — concise business outcome
- `synthesis.businessSummary` — key bullet-style statements
- `synthesis.derivedMetrics` — structured values such as trade amount, available headroom, settlement status, breach counts, and rate summaries when available
- `synthesis.evidence` — tool-by-tool evidence with invoked URLs and previews
- `synthesis.recommendations` — suggested next actions based on actual tool results

Example verification query:

```json
{
  "query": "Get trade T-1001 and then check its counterparty limit",
  "sessionId": "demo-1",
  "autoExecute": true,
  "maxCandidates": 4,
  "reuseCached": true
}
```

Inspect `execution.synthesis.finalAnswer` and `execution.synthesis.derivedMetrics` in the result.

## Newly added hardening features

### Runtime persistence
- session state is persisted to `generated/runtime/sessions.json`
- audit events are persisted to `generated/runtime/audit-log.json`
- service health snapshots are persisted to `generated/runtime/health-snapshots.json`

### Runtime config
- `config/fabric-config.json` controls timeouts, retries, health cache TTL, and guardrails

### Large-result handling demo
Use:
- `trade_service_get_trades_bulk`

This route can return up to 10,000 generated trade rows. The runtime will return a systematic summary inline and store the full payload as a retrievable memory resource.

### AI-ready prompt assets
- `.github/prompts/mcp-fabric-resolve-query.prompt.md`
- `.github/instructions/mcp-fabric.instructions.md`

These help steer VS Code/Copilot toward a plan-first, evidence-backed flow.

### Useful demo tools
- `fabric_get_runtime_status`
- `fabric_refresh_service_health`
- `fabric_list_audit_events`

### Useful demo resources
- `catalog://runtime`
- `catalog://health`
- `catalog://audit/recent`
- `catalog://validation`

## Example verification flow for large results

1. Set a session context with `fabric_set_session_context`
2. Plan and execute a query against `trade_service_get_trades_bulk`
3. Inspect the systematic summary
4. Read the full result from the returned `memory://session/<sessionId>/result/<resultId>` resource only when needed


## Remote HTTP MCP mode with auth + approval

This repo now includes a remote MCP entrypoint in `apps/mcp-fabric-server/remote-http.js`.

### Start the remote MCP server

```bash
npm install
npm run demo:start-services
npm run demo:generate
npm run demo:start-fabric-http
```

It starts a Streamable HTTP MCP endpoint at:

```text
http://localhost:3333/mcp
```

Health endpoint:

```text
http://localhost:3333/healthz
```

### Auth

This demo uses bearer tokens from `config/remote-auth.json`.

User token:

```text
demo-user-token
```

Approver token:

```text
demo-approver-token
```

### Remote MCP call example

```bash
curl -i -X POST http://localhost:3333/mcp \
  -H "content-type: application/json" \
  -H "Authorization: Bearer demo-user-token" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}'
```

### Approval flow

1. Create a plan that requires approval with `fabric_resolve_query` or `fabric_execute_plan`.
2. The response returns `approval.status=approval_required` and an `approvalUrl`.
3. Open the `approvalUrl` in a browser.
4. Enter the approver token `demo-approver-token`.
5. Approve or reject the request.
6. Re-run `fabric_execute_plan` with the returned `approvalId`.

### Important note

This is a practical demo of remote HTTP + bearer auth + approval UX. It is **not** a full OAuth authorization-server implementation. For production rollout, move the HTTP server to MCP's transport-level authorization flow and a real IdP.


## VS Code setup right now (remote MCP, no auth)

This repo is now configured for the simplest local demo path in VS Code:

1. Start the sample services
2. Generate catalogs
3. Start the remote MCP server
4. Open this folder in VS Code
5. VS Code reads `.vscode/mcp.json` and connects to `http://localhost:3333/mcp`

Commands:

```bash
npm install
npm run demo:start-services
npm run demo:generate
npm run demo:start-fabric-http
```

Check the server in a browser:

- `http://localhost:3333/`
- `http://localhost:3333/healthz`

Notes:
- Bearer auth is disabled for now through `config/fabric-config.json`.
- If you want the older local stdio setup, see `.vscode/mcp-stdio-example.json`.


## Scanner improvements in this version

The scanner is no longer route-regex-only. It now performs:
- route discovery across Express, Spring, Nest, and FastAPI
- class/interface/BaseModel extraction for request and response models
- Spring class-level prefix handling via `@RequestMapping`
- request body and response schema inference where DTOs/models are available
- semantic keyword, entity, and output-shape enrichment for each tool

This means generated catalogs now include richer `inputSchema`, `outputSchema`, entity hints, and service schema resources that the MCP runtime can expose to VS Code.


## Demo-proof usage in VS Code

For business-data questions, use the shared remote server and ask explicitly for transparent output, for example:

```text
Use #fabric_resolve_query. Find trades for counterparty CP-001. Show the action plan, selected tools/resources, payload, API execution trace, and final synthesized answer. Do not read workspace files.
```

The sample services no longer use workspace JSON seed files for business data. They return demo headers such as `x-demo-request-id` and `x-demo-served-at`; these appear in the execution trace as `responseHeaders.demoRequestId` and `responseHeaders.demoServedAt` so you can prove a live endpoint was called.

## New cross-service aggregation demo ideas

Try these prompts with `fabric_resolve_query` to show plan + aggregation + enrichment:

- `Show JPMC broker outstanding for USD, then enrich the top issuer and top investor with reference data.`
- `Get DTCC intraday summary for USD, then show the peak account and issuer details.`
- `List the top broker accounts for USD and summarize their investor and issuer concentration.`
- `Find trades for counterparty CP-001, map it to investor and issuer reference data, and summarize exposure context.`

These work best because the broker and DTCC summary endpoints intentionally return IDs such as `topIssuerId`, `topInvestorId`, and `peakAccountId`, which the Fabric runtime can carry forward into reference-data lookups through entity chaining.
