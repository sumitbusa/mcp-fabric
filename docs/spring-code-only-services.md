# Spring code-only demo services

The following demo services now include Spring Boot-style source trees and intentionally do **not** include `openapi.json`:

- `apps/demo-services/broker-money-market-service`
- `apps/demo-services/dtcc-intraday-service`
- `apps/demo-services/reference-data-service`

These services continue to use lightweight Node mock servers for runtime demo execution, but the scanner derives their MCP tools from the Spring-style Java source under `src/main/java`.

## What changed

- `config/demo-projects.json` points scanner `rootDir` to `src/main/java`
- `openApiFiles` is empty for these services
- `pom.xml` and controller/model classes were added

## Why this helps

This proves the scanner can derive tools from backend code structure even when no OpenAPI file exists.
