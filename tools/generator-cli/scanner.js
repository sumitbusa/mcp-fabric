import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const CODE_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.java', '.py']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'coverage', '.next', '.turbo', 'out']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function listFiles(dir, predicate = null) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(full, predicate));
    else if (!predicate || predicate(full, entry.name)) results.push(full);
  }
  return results;
}

function listCodeFiles(dir) {
  return listFiles(dir, (full) => CODE_EXTENSIONS.has(path.extname(full)));
}

function hashFiles(files) {
  const h = crypto.createHash('sha1');
  for (const file of files.sort()) {
    h.update(file);
    h.update(fs.readFileSync(file));
  }
  return h.digest('hex');
}

function normalizePath(p) {
  let out = String(p || '/').trim();
  if (!out.startsWith('/')) out = `/${out}`;
  return out.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function joinPaths(...parts) {
  const filtered = parts.filter(Boolean).map((x) => String(x));
  return normalizePath(filtered.join('/'));
}


function canonicalRoutePath(routePath) {
  return normalizePath(routePath).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function routeKey(method, routePath) {
  return `${String(method).toUpperCase()}|${canonicalRoutePath(routePath)}`;
}

function inferPathParams(routePath) {
  const params = [];
  for (const m of String(routePath).matchAll(/:([A-Za-z0-9_]+)/g)) params.push(m[1]);
  for (const m of String(routePath).matchAll(/\{([A-Za-z0-9_]+)\}/g)) params.push(m[1]);
  return Array.from(new Set(params));
}

function toSnakeCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function toToolName(method, routePath) {
  const clean = String(routePath)
    .replace(/[:{}]/g, '')
    .replace(/[\/\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return toSnakeCase(`${String(method).toLowerCase()}_${clean || 'root'}`);
}

function guessTags(routePath) {
  const ignored = new Set(['search', 'health']);
  return Array.from(
    new Set(
      String(routePath)
        .split('/')
        .filter(Boolean)
        .map((x) => x.replace(/^:/, '').replace(/[{}]/g, ''))
        .filter((x) => x && !ignored.has(x) && !x.toLowerCase().endsWith('id'))
        .slice(0, 4)
    )
  );
}

function inferRiskLevel(method, routePath) {
  const upper = String(method || '').toUpperCase();
  const normalized = String(routePath || '').toLowerCase();
  if (upper === 'GET') return 'low';
  if (normalized.includes('search')) return 'low';
  if (['delete', 'cancel', 'terminate', 'close'].some((x) => normalized.includes(x))) return 'high';
  return 'medium';
}

function simplifyType(typeName) {
  return String(typeName || '').replace(/\s+/g, ' ').trim();
}

function unwrapContainerType(typeName) {
  const t = simplifyType(typeName);
  const direct = t.match(/^(?:List|Set|Collection|ArrayList|Iterable|Array)<(.+)>$/);
  if (direct) return { kind: 'array', inner: simplifyType(direct[1]) };
  const wrapped = t.match(/^(?:ResponseEntity|Optional|Mono|Flux)<(.+)>$/);
  if (wrapped) return unwrapContainerType(wrapped[1]);
  return { kind: 'single', inner: t };
}

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', additionalProperties: true };
  if (schema.type === 'array') return { ...schema, items: normalizeSchema(schema.items || { type: 'string' }) };
  if (schema.type === 'object' && !schema.properties && schema.additionalProperties === undefined) {
    return { ...schema, additionalProperties: true };
  }
  return schema;
}

function mergeRequired(a = [], b = []) {
  return Array.from(new Set([...(a || []), ...(b || [])]));
}

function mergeSchemas(baseSchema, overrideSchema) {
  const a = baseSchema ? normalizeSchema(baseSchema) : null;
  const b = overrideSchema ? normalizeSchema(overrideSchema) : null;
  if (!a) return b;
  if (!b) return a;
  if (a.type !== b.type) return b.type === 'object' ? b : a;
  if (a.type === 'object') {
    return {
      type: 'object',
      properties: { ...(a.properties || {}), ...(b.properties || {}) },
      required: mergeRequired(a.required, b.required),
      additionalProperties: a.additionalProperties ?? b.additionalProperties,
      ...(b.description ? { description: b.description } : a.description ? { description: a.description } : {})
    };
  }
  if (a.type === 'array') {
    return { ...a, ...b, items: mergeSchemas(a.items, b.items) };
  }
  return { ...a, ...b };
}

function baseTypeSchema(typeName) {
  const t = simplifyType(typeName).replace(/\?$/, '');
  if (!t) return { type: 'string' };
  const lower = t.toLowerCase();
  if (['string', 'charsequence', 'uuid', 'date', 'datetime', 'localdate', 'localdatetime'].includes(lower)) return { type: 'string' };
  if (['int', 'integer', 'long', 'short', 'bigint'].includes(lower)) return { type: 'integer' };
  if (['double', 'float', 'bigdecimal', 'number', 'decimal'].includes(lower)) return { type: 'number' };
  if (['boolean', 'bool'].includes(lower)) return { type: 'boolean' };
  if (['map', 'dict', 'dictionary', 'object', 'jsonnode'].includes(lower)) return { type: 'object', additionalProperties: true };
  if (['list', 'array', 'set', 'iterable'].includes(lower)) return { type: 'array', items: { type: 'string' } };
  return { type: 'string', xTypeName: t };
}

function schemaFromType(typeName, models) {
  const unwrapped = unwrapContainerType(typeName);
  if (unwrapped.kind === 'array') return { type: 'array', items: schemaFromType(unwrapped.inner, models) };
  const inner = simplifyType(unwrapped.inner).replace(/^final\s+/, '');
  const maybeGeneric = inner.match(/^([A-Za-z_][A-Za-z0-9_$.]*)<(.+)>$/);
  if (maybeGeneric) return schemaFromType(`${maybeGeneric[1]}<${maybeGeneric[2]}>`, models);
  const simple = inner.split('.').pop();
  if (models[simple]) return JSON.parse(JSON.stringify(models[simple]));
  return baseTypeSchema(simple);
}

function schemaFromValue(value) {
  if (value === null || value === undefined) return { type: 'string', nullable: true };
  if (Array.isArray(value)) return { type: 'array', items: value.length ? schemaFromValue(value[0]) : { type: 'string' } };
  switch (typeof value) {
    case 'string':
      return { type: 'string', example: value };
    case 'number':
      return Number.isInteger(value) ? { type: 'integer', example: value } : { type: 'number', example: value };
    case 'boolean':
      return { type: 'boolean', example: value };
    case 'object': {
      const properties = {};
      const required = [];
      for (const [k, v] of Object.entries(value)) {
        properties[k] = schemaFromValue(v);
        required.push(k);
      }
      return { type: 'object', properties, required };
    }
    default:
      return { type: 'string' };
  }
}

function deriveEntityTypes(routePath, operationName = '') {
  const hay = `${routePath} ${operationName}`.toLowerCase();
  const pairs = [
    ['trade', 'tradeId'],
    ['counterparty', 'counterpartyId'],
    ['settlement', 'settlementId'],
    ['portfolio', 'portfolioId'],
    ['currency', 'currency'],
    ['limit', 'limitId'],
    ['rate', 'currency'],
    ['instrument', 'instrumentId'],
    ['deal', 'dealId'],
    ['breach', 'breachId'],
    ['issuer', 'issuerId'],
    ['investor', 'investorId'],
    ['account', 'accountId'],
    ['maturity', 'maturityDate'],
    ['obligation', 'obligationId'],
    ['dtcc', 'obligationId'],
    ['outstanding', 'currency']
  ];
  const out = [];
  for (const [token, entity] of pairs) if (hay.includes(token)) out.push(entity);
  return Array.from(new Set(out));
}

function buildBodySchema(bodyType, models) {
  if (!bodyType) return { type: 'object', description: 'Optional request body' };
  const schema = schemaFromType(bodyType, models);
  if (schema.type === 'string' && !schema.properties) return { type: 'object', description: `Request body of type ${bodyType}` };
  return normalizeSchema(schema);
}

function buildOutputSchema(responseType, models) {
  if (!responseType) return { type: 'object', additionalProperties: true };
  return normalizeSchema(schemaFromType(responseType, models));
}

function buildResourceUris(serviceName, toolName) {
  return [
    `catalog://service/${serviceName}`,
    `catalog://tool/${serviceName}/${toolName}`,
    `catalog://schemas/${serviceName}/${toolName}`
  ];
}

function makeDescription(method, routePath, context = {}) {
  const action = context.operationName
    ? context.operationName.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
    : `${String(method).toLowerCase()} ${routePath}`;
  const nouns = guessTags(routePath);
  const subject = nouns.length ? nouns.join(', ') : 'resource';
  return `${String(method).toUpperCase()} ${routePath} — ${action} for ${subject}`;
}

function addRoute(routes, method, routePath, framework, file, snippet, context = {}) {
  const upperMethod = String(method || '').toUpperCase();
  if (!HTTP_METHODS.has(upperMethod)) return;
  const normalizedPath = normalizePath(routePath);
  const toolName = context.toolName || toToolName(upperMethod, normalizedPath);
  routes.push({
    method: upperMethod,
    path: normalizedPath,
    framework,
    file,
    snippet,
    toolName,
    operationId: context.operationId || toSnakeCase(context.operationName || `${upperMethod}_${normalizedPath}`),
    tags: Array.from(new Set([...(context.tags || []), ...guessTags(normalizedPath)])),
    safe: context.safe ?? (upperMethod === 'GET' || normalizedPath.toLowerCase().includes('/search')),
    riskLevel: context.riskLevel || inferRiskLevel(upperMethod, normalizedPath),
    inputSchema: normalizeSchema(context.inputSchema),
    outputSchema: normalizeSchema(context.outputSchema),
    responseType: context.responseType,
    bodyType: context.bodyType,
    pathParamNames: inferPathParams(normalizedPath),
    queryParams: context.queryParams || [],
    semanticKeywords: Array.from(new Set([...(context.semanticKeywords || []), ...deriveEntityTypes(normalizedPath, context.operationName)])),
    producedEntityTypes: context.producedEntityTypes || deriveEntityTypes(normalizedPath, context.operationName),
    requiredEntityTypes: context.requiredEntityTypes || inferPathParams(normalizedPath),
    description: context.description || makeDescription(upperMethod, normalizedPath, context),
    scanEvidence: context.scanEvidence || {},
    examples: context.examples || {},
    validation: context.validation || { status: 'not_run' },
    confidence: context.confidence || null,
    summary: context.summary || null,
    auth: context.auth || { type: 'unknown', inferred: false }
  });
}

function extractBlock(text, startIndex) {
  let depth = 0;
  let started = false;
  for (let i = startIndex; i < text.length; i += 1) {
    if (text[i] === '{') {
      depth += 1;
      started = true;
    } else if (text[i] === '}') {
      depth -= 1;
      if (started && depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return text.slice(startIndex);
}

function discoverDataFiles(projectRoot) {
  return listFiles(projectRoot, (full, name) => path.extname(name) === '.json' && /(?:^|\/)(?:data|mock-server\/data)\//.test(full.replaceAll('\\', '/')));
}

function deriveSampleValuesFromData(projectRoot) {
  const byEntity = {};
  const byParam = {};
  const dataFileSchemas = {};
  const dataFileExamples = {};
  for (const file of discoverDataFiles(projectRoot)) {
    try {
      const rel = path.relative(projectRoot, file).replaceAll('\\', '/');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      dataFileSchemas[rel] = schemaFromValue(data);
      dataFileExamples[rel] = Array.isArray(data) ? data.slice(0, 3) : data;
      const rows = Array.isArray(data) ? data : [data];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        for (const [k, v] of Object.entries(row)) {
          if (v === null || v === undefined) continue;
          byParam[k] = byParam[k] || [];
          if (!byParam[k].includes(v) && byParam[k].length < 12) byParam[k].push(v);
          const lower = k.toLowerCase();
          if (lower.includes('tradeid')) byEntity.tradeId = byEntity.tradeId || v;
          if (lower.includes('counterpartyid')) byEntity.counterpartyId = byEntity.counterpartyId || v;
          if (lower.includes('instrumentid')) byEntity.instrumentId = byEntity.instrumentId || v;
          if (lower.includes('dealid')) byEntity.dealId = byEntity.dealId || v;
          if (lower.includes('breachid')) byEntity.breachId = byEntity.breachId || v;
          if (lower === 'currency' || lower.endsWith('currency')) byEntity.currency = byEntity.currency || v;
          if (lower === 'portfolio' || lower.endsWith('portfolio')) byEntity.portfolio = byEntity.portfolio || v;
        }
      }
    } catch {
      // ignore invalid data file
    }
  }
  return { sampleValues: { byEntity, byParam }, dataFileSchemas, dataFileExamples };
}

function extractJavaModels(relativeFile, text) {
  const models = {};
  const classRegex = /(class|record)\s+([A-Za-z_][A-Za-z0-9_]*)[^\{]*\{/g;
  let match;
  while ((match = classRegex.exec(text)) !== null) {
    const className = match[2];
    const block = extractBlock(text, match.index + match[0].lastIndexOf('{'));
    const properties = {};
    const required = [];
    const fieldRegex = /(?:private|public|protected)\s+([A-Za-z0-9_$.<>]+)\s+([A-Za-z0-9_]+)\s*;/g;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(block)) !== null) {
      const fieldType = fieldMatch[1];
      const fieldName = fieldMatch[2];
      properties[fieldName] = schemaFromType(fieldType, {});
      required.push(fieldName);
    }
    if (Object.keys(properties).length > 0) {
      models[className] = { type: 'object', properties, required, xSource: relativeFile, xModelLanguage: 'java' };
    }
  }
  return models;
}

function extractTypeScriptModels(relativeFile, text) {
  const models = {};
  let match;
  const interfaceRegex = /interface\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g;
  while ((match = interfaceRegex.exec(text)) !== null) {
    const [, name, body] = match;
    const properties = {};
    const required = [];
    for (const line of body.split('\n')) {
      const clean = line.trim().replace(/;$/, '');
      const fieldMatch = clean.match(/^([A-Za-z0-9_]+)(\?)?:\s*([^;]+)$/);
      if (!fieldMatch) continue;
      const [, field, optional, fieldType] = fieldMatch;
      properties[field] = schemaFromType(fieldType, {});
      if (!optional) required.push(field);
    }
    if (Object.keys(properties).length > 0) {
      models[name] = { type: 'object', properties, required, xSource: relativeFile, xModelLanguage: 'typescript' };
    }
  }
  const typeRegex = /type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{([\s\S]*?)\}/g;
  while ((match = typeRegex.exec(text)) !== null) {
    const [, name, body] = match;
    const properties = {};
    const required = [];
    for (const line of body.split('\n')) {
      const clean = line.trim().replace(/;$/, '');
      const fieldMatch = clean.match(/^([A-Za-z0-9_]+)(\?)?:\s*([^;]+)$/);
      if (!fieldMatch) continue;
      const [, field, optional, fieldType] = fieldMatch;
      properties[field] = schemaFromType(fieldType, {});
      if (!optional) required.push(field);
    }
    if (Object.keys(properties).length > 0 && !models[name]) {
      models[name] = { type: 'object', properties, required, xSource: relativeFile, xModelLanguage: 'typescript' };
    }
  }
  return models;
}

function extractPythonModels(relativeFile, text) {
  const models = {};
  const classRegex = /class\s+([A-Za-z_][A-Za-z0-9_]*)\((?:BaseModel|TypedDict)\):([\s\S]*?)(?=\nclass\s+|$)/g;
  let match;
  while ((match = classRegex.exec(text)) !== null) {
    const [, name, body] = match;
    const properties = {};
    const required = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      const fieldMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=\n#]+)(?:\s*=\s*(.+))?$/);
      if (!fieldMatch) continue;
      const [, field, fieldType, defaultValue] = fieldMatch;
      properties[field] = schemaFromType(fieldType, {});
      if (!defaultValue) required.push(field);
    }
    if (Object.keys(properties).length > 0) {
      models[name] = { type: 'object', properties, required, xSource: relativeFile, xModelLanguage: 'python' };
    }
  }
  return models;
}

function buildInputSchema({ method, routePath, params = [], bodyType, models }) {
  const pathParams = inferPathParams(routePath);
  const properties = {};
  const required = [];
  for (const param of pathParams) {
    properties[param] = { type: 'string', description: `Path parameter: ${param}` };
    required.push(param);
  }
  for (const param of params) {
    const schema = schemaFromType(param.type, models);
    if (param.kind === 'query') {
      properties[param.name] = { ...schema, description: `Query parameter: ${param.name}` };
      if (param.required) required.push(param.name);
    } else if (param.kind === 'body') {
      properties.body = buildBodySchema(param.type, models);
      if (param.required !== false) required.push('body');
    }
  }
  if (!properties.body && method !== 'GET' && bodyType) {
    properties.body = buildBodySchema(bodyType, models);
    required.push('body');
  }
  if (method === 'GET' && Object.keys(properties).length === required.length) {
    properties.query = { type: 'object', description: 'Optional query parameters' };
  }
  return { type: 'object', properties, required: Array.from(new Set(required)) };
}

function parseJavaParameterList(paramText) {
  if (!paramText.trim()) return [];
  return paramText
    .split(/,(?=\s*@|\s*[A-Za-z_])/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const kind = segment.includes('@RequestBody') ? 'body' : segment.includes('@RequestParam') ? 'query' : segment.includes('@PathVariable') ? 'path' : 'other';
      const required = !segment.includes('required = false') && !segment.includes('required=false');
      const cleaned = segment.replace(/@[A-Za-z0-9_$.]+(?:\([^)]*\))?\s*/g, '').trim();
      const parts = cleaned.split(/\s+/);
      const name = parts[parts.length - 1];
      const type = parts.slice(0, -1).join(' ');
      return { kind, name, type, required };
    });
}

function scanRegexText(relativeFile, text, models) {
  const routes = [];
  let m;

  const fastApiPrefix = (() => {
    const match = text.match(/(?:app|router)\s*=\s*APIRouter\([^)]*prefix\s*=\s*['"]([^'"]+)['"]/);
    return match ? match[1] : '';
  })();
  const fastApiPattern = /@(?:app|router)\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']([^)]*)\)\s*\n\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\(([^)]*)\)/g;
  while ((m = fastApiPattern.exec(text)) !== null) {
    const method = m[1];
    const routePath = joinPaths(fastApiPrefix, m[2]);
    const decoratorArgs = m[3] || '';
    const operationName = m[4];
    const signature = m[5] || '';
    const params = [];
    for (const rawParam of signature.split(',')) {
      const p = rawParam.trim();
      if (!p || p.startsWith('self') || p.startsWith('request')) continue;
      const matchParam = p.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)(?:\s*=\s*(.+))?$/);
      if (!matchParam) continue;
      const [, name, typeName, defaultValue] = matchParam;
      const kind = inferPathParams(routePath).includes(name) ? 'path' : 'query';
      params.push({ kind, name, type: typeName.trim(), required: kind === 'path' || !defaultValue });
    }
    const responseModel = decoratorArgs.match(/response_model\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/);
    addRoute(routes, method, routePath, 'fastapi', relativeFile, m[0], {
      operationName,
      inputSchema: buildInputSchema({ method: String(method).toUpperCase(), routePath, params, models }),
      outputSchema: buildOutputSchema(responseModel?.[1], models),
      responseType: responseModel?.[1],
      queryParams: params.filter((x) => x.kind === 'query').map((x) => x.name),
      semanticKeywords: [operationName, ...params.map((x) => x.name)],
      scanEvidence: { staticRegex: true }
    });
  }

  const springPrefix = (() => {
    const match = text.match(/@RequestMapping\((?:value\s*=\s*)?["']([^"']+)["']/);
    return match ? match[1] : '';
  })();
  const springMethodRegex = /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\(([^)]*)\)\s*public\s+([^\s]+(?:<[^>]+>)?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*\{/g;
  while ((m = springMethodRegex.exec(text)) !== null) {
    const method = m[1].replace('Mapping', '');
    const annotationArgs = m[2];
    const responseType = m[3];
    const operationName = m[4];
    const paramList = m[5];
    const routeMatch = annotationArgs.match(/["']([^"']+)["']/);
    const routePath = joinPaths(springPrefix, routeMatch ? routeMatch[1] : '/');
    const params = parseJavaParameterList(paramList);
    const bodyParam = params.find((x) => x.kind === 'body');
    addRoute(routes, method, routePath, 'spring', relativeFile, m[0], {
      operationName,
      bodyType: bodyParam?.type,
      responseType,
      queryParams: params.filter((x) => x.kind === 'query').map((x) => x.name),
      inputSchema: buildInputSchema({ method, routePath, params, bodyType: bodyParam?.type, models }),
      outputSchema: buildOutputSchema(responseType, models),
      semanticKeywords: [operationName, ...params.map((x) => x.name)],
      scanEvidence: { staticRegex: true, reflectionSource: true }
    });
  }

  return routes;
}

function getPropName(node) {
  if (!node) return null;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function parseDataPathFromCall(node) {
  if (!ts.isCallExpression(node)) return null;
  const text = node.getText();
  const match = text.match(/["']([^"']+\.json)["']/);
  return match ? match[1] : null;
}

function expressionToSchema(node, env = {}) {
  if (!node) return { type: 'object', additionalProperties: true };
  if (ts.isObjectLiteralExpression(node)) {
    const properties = {};
    const required = [];
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key = getPropName(prop.name);
        if (!key) continue;
        properties[key] = expressionToSchema(prop.initializer, env);
        required.push(key);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        const key = prop.name.text;
        properties[key] = env[key] || { type: 'string' };
        required.push(key);
      }
    }
    return { type: 'object', properties, required };
  }
  if (ts.isArrayLiteralExpression(node)) {
    return { type: 'array', items: node.elements.length ? expressionToSchema(node.elements[0], env) : { type: 'string' } };
  }
  if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) return { type: 'string' };
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { type: 'boolean' };
  if (ts.isNumericLiteral(node)) return Number.isInteger(Number(node.text)) ? { type: 'integer' } : { type: 'number' };
  if (ts.isIdentifier(node)) return env[node.text] || { type: 'string', xIdentifier: node.text };
  if (ts.isPropertyAccessExpression(node)) {
    const full = node.getText();
    return env[full] || env[node.name.text] || { type: 'string', xPropertyAccess: full };
  }
  if (ts.isCallExpression(node)) {
    if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map') {
      return { type: 'array', items: { type: 'object', additionalProperties: true } };
    }
    return { type: 'object', additionalProperties: true };
  }
  if (ts.isConditionalExpression(node)) return mergeSchemas(expressionToSchema(node.whenTrue, env), expressionToSchema(node.whenFalse, env));
  if (ts.isParenthesizedExpression(node)) return expressionToSchema(node.expression, env);
  return { type: 'object', additionalProperties: true };
}

function collectFunctionReturnSchemas(sourceFile) {
  const schemas = {};
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name && node.body) {
      const env = {};
      let inferred = null;
      for (const stmt of node.body.statements) {
        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.initializer && ts.isArrayLiteralExpression(decl.initializer)) {
              env[decl.name.text] = { type: 'array', items: { type: 'string' } };
            }
          }
        }
        if (
          ts.isExpressionStatement(stmt) &&
          ts.isCallExpression(stmt.expression) &&
          ts.isPropertyAccessExpression(stmt.expression.expression) &&
          stmt.expression.expression.name.text === 'push'
        ) {
          const target = stmt.expression.expression.expression;
          if (ts.isIdentifier(target) && stmt.expression.arguments.length) {
            env[target.text] = { type: 'array', items: expressionToSchema(stmt.expression.arguments[0], env) };
          }
        }
        if (ts.isReturnStatement(stmt) && stmt.expression) inferred = expressionToSchema(stmt.expression, env);
      }
      if (inferred) schemas[node.name.text] = inferred;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return schemas;
}

function collectReqFieldUsage(node, reqName) {
  const queryParams = new Set();
  const bodyFields = new Set();
  function visit(child) {
    if (
      ts.isPropertyAccessExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) &&
      ts.isIdentifier(child.expression.expression) &&
      child.expression.expression.text === reqName
    ) {
      const area = child.expression.name.text;
      const field = child.name.text;
      if (area === 'query') queryParams.add(field);
      if (area === 'body') bodyFields.add(field);
    }
    if (ts.isVariableDeclaration(child) && ts.isObjectBindingPattern(child.name) && child.initializer) {
      const initText = child.initializer.getText();
      if (initText.startsWith(`${reqName}.body`)) {
        for (const el of child.name.elements) if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) bodyFields.add(el.name.text);
      }
      if (initText.startsWith(`${reqName}.query`)) {
        for (const el of child.name.elements) if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) queryParams.add(el.name.text);
      }
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
  return { queryParams: Array.from(queryParams), bodyFields: Array.from(bodyFields) };
}

function inferHandlerEnv(handler, fileState) {
  const env = { ...fileState.variableSchemas };
  if (!handler.body || !ts.isBlock(handler.body)) return env;
  for (const stmt of handler.body.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const name = decl.name.text;
        if (ts.isCallExpression(decl.initializer) && ts.isIdentifier(decl.initializer.expression) && fileState.functionReturnSchemas[decl.initializer.expression.text]) {
          env[name] = fileState.functionReturnSchemas[decl.initializer.expression.text];
        } else if (
          ts.isCallExpression(decl.initializer) &&
          ts.isPropertyAccessExpression(decl.initializer.expression) &&
          decl.initializer.expression.name.text === 'find'
        ) {
          const arrName = decl.initializer.expression.expression.getText();
          const arrSchema = env[arrName];
          if (arrSchema?.type === 'array') env[name] = arrSchema.items || { type: 'object', additionalProperties: true };
        } else {
          env[name] = expressionToSchema(decl.initializer, env);
        }
      }
    }
  }
  return env;
}

function scanJsTsAst(relativeFile, text, models, dataSchemaContext = {}) {
  const ext = path.extname(relativeFile).toLowerCase();
  if (!['.js', '.jsx', '.ts', '.tsx'].includes(ext)) return [];
  const kind = ext.endsWith('x') ? ts.ScriptKind.TSX : ext.startsWith('.t') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(relativeFile, text, ts.ScriptTarget.Latest, true, kind);
  const routes = [];
  const variableSchemas = {};
  const functionReturnSchemas = collectFunctionReturnSchemas(sourceFile);
  const fileState = { variableSchemas, functionReturnSchemas };

  function visitTop(node) {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const name = decl.name.text;
        const dataPath = parseDataPathFromCall(decl.initializer);
        if (dataPath) {
          const normalizedDataPath = dataPath.replace(/^.*(?:data|mock-server\/data)\//, '');
          const match = Object.entries(dataSchemaContext.dataFileSchemas || {}).find(([key]) => key.endsWith(normalizedDataPath) || key.endsWith(dataPath));
          if (match) variableSchemas[name] = match[1];
          continue;
        }
        if (ts.isObjectLiteralExpression(decl.initializer) || ts.isArrayLiteralExpression(decl.initializer)) {
          variableSchemas[name] = expressionToSchema(decl.initializer, variableSchemas);
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text.toUpperCase();
      const targetText = node.expression.expression.getText(sourceFile);
      if ((targetText === 'app' || targetText === 'router') && HTTP_METHODS.has(methodName)) {
        const pathArg = node.arguments[0];
        const handler = node.arguments.find((arg) => ts.isFunctionExpression(arg) || ts.isArrowFunction(arg));
        const routePath = pathArg && (ts.isStringLiteral(pathArg) || ts.isNoSubstitutionTemplateLiteral(pathArg)) ? pathArg.text : null;
        if (!routePath) return;
        const env = handler ? inferHandlerEnv(handler, fileState) : { ...variableSchemas };
        const params = handler?.parameters || [];
        const reqName = params[0] && ts.isIdentifier(params[0].name) ? params[0].name.text : 'req';
        const io = handler ? collectReqFieldUsage(handler.body, reqName) : { queryParams: [], bodyFields: [] };
        const syntheticParams = io.queryParams.map((q) => ({ kind: 'query', name: q, type: 'string', required: false }));
        if (io.bodyFields.length > 0) syntheticParams.push({ kind: 'body', name: 'body', type: 'object', required: true });
        const inputSchema = buildInputSchema({ method: methodName, routePath, params: syntheticParams, bodyType: io.bodyFields.length ? 'object' : null, models });
        if (io.bodyFields.length > 0 && inputSchema.properties.body) {
          inputSchema.properties.body = {
            type: 'object',
            properties: Object.fromEntries(io.bodyFields.map((field) => [field, { type: 'string' }])),
            required: [...io.bodyFields]
          };
        }
        let outputSchema = { type: 'object', additionalProperties: true };
        if (handler?.body) {
          const jsonCalls = [];
          function visitJson(n) {
            if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'json' && n.arguments.length) jsonCalls.push(n.arguments[0]);
            ts.forEachChild(n, visitJson);
          }
          visitJson(handler.body);
          if (jsonCalls.length) outputSchema = expressionToSchema(jsonCalls[0], env);
        }
        addRoute(routes, methodName, routePath, 'express-ast', relativeFile, node.getText(sourceFile).slice(0, 220), {
          operationName: toToolName(methodName, routePath),
          inputSchema,
          outputSchema,
          queryParams: io.queryParams,
          semanticKeywords: [...io.queryParams, ...io.bodyFields],
          scanEvidence: { astRoute: true, astSchema: true }
        });
      }
    }

    ts.forEachChild(node, visitTop);
  }

  visitTop(sourceFile);
  return routes;
}


function resolveOpenApiSchema(schema, components = {}, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return { type: 'object', additionalProperties: true };
  if (schema.$ref) {
    const ref = schema.$ref;
    if (seen.has(ref)) return { type: 'object', additionalProperties: true };
    const match = ref.match(/^#\/components\/schemas\/(.+)$/);
    if (!match) return { type: 'object', additionalProperties: true };
    const resolved = components?.schemas?.[match[1]];
    if (!resolved) return { type: 'object', additionalProperties: true };
    const nextSeen = new Set(seen);
    nextSeen.add(ref);
    return resolveOpenApiSchema(resolved, components, nextSeen);
  }
  if (schema.type === 'array') return { ...schema, items: resolveOpenApiSchema(schema.items || { type: 'string' }, components, seen) };
  if (schema.type === 'object' || schema.properties || schema.additionalProperties) {
    const properties = {};
    for (const [k, v] of Object.entries(schema.properties || {})) properties[k] = resolveOpenApiSchema(v, components, seen);
    const additionalProperties = schema.additionalProperties && typeof schema.additionalProperties === 'object'
      ? resolveOpenApiSchema(schema.additionalProperties, components, seen)
      : schema.additionalProperties;
    return normalizeSchema({ ...schema, type: schema.type || 'object', properties, ...(additionalProperties !== undefined ? { additionalProperties } : {}) });
  }
  return normalizeSchema(schema);
}

function deriveInputSchemaFromOpenApi(method, routePath, operation, components = {}) {
  const properties = {};
  const required = [];
  for (const param of operation.parameters || []) {
    if (param.in !== 'path' && param.in !== 'query') continue;
    properties[param.name] = resolveOpenApiSchema(param.schema || { type: 'string' }, components);
    properties[param.name].description = param.description || `${param.in} parameter: ${param.name}`;
    if (param.required) required.push(param.name);
  }
  if (operation.requestBody?.content) {
    const bodySchema = operation.requestBody.content['application/json']?.schema || Object.values(operation.requestBody.content)[0]?.schema;
    if (bodySchema) {
      properties.body = resolveOpenApiSchema(bodySchema, components);
      required.push('body');
    }
  }
  if (String(method).toUpperCase() === 'GET' && Object.keys(properties).length === required.length) {
    properties.query = { type: 'object', description: 'Optional query parameters' };
  }
  return { type: 'object', properties, required: Array.from(new Set(required)) };
}

function deriveOutputSchemaFromOpenApi(operation, components = {}) {
  const candidates = operation.responses || {};
  const preferred = candidates['200'] || candidates['201'] || candidates.default || Object.values(candidates)[0];
  const content = preferred?.content || {};
  const schema = content['application/json']?.schema || Object.values(content)[0]?.schema;
  return resolveOpenApiSchema(schema || { type: 'object', additionalProperties: true }, components);
}

function importOpenApi(projectRoot, projectConfig = {}) {
  const repoRoot = projectConfig.repoRoot || projectRoot;
  const files = [];
  const explicit = (projectConfig.openApiFiles || []).map((file) => (path.isAbsolute(file) ? file : path.join(repoRoot, file)));
  for (const file of explicit) if (fs.existsSync(file)) files.push(file);
  if (files.length === 0) {
    for (const file of listFiles(projectRoot, (full, name) => path.extname(name) === '.json' && /openapi|swagger/i.test(name))) files.push(file);
  }

  const operations = [];
  const sources = [];
  for (const file of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      if ((!doc.openapi && !doc.swagger) || !doc.paths) continue;
      sources.push(path.relative(repoRoot, file).replaceAll('\\', '/'));
      for (const [routePath, methods] of Object.entries(doc.paths || {})) {
        for (const [method, operation] of Object.entries(methods || {})) {
          const upper = method.toUpperCase();
          if (!HTTP_METHODS.has(upper)) continue;
          operations.push({
            method: upper,
            path: normalizePath(routePath),
            framework: 'openapi',
            file: path.relative(repoRoot, file).replaceAll('\\', '/'),
            toolName: toToolName(upper, routePath),
            operationId: operation.operationId || toSnakeCase(`${upper}_${routePath}`),
            summary: operation.summary || null,
            description: operation.description || operation.summary || makeDescription(upper, routePath, { operationName: operation.operationId }),
            tags: operation.tags || [],
            inputSchema: deriveInputSchemaFromOpenApi(upper, routePath, operation, doc.components || {}),
            outputSchema: deriveOutputSchemaFromOpenApi(operation, doc.components || {}),
            auth: operation.security ? { type: 'openapi-security', inferred: true, security: operation.security } : { type: 'unknown', inferred: false },
            queryParams: (operation.parameters || []).filter((p) => p.in === 'query').map((p) => p.name),
            examples: { invocation: { from: 'openapi', example: operation.requestBody?.content?.['application/json']?.example || null } },
            semanticKeywords: [operation.summary, operation.operationId, ...(operation.tags || [])].filter(Boolean),
            producedEntityTypes: deriveEntityTypes(routePath, operation.operationId),
            requiredEntityTypes: Array.from(new Set([...(operation.parameters || []).filter((p) => p.required).map((p) => p.name), ...inferPathParams(routePath)])),
            scanEvidence: { openapiImported: true },
            resourceUris: []
          });
        }
      }
    } catch {
      // ignore invalid spec file
    }
  }
  return { operations, sources };
}

function mergeRoute(existing, incoming) {
  const merged = { ...existing, ...incoming };
  merged.tags = Array.from(new Set([...(existing.tags || []), ...(incoming.tags || [])]));
  merged.pathParamNames = Array.from(new Set([...(existing.pathParamNames || []), ...(incoming.pathParamNames || [])]));
  merged.queryParams = Array.from(new Set([...(existing.queryParams || []), ...(incoming.queryParams || [])]));
  merged.semanticKeywords = Array.from(new Set([...(existing.semanticKeywords || []), ...(incoming.semanticKeywords || [])]));
  merged.requiredEntityTypes = Array.from(new Set([...(existing.requiredEntityTypes || []), ...(incoming.requiredEntityTypes || [])]));
  merged.producedEntityTypes = Array.from(new Set([...(existing.producedEntityTypes || []), ...(incoming.producedEntityTypes || [])]));
  merged.inputSchema = mergeSchemas(existing.inputSchema, incoming.inputSchema);
  merged.outputSchema = mergeSchemas(existing.outputSchema, incoming.outputSchema);
  merged.scanEvidence = { ...(existing.scanEvidence || {}), ...(incoming.scanEvidence || {}) };
  merged.auth = incoming.auth?.inferred ? incoming.auth : existing.auth || incoming.auth || { type: 'unknown', inferred: false };
  merged.examples = { ...(existing.examples || {}), ...(incoming.examples || {}) };
  merged.description = incoming.description && incoming.description.length > String(existing.description || '').length ? incoming.description : existing.description || incoming.description;
  merged.summary = incoming.summary || existing.summary || null;
  merged.operationId = incoming.operationId || existing.operationId;
  return merged;
}

function scoreRouteConfidence(route) {
  let toolScore = 0.3;
  let schemaScore = 0.2;
  const reasons = [];
  const ev = route.scanEvidence || {};

  if (ev.staticRegex) {
    toolScore += 0.12;
    reasons.push('route found by static source scan');
  }
  if (ev.astRoute) {
    toolScore += 0.22;
    schemaScore += 0.14;
    reasons.push('route corroborated by AST scan');
  }
  if (ev.astSchema) {
    schemaScore += 0.18;
    reasons.push('request and response shapes inferred from handler AST');
  }
  if (ev.reflectionSource) {
    schemaScore += 0.16;
    reasons.push('DTO and source models reflected from code');
  }
  if (ev.openapiImported) {
    toolScore += 0.2;
    schemaScore += 0.22;
    reasons.push('OpenAPI contract matched the route');
  }
  if (route.inputSchema?.properties && Object.keys(route.inputSchema.properties).length > 0) schemaScore += 0.05;
  if (route.outputSchema?.properties && Object.keys(route.outputSchema.properties).length > 0) schemaScore += 0.08;
  if (route.validation?.status === 'validated') {
    toolScore += 0.12;
    schemaScore += route.validation.schemaAligned ? 0.12 : 0.04;
    reasons.push('runtime probe validated the endpoint');
  } else if (route.validation?.status === 'failed') {
    toolScore -= 0.12;
    schemaScore -= 0.1;
    reasons.push('runtime probe failed for the sampled invocation');
  }

  toolScore = Math.max(0.05, Math.min(0.99, Number(toolScore.toFixed(2))));
  schemaScore = Math.max(0.05, Math.min(0.99, Number(schemaScore.toFixed(2))));
  return { tool: toolScore, schema: schemaScore, reasons };
}

export function scanProject(projectRoot, projectConfig = {}) {
  const repoRoot = projectConfig.repoRoot || projectRoot;
  const serviceRoot = projectConfig.serviceRoot || projectRoot;
  const files = listCodeFiles(projectRoot);
  const explicitOpenApiFiles = (projectConfig.openApiFiles || [])
    .map((file) => (path.isAbsolute(file) ? file : path.join(repoRoot, file)))
    .filter((file) => fs.existsSync(file));
  const fingerprint = hashFiles([...files, ...explicitOpenApiFiles]);
  const { sampleValues, dataFileSchemas, dataFileExamples } = deriveSampleValuesFromData(serviceRoot);
  const byKey = new Map();
  const frameworkCounts = {};
  const modelRegistry = {};

  const fileTexts = files.map((file) => {
    const rel = path.relative(projectRoot, file).replaceAll('\\', '/');
    const text = fs.readFileSync(file, 'utf8');
    Object.assign(modelRegistry, extractJavaModels(rel, text), extractTypeScriptModels(rel, text), extractPythonModels(rel, text));
    return { rel, text };
  });

  for (const { rel, text } of fileTexts) {
    const astRoutes = scanJsTsAst(rel, text, modelRegistry, { dataFileSchemas, dataFileExamples });
    const regexRoutes = scanRegexText(rel, text, modelRegistry);
    for (const route of [...astRoutes, ...regexRoutes]) {
      const key = routeKey(route.method, route.path);
      byKey.set(key, byKey.has(key) ? mergeRoute(byKey.get(key), route) : route);
    }
  }

  const openApiImport = importOpenApi(projectRoot, { ...projectConfig, repoRoot });
  for (const route of openApiImport.operations) {
    const key = routeKey(route.method, route.path);
    byKey.set(key, byKey.has(key) ? mergeRoute(byKey.get(key), route) : route);
  }

  const routes = Array.from(byKey.values())
    .sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`))
    .map((route) => {
      frameworkCounts[route.framework] = (frameworkCounts[route.framework] || 0) + 1;
      const confidence = scoreRouteConfidence(route);
      return {
        ...route,
        resourceUris: buildResourceUris(projectConfig.serviceName || path.basename(projectRoot), route.toolName),
        confidence
      };
    });

  return {
    fingerprint,
    routes,
    scannedFiles: files.length,
    frameworkCounts,
    models: modelRegistry,
    detectionStages: ['static-route-scan', 'ast-analysis', 'source-reflection', ...(openApiImport.operations.length ? ['openapi-import'] : [])],
    openApiSources: openApiImport.sources,
    sampleValues,
    dataFileSchemas
  };
}
