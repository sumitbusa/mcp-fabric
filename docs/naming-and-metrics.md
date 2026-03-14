# Naming and metrics

## Naming

For this product, **MCP Fabric** is a stronger term than “broker server” because it implies:
- discovery
- metadata persistence
- routing
- virtualization
- one MCP surface over many backend systems

Other acceptable variants:
- MCP Gateway
- MCP Driver Layer
- MCP Virtualization Layer

## Demo metrics to show

### Generator metrics
- services_scanned
- routes_discovered
- mcp_tools_generated
- tool_generation_rate
- cache_hits
- cache_misses
- scan_duration_ms
- routing_confidence_examples

### Extension metrics
- provider
- workspace
- routeCount
- scannedFiles
- cacheHit
- scanDurationMs
- catalogPath

## Suggested demo lines

- “We scanned three services across mixed stacks, including a Spring-style codebase.”
- “We converted every discovered route into MCP tool metadata.”
- “We reused cache for unchanged projects, so repeat scans are faster.”
- “We can enrich the same catalog using Copilot in VS Code or local Llama through Ollama.”
