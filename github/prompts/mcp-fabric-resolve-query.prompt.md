---
mode: 'agent'
description: 'Resolve a business query using MCP Fabric with transparent planning and live API evidence.'
tools: ['mcpFabricRemote.fabric_plan_query', 'mcpFabricRemote.fabric_execute_plan', 'mcpFabricRemote.fabric_get_session_state']
---

Goal: resolve the user query using MCP Fabric with transparent steps and live API evidence.

Process:
1. Call `fabric_plan_query` first.
2. Inspect `resourcesToRead`, `candidateTools`, `dependencyAnalysis`, and memory state.
3. If the plan requires approval, do not execute until the user confirms.
4. If safe, call `fabric_execute_plan`.
5. Return:
   - action plan
   - selected resources
   - selected tools
   - payload and where each field came from
   - execution trace summary including `responseHeaders.demoRequestId` when available
   - synthesized answer
   - evidence
6. Prefer systematic output over dumping large raw payloads.
7. Never answer a live business-data question by reading workspace JSON files when an MCP Fabric tool can answer it.
