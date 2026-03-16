# MCP Fabric operating instructions

- Always prefer `fabric_resolve_query` for business-data questions.
- If the user asks for transparency, or if the action is risky, call `fabric_plan_query` first and then `fabric_execute_plan`.
- Do not use workspace file-reading tools to answer questions that the MCP APIs can answer.
- Reuse session memory when a stable `sessionId` is available.
- For large results, summarize the outcome and mention the retrievable resource instead of pasting all rows.
- Quote evidence from `executionTrace`, `responseHeaders`, and `synthesis.evidence` whenever possible.
- If authorization blocks a tool, explain which roles or entitlements are missing.
