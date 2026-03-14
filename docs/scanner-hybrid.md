# Hybrid Scanner

This version upgrades the catalog generator from regex-only route discovery to a hybrid pipeline:

1. Static route scan
2. AST analysis for JS/TS backends
3. Source-reflection for DTO/model classes
4. OpenAPI import and merge
5. Optional runtime probe validation
6. Confidence scoring per tool and schema

## Main files

- `tools/generator-cli/scanner.js`
- `tools/generator-cli/index.js`
- `config/demo-projects.json`
- `config/fabric-config.json`

## What is new

### AST analysis
For Express-style backends, the scanner now uses the TypeScript compiler API to:
- discover route declarations
- inspect `req.query` and `req.body` usage
- infer response shapes from `res.json(...)`
- map simple JSON-backed variables and helper functions into schemas

### Source-reflection
The scanner reflects nearby source models from:
- Java classes / records
- TypeScript interfaces / type literals
- Python `BaseModel` / `TypedDict`

### OpenAPI import
If a service has `openapi.json`, the generator imports it and merges:
- operationId
- summary / description
- tags
- auth/security hints
- request body schema
- response schema

### Runtime probe validation
When `config/fabric-config.json -> scanner.enableRuntimeProbeValidation = true`, the generator attempts live validation for configured safe methods.

It writes:
- `generated/metrics/runtime-probe-report.json`
- `tool.validation`

### Confidence scoring
Each tool now includes:
- `confidence.tool`
- `confidence.schema`
- `confidence.reasons`

These scores blend static evidence, AST evidence, model reflection, OpenAPI corroboration, and runtime validation.
