import fs from 'node:fs';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

const catalogFile = process.env.CATALOG_FILE;
if (!catalogFile) {
  console.error('Missing CATALOG_FILE environment variable');
  process.exit(1);
}

const resolvedCatalogFile = path.resolve(catalogFile);
if (!fs.existsSync(resolvedCatalogFile)) {
  console.error(`Catalog file not found: ${resolvedCatalogFile}`);
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(resolvedCatalogFile, 'utf8'));

function sanitizeMcpToolName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[./\s:]+/g, '_')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

const toolCatalog = (catalog.tools || []).map((tool) => ({ ...tool, _exposedName: sanitizeMcpToolName(tool.mcpToolName || tool.name) }));
const resources = catalog.resources || [];
const schemasUri = `catalog://service/${catalog.serviceName}/schemas`;

async function invokeHttpTool(tool, args = {}) {
  let pathOut = tool.path;
  for (const [k, v] of Object.entries(args)) {
    pathOut = pathOut.replace(`{${k}}`, encodeURIComponent(String(v)));
    pathOut = pathOut.replace(`:${k}`, encodeURIComponent(String(v)));
  }
  const url = new URL(String(catalog.baseUrl).replace(/\/+$/, '') + pathOut);
  if (tool.method === 'GET') {
    for (const [k, v] of Object.entries(args.query || {})) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method: tool.method,
    headers: { 'content-type': 'application/json' },
    body: tool.method === 'GET' ? undefined : (args.body !== undefined ? JSON.stringify(args.body) : undefined)
  });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  return {
    ok: res.ok,
    status: res.status,
    invokedUrl: url.toString(),
    data
  };
}

const server = new Server(
  { name: `${catalog.serviceName}-generated`, version: catalog.catalogVersion || '0.1.0' },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolCatalog.map((tool) => ({
    name: tool._exposedName,
    description: tool.description,
    inputSchema: tool.inputSchema || { type: 'object', properties: {}, required: [] }
  }))
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = toolCatalog.find((item) => item._exposedName === request.params.name);
  if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);
  const result = await invokeHttpTool(tool, request.params.arguments || {});
  return {
    content: [
      { type: 'text', text: JSON.stringify(result, null, 2) }
    ]
  };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    ...resources,
    {
      uri: schemasUri,
      name: `${catalog.serviceName} schemas`,
      mimeType: 'application/json',
      description: `Derived schemas for ${catalog.serviceName}`
    }
  ]
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri === `catalog://service/${catalog.serviceName}` || uri === `catalog://service/${catalog.serviceName}/openapi-derived`) {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(catalog, null, 2) }]
    };
  }
  if (uri === schemasUri) {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(catalog.schemas || {}, null, 2) }]
    };
  }
  const toolSchemaMatch = uri.match(new RegExp(`^catalog://schemas/${catalog.serviceName}/(.+)$`));
  if (toolSchemaMatch) {
    const tool = toolCatalog.find((item) => item._exposedName === toolSchemaMatch[1]);
    if (!tool) throw new Error(`Unknown schema resource: ${uri}`);
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }, null, 2)
      }]
    };
  }
  throw new Error(`Unknown resource: ${uri}`);
});

console.error(`Catalog runtime for ${catalog.serviceName} waiting on stdio...`);
await server.connect(new StdioServerTransport());
