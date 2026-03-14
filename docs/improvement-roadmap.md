# MCP Fabric improvement roadmap

This file separates what is already implemented in this repo from what should come next for a production rollout.

## Implemented in this version

### Product hardening
- Transparent plan-first execution
- Session memory and entity-aware follow-ups
- Cross-tool entity chaining
- Semantic dependency planning
- Result synthesis with evidence
- Large-result shaping with retrievable result resources
- Role and entitlement hooks at tool execution time
- Runtime status surface
- Service health snapshots
- Audit trail for plans, executions, cache hits, and authorization denials
- Session persistence and runtime state persistence
- Catalog validation report
- VS Code prompt file and workspace instructions for AI-assisted demos
- Large-result demo endpoint (`GET /trades/bulk`)

### Developer experience
- Prompt file for MCP-aware agent use
- Workspace instructions for consistent tool usage
- Validation metrics generated alongside catalogs
- Config file for runtime controls

## Highest-value next steps

### 1. Production transport and auth
- Remote HTTP transport for MCP Fabric
- OAuth or enterprise auth integration for HTTP transports
- mTLS / network policy controls for internal-only deployment

### 2. Better schema intelligence
- Deeper request/response schema inference from DTOs and annotations
- Existing OpenAPI import and merge
- Example generation from tests and traffic samples

### 3. Approval and human-in-the-loop workflows
- MCP elicitation-based approval UX for risky actions
- Multi-step approval states and audit sign-off
- Per-tool risk policies and approver groups

### 4. Better planning quality
- Semantic ranker backed by embeddings or reranker model
- Service dependency graph from code and traffic
- Tool confidence scoring with evaluation feedback loop

### 5. Better result handling
- Pagination and continuation tokens for very large result sets
- Structured aggregation policies by tool type
- Export-to-resource / CSV / JSON bundle patterns

### 6. Observability
- Prometheus or OpenTelemetry instrumentation
- Per-tool latency, error, and cache dashboards
- Query trace replay for failed sessions

### 7. Governance
- Per-service publishing workflow
- Catalog versioning and diff view
- Deprecation policy and breaking change warnings

### 8. Multi-backend adoption
- Additional scanners for .NET, Go, and Python frameworks
- API gateway and service mesh discovery adapters
- Traffic-log-assisted discovery for undocumented endpoints

## Success metrics to track
- Catalog freshness
- Route-to-tool conversion rate
- Correct tool selection rate
- Correct multi-step plan rate
- Cache hit rate
- Large-result shaping rate
- Approval-required mutation coverage
- Authorization block correctness
- Time to onboard a new backend service
