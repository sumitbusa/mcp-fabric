import { DiscoveredRoute } from "./types";

export function buildCatalogEnrichmentPrompt(workspaceName: string, routes: DiscoveredRoute[]): string {
  return `
Generate MCP Fabric catalog JSON for the service "${workspaceName}".

Return ONLY valid JSON with this exact top-level structure:
{
  "serviceName": "string",
  "baseUrl": "string",
  "scannedAt": "ISO timestamp",
  "rootDir": "string",
  "domainKeywords": ["string"],
  "tools": [
    {
      "name": "snake_case_tool_name",
      "title": "Short title",
      "description": "Human readable description",
      "method": "GET|POST|PUT|PATCH|DELETE",
      "path": "/path",
      "framework": "string",
      "sourceFile": "relative/path",
      "safe": true,
      "inputSchema": {
        "type": "object",
        "properties": {},
        "required": []
      }
    }
  ],
  "assumptions": ["string"]
}

Rules:
1. Preserve every discovered route as one tool.
2. Keep tool names stable and snake_case.
3. Mark GET routes safe unless the route name clearly implies mutation.
4. For write routes, safe should usually be false.
5. Infer path parameters into inputSchema.
6. Do not invent business body fields unless obvious.
7. baseUrl must be set to "http://localhost:0000" if unknown.
8. domainKeywords should contain 3 to 8 short domain terms derived from the route set.
9. Never return markdown fences.

Discovered routes:
${JSON.stringify(routes, null, 2)}
`.trim();
}
