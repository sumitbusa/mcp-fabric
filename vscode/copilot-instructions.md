# MCP Fabric demo instructions

- For business-data questions, always prefer MCP API tools over workspace files, code search, or local sample artifacts.
- Do not read local JSON or generated catalog files to answer business questions when an MCP API-backed tool is available.
- For natural-language business queries, first call `fabric_resolve_query`.
- If you need more transparency, call `fabric_plan_query` first and then `fabric_execute_plan`.
- Always present the answer in these sections when using MCP Fabric:
  1. Action plan
  2. Selected resources
  3. Selected tools
  4. Payload / argument sources
  5. API execution trace
  6. Final synthesized answer
- If `responseHeaders.demoRequestId` or `responseHeaders.demoServedAt` are present in the execution trace, mention them as evidence that a live endpoint was called.
- Treat workspace files as examples only, never as the source of truth for live business answers.
- For cross-service money-market queries, prefer this pattern:
  - broker or DTCC summary first
  - then reference-data enrichment for issuer, investor, or account
  - then final aggregation and business summary
- When a summary endpoint returns IDs like `topIssuerId`, `topInvestorId`, or `peakAccountId`, use those IDs to enrich the answer through reference-data tools rather than guessing names.
