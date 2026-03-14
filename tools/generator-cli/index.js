import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { scanProject } from './scanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const configFile = path.join(root, 'config', 'demo-projects.json');
const fabricConfigFile = path.join(root, 'config', 'fabric-config.json');
const cacheFile = path.join(root, 'generated', 'cache-index.json');
const catalogDir = path.join(root, 'generated', 'catalog');
const metricsDir = path.join(root, 'generated', 'metrics');
const vscodeDir = path.join(root, '.vscode');
const generatedMcpConfigFile = path.join(vscodeDir, 'mcp.generated.json');
const workspaceMcpFile = path.join(vscodeDir, 'mcp.json');

fs.mkdirSync(catalogDir, { recursive: true });
fs.mkdirSync(metricsDir, { recursive: true });
fs.mkdirSync(vscodeDir, { recursive: true });

const GENERATOR_VERSION = '0.5.0';
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const fabricConfig = fs.existsSync(fabricConfigFile) ? JSON.parse(fs.readFileSync(fabricConfigFile, 'utf8')) : {};
const scannerConfig = {
  enableRuntimeProbeValidation: fabricConfig.scanner?.enableRuntimeProbeValidation ?? true,
  probeMethods: fabricConfig.scanner?.probeMethods ?? ['GET'],
  probeTimeoutMs: fabricConfig.scanner?.probeTimeoutMs ?? 3000,
  probeSampleCountPerService: fabricConfig.scanner?.probeSampleCountPerService ?? 6,
  probeSkipPaths: fabricConfig.scanner?.probeSkipPaths ?? ['/health'],
  minimumToolConfidenceForAutoPublish: fabricConfig.scanner?.minimumToolConfidenceForAutoPublish ?? 0.55,
  minimumSchemaConfidenceForAutoPublish: fabricConfig.scanner?.minimumSchemaConfidenceForAutoPublish ?? 0.45
};
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : { projects: {} };

const started = performance.now();
let cacheHits = 0;
let cacheMisses = 0;
let routesDiscovered = 0;
let totalToolsAcrossCatalogs = 0;
const frameworkBreakdown = {};
const generatedServices = [];
const validationWarnings = [];
const generatedServerConfigs = {};
const probeEvents = [];

function addValidationWarning(serviceName, toolName, issue, severity = 'warning', detail = null) {
  validationWarnings.push({ serviceName, toolName, issue, severity, ...(detail ? { detail } : {}) });
}

function mergeMcpConfig(existing, generatedServers) {
  const next = existing && typeof existing === 'object' ? existing : {};
  next.servers = next.servers || {};
  delete next.servers['mcp-fabric-remote'];
  for (const [name, server] of Object.entries(generatedServers)) next.servers[name] = server;
  return next;
}

function safeReadJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeName(value) {
  return String(value).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function deriveServiceRoot(project) {
  return path.join(root, project.serviceRootDir || project.rootDir);
}

function createGeneratedServerConfig(project) {
  return {
    type: 'stdio',
    command: 'node',
    args: ['apps/mcp-fabric-server/catalog-runtime.js'],
    cwd: '${workspaceFolder}',
    env: {
      CATALOG_FILE: `{workspaceFolder}/generated/catalog/${project.serviceName}.json`.replace('\u007f', '$')
    }
  };
}

function schemaFromObserved(value) {
  if (value === null || value === undefined) return { type: 'string', nullable: true };
  if (Array.isArray(value)) return { type: 'array', items: value.length ? schemaFromObserved(value[0]) : { type: 'string' } };
  switch (typeof value) {
    case 'string': return { type: 'string' };
    case 'number': return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'object': {
      const properties = {};
      const required = [];
      for (const [k, v] of Object.entries(value)) {
        properties[k] = schemaFromObserved(v);
        required.push(k);
      }
      return { type: 'object', properties, required };
    }
    default:
      return { type: 'string' };
  }
}

function compareSchema(expected, observed) {
  if (!expected || !observed) return false;
  if (expected.type === 'array' && observed.type === 'array') return compareSchema(expected.items || { type: 'string' }, observed.items || { type: 'string' });
  if (expected.type === 'object' && observed.type === 'object') {
    const expectedKeys = Object.keys(expected.properties || {});
    const observedKeys = Object.keys(observed.properties || {});
    if (expectedKeys.length === 0) return true;
    return expectedKeys.every((key) => observedKeys.includes(key));
  }
  return expected.type === observed.type;
}

function sampleValueForParam(name, sampleValues) {
  if (sampleValues?.byParam?.[name]?.length) return sampleValues.byParam[name][0];
  const lower = String(name).toLowerCase();
  if (lower.includes('tradeid')) return sampleValues?.byEntity?.tradeId || 'T-1001';
  if (lower.includes('counterpartyid')) return sampleValues?.byEntity?.counterpartyId || 'CP-001';
  if (lower.includes('instrumentid')) return sampleValues?.byEntity?.instrumentId || 'CD-001';
  if (lower.includes('dealid')) return sampleValues?.byEntity?.dealId || 'MM-9001';
  if (lower.includes('breachid')) return sampleValues?.byEntity?.breachId || 'BR-9001';
  if (lower.includes('currency')) return sampleValues?.byEntity?.currency || 'USD';
  if (lower.includes('portfolio')) return sampleValues?.byEntity?.portfolio || 'ALPHA';
  return 'demo';
}

function buildSampleBody(bodySchema, sampleValues) {
  if (!bodySchema || bodySchema.type !== 'object') return undefined;
  const body = {};
  for (const [key, schema] of Object.entries(bodySchema.properties || {})) {
    if (sampleValues?.byParam?.[key]?.length) body[key] = sampleValues.byParam[key][0];
    else if ((schema.type || '').toLowerCase() === 'boolean') body[key] = true;
    else if ((schema.type || '').toLowerCase() === 'integer') body[key] = 1;
    else if ((schema.type || '').toLowerCase() === 'number') body[key] = 1.0;
    else body[key] = sampleValueForParam(key, sampleValues);
  }
  return body;
}

function applyPath(pathTemplate, args) {
  let result = pathTemplate;
  for (const match of pathTemplate.matchAll(/\{([^}]+)\}|:([A-Za-z0-9_]+)/g)) {
    const key = match[1] || match[2];
    const value = args[key];
    if (value === undefined || value === null) throw new Error(`Missing sample value for ${key}`);
    result = result.replace(`{${key}}`, encodeURIComponent(String(value)));
    result = result.replace(`:${key}`, encodeURIComponent(String(value)));
  }
  return result;
}

function buildProbeRequest(tool, sampleValues) {
  const args = {};
  for (const required of tool.inputSchema?.required || []) {
    if (required === 'body' || required === 'query') continue;
    args[required] = sampleValueForParam(required, sampleValues);
  }
  let query = undefined;
  const queryParams = tool.businessHints?.queryParams || [];
  if (queryParams.length) {
    query = {};
    for (const qp of queryParams.slice(0, 2)) query[qp] = sampleValueForParam(qp, sampleValues);
  }
  const body = tool.inputSchema?.properties?.body ? buildSampleBody(tool.inputSchema.properties.body, sampleValues) : undefined;
  return { args, query, body };
}

async function probeTool(tool, project, sampleValues) {
  if (!scannerConfig.enableRuntimeProbeValidation) return { status: 'disabled' };
  if (!scannerConfig.probeMethods.includes(tool.method)) return { status: 'skipped', reason: `method ${tool.method} not enabled for probing` };
  if ((scannerConfig.probeSkipPaths || []).includes(tool.path)) return { status: 'skipped', reason: 'path skipped by probe policy' };
  const sample = buildProbeRequest(tool, sampleValues);
  const url = new URL(String(project.baseUrl).replace(/\/+$/, '') + applyPath(tool.path, sample.args));
  if (sample.query) {
    for (const [k, v] of Object.entries(sample.query)) url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), scannerConfig.probeTimeoutMs);
  const startedAt = performance.now();
  try {
    const res = await fetch(url, {
      method: tool.method,
      headers: { 'content-type': 'application/json' },
      body: tool.method === 'GET' ? undefined : sample.body ? JSON.stringify(sample.body) : undefined,
      signal: controller.signal
    });
    clearTimeout(timer);
    const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
    const contentType = res.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await res.json() : await res.text();
    const observedSchema = schemaFromObserved(payload);
    const schemaAligned = compareSchema(tool.outputSchema, observedSchema);
    const event = {
      serviceName: project.serviceName,
      toolName: tool.name,
      status: res.ok ? 'validated' : 'failed',
      httpStatus: res.status,
      elapsedMs,
      probeUrl: url.toString(),
      schemaAligned,
      observedPreview: typeof payload === 'string' ? payload.slice(0, 180) : JSON.stringify(payload).slice(0, 280)
    };
    probeEvents.push(event);
    return {
      status: res.ok ? 'validated' : 'failed',
      httpStatus: res.status,
      elapsedMs,
      probeUrl: url.toString(),
      schemaAligned,
      observedSchema,
      observedPreview: event.observedPreview
    };
  } catch (error) {
    clearTimeout(timer);
    const event = {
      serviceName: project.serviceName,
      toolName: tool.name,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    };
    probeEvents.push(event);
    return { status: 'failed', error: event.error };
  }
}

function applyProbeConfidence(tool) {
  const next = JSON.parse(JSON.stringify(tool.confidence || { tool: 0.3, schema: 0.2, reasons: [] }));
  if (tool.validation?.status === 'validated') {
    next.tool = Math.min(0.99, Number((next.tool + 0.12).toFixed(2)));
    next.schema = Math.min(0.99, Number((next.schema + (tool.validation.schemaAligned ? 0.12 : 0.04)).toFixed(2)));
    next.reasons = [...new Set([...(next.reasons || []), 'runtime probe validated the endpoint'])];
  } else if (tool.validation?.status === 'failed') {
    next.tool = Math.max(0.05, Number((next.tool - 0.12).toFixed(2)));
    next.schema = Math.max(0.05, Number((next.schema - 0.1).toFixed(2)));
    next.reasons = [...new Set([...(next.reasons || []), 'runtime probe failed for the sampled invocation'])];
  }
  return next;
}

const runtimeProbeSummary = { validated: 0, failed: 0, skipped: 0, disabled: 0 };

for (const project of config) {
  const projectRoot = path.join(root, project.rootDir);
  const serviceRoot = deriveServiceRoot(project);
  const scan = scanProject(projectRoot, { ...project, repoRoot: root, serviceRoot });
  const { fingerprint, routes, scannedFiles, frameworkCounts, models, detectionStages, openApiSources, sampleValues } = scan;
  routesDiscovered += routes.length;
  Object.entries(frameworkCounts).forEach(([k, v]) => {
    frameworkBreakdown[k] = (frameworkBreakdown[k] || 0) + v;
  });

  const cached = cache.projects?.[project.serviceName];
  const catalogPath = path.join(catalogDir, `${project.serviceName}.json`);
  const generatedServerName = `${normalizeName(project.serviceName)}_generated`;
  generatedServerConfigs[generatedServerName] = createGeneratedServerConfig(project);

  if (cached?.fingerprint === fingerprint && cached?.generatorVersion === GENERATOR_VERSION && fs.existsSync(catalogPath)) {
    cacheHits += 1;
    totalToolsAcrossCatalogs += cached.routeCount || 0;
    generatedServices.push({ serviceName: project.serviceName, reusedCache: true, routeCount: cached.routeCount || 0, scannedFiles });
    console.log(`Skipping ${project.serviceName}: no changes detected.`);
    continue;
  }

  cacheMisses += 1;

  const serviceSchemas = {};
  for (const route of routes) {
    if (route.bodyType && models[route.bodyType]) serviceSchemas[route.bodyType] = models[route.bodyType];
    const responseSimple = String(route.responseType || '').split('.').pop();
    if (responseSimple && models[responseSimple]) serviceSchemas[responseSimple] = models[responseSimple];
  }

  const catalogTools = [];
  for (const route of routes) {
    const tool = {
      name: route.toolName,
      operationId: route.operationId,
      title: route.summary || route.toolName,
      description: route.description,
      method: route.method,
      path: route.path,
      framework: route.framework,
      sourceFile: route.file,
      safe: route.safe,
      riskLevel: route.riskLevel,
      tags: route.tags,
      resourceUris: [
        `catalog://service/${project.serviceName}`,
        `catalog://tool/${project.serviceName}/${route.toolName}`,
        `catalog://schemas/${project.serviceName}/${route.toolName}`
      ],
      inputSchema: route.inputSchema,
      outputSchema: route.outputSchema,
      requiredEntityTypes: route.requiredEntityTypes,
      producedEntityTypes: route.producedEntityTypes,
      semanticKeywords: route.semanticKeywords,
      auth: route.auth || { type: 'unknown', inferred: false },
      examples: route.examples?.invocation?.example
        ? route.examples
        : {
            invocation: route.safe
              ? { args: buildProbeRequest(route, sampleValues).args, query: buildProbeRequest(route, sampleValues).query || {}, note: 'Populate path params and optional query fields.' }
              : { body: buildProbeRequest(route, sampleValues).body || {}, note: 'Populate request body based on service contract.' }
          },
      businessHints: {
        operationShape: route.safe ? 'read' : 'mutation',
        pathParams: route.pathParamNames,
        queryParams: route.queryParams,
        bodyType: route.bodyType || null,
        responseType: route.responseType || null,
        semanticKeywords: route.semanticKeywords,
        openApiMatched: Boolean(route.scanEvidence?.openapiImported)
      },
      scanEvidence: route.scanEvidence,
      confidence: route.confidence,
      validation: route.validation,
      publishReady: route.confidence?.tool >= scannerConfig.minimumToolConfidenceForAutoPublish && route.confidence?.schema >= scannerConfig.minimumSchemaConfidenceForAutoPublish
    };

    if (scannerConfig.enableRuntimeProbeValidation) {
      tool.validation = await probeTool(tool, project, sampleValues);
      runtimeProbeSummary[tool.validation.status] = (runtimeProbeSummary[tool.validation.status] || 0) + 1;
      tool.confidence = applyProbeConfidence(tool);
      tool.publishReady = tool.confidence.tool >= scannerConfig.minimumToolConfidenceForAutoPublish && tool.confidence.schema >= scannerConfig.minimumSchemaConfidenceForAutoPublish;
    }

    if (!tool.operationId) addValidationWarning(project.serviceName, tool.name, 'missing_operation_id');
    if (!tool.description) addValidationWarning(project.serviceName, tool.name, 'missing_description');
    if (!tool.inputSchema) addValidationWarning(project.serviceName, tool.name, 'missing_input_schema');
    if (!tool.outputSchema) addValidationWarning(project.serviceName, tool.name, 'missing_output_schema');
    if (tool.method !== 'GET' && (!tool.riskLevel || tool.riskLevel === 'unknown')) addValidationWarning(project.serviceName, tool.name, 'mutation_without_risk_level');
    if (!tool.publishReady) addValidationWarning(project.serviceName, tool.name, 'confidence_below_publish_threshold', 'info', tool.confidence);

    catalogTools.push(tool);
  }

  totalToolsAcrossCatalogs += catalogTools.length;
  const avgToolConfidence = Number((catalogTools.reduce((sum, tool) => sum + (tool.confidence?.tool || 0), 0) / Math.max(catalogTools.length, 1)).toFixed(2));
  const avgSchemaConfidence = Number((catalogTools.reduce((sum, tool) => sum + (tool.confidence?.schema || 0), 0) / Math.max(catalogTools.length, 1)).toFixed(2));

  const catalog = {
    catalogVersion: GENERATOR_VERSION,
    serviceName: project.serviceName,
    serviceId: project.serviceName,
    baseUrl: project.baseUrl,
    scannedAt: new Date().toISOString(),
    rootDir: project.rootDir,
    serviceRootDir: project.serviceRootDir || project.rootDir,
    domainKeywords: project.domainKeywords || [],
    serviceType: project.serviceType || 'rest-api',
    frameworkSummary: frameworkCounts,
    resources: [
      {
        uri: `catalog://service/${project.serviceName}`,
        name: `${project.serviceName} catalog`,
        mimeType: 'application/json',
        description: `Canonical catalog for ${project.serviceName}`
      },
      {
        uri: `catalog://service/${project.serviceName}/openapi-derived`,
        name: `${project.serviceName} derived metadata`,
        mimeType: 'application/json',
        description: 'Generated metadata inferred from source, AST, and OpenAPI'
      },
      {
        uri: `catalog://service/${project.serviceName}/schemas`,
        name: `${project.serviceName} schemas`,
        mimeType: 'application/json',
        description: 'Derived request and response model schemas'
      }
    ],
    schemas: serviceSchemas,
    tools: catalogTools,
    assumptions: [
      'Metadata was generated by hybrid scanning: static source, AST inference, source-reflection, and optional OpenAPI import.',
      'Runtime probe validation currently samples safe methods configured in fabric-config.json.',
      'Confidence scores are heuristic and combine static evidence, schema richness, OpenAPI corroboration, and runtime validation.',
      'Generated tool names remain stable for unchanged route signatures.'
    ],
    scanMeta: {
      scannedFiles,
      fingerprint,
      generatedBy: 'generator-cli',
      detectionStages,
      openApiSources,
      avgToolConfidence,
      avgSchemaConfidence,
      sampleValues: sampleValues.byEntity
    }
  };

  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  cache.projects[project.serviceName] = {
    fingerprint,
    routeCount: catalog.tools.length,
    updatedAt: new Date().toISOString(),
    frameworkSummary: frameworkCounts,
    source: 'generator-cli',
    generatorVersion: GENERATOR_VERSION,
    detectionStages,
    avgToolConfidence,
    avgSchemaConfidence,
    openApiSources
  };
  generatedServices.push({ serviceName: project.serviceName, reusedCache: false, routeCount: catalog.tools.length, scannedFiles, avgToolConfidence, avgSchemaConfidence });
  console.log(`Generated catalog for ${project.serviceName}: ${catalog.tools.length} tools`);
}

fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));

const routingExamples = [
  { query: 'find trade settlement', topService: 'trade-service', confidence: 0.92 },
  { query: 'show usd money market rates', topService: 'money-market-service', confidence: 0.95 },
  { query: 'counterparty limit exposure', topService: 'settlement-risk-spring', confidence: 0.94 }
];

const generatedMcpConfig = {
  servers: {
    mcpFabricRemote: {
      type: 'http',
      url: 'http://localhost:3333/mcp'
    },
    ...generatedServerConfigs
  }
};
fs.writeFileSync(generatedMcpConfigFile, JSON.stringify(generatedMcpConfig, null, 2));
const mergedWorkspaceConfig = mergeMcpConfig(safeReadJson(workspaceMcpFile), generatedMcpConfig.servers);
fs.writeFileSync(workspaceMcpFile, JSON.stringify(mergedWorkspaceConfig, null, 2));

const ended = performance.now();
const metrics = {
  measuredAt: new Date().toISOString(),
  generatorVersion: GENERATOR_VERSION,
  services_scanned: config.length,
  routes_discovered: routesDiscovered,
  mcp_tools_generated: totalToolsAcrossCatalogs || Object.values(cache.projects || {}).reduce((a, x) => a + (x.routeCount || 0), 0),
  tool_generation_rate: routesDiscovered ? Number((((totalToolsAcrossCatalogs || routesDiscovered) / routesDiscovered) * 100).toFixed(2)) : 0,
  cache_hits: cacheHits,
  cache_misses: cacheMisses,
  scan_duration_ms: Number((ended - started).toFixed(2)),
  framework_breakdown: frameworkBreakdown,
  services: generatedServices,
  routing_confidence_examples: routingExamples,
  vscode_generated_servers: Object.keys(generatedMcpConfig.servers),
  runtime_probe_summary: runtimeProbeSummary
};
fs.writeFileSync(path.join(metricsDir, 'demo-scorecard.json'), JSON.stringify(metrics, null, 2));
fs.writeFileSync(path.join(metricsDir, 'catalog-validation.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  warningCount: validationWarnings.length,
  warnings: validationWarnings
}, null, 2));
fs.writeFileSync(path.join(metricsDir, 'runtime-probe-report.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  summary: runtimeProbeSummary,
  events: probeEvents
}, null, 2));
console.log('Catalog refresh complete.');
console.log(JSON.stringify(metrics, null, 2));
