import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const catalogDir = path.join(root, 'generated', 'catalog');
const metricsFile = path.join(root, 'generated', 'metrics', 'demo-scorecard.json');
const configFile = path.join(root, 'config', 'fabric-config.json');

function loadRuntimeConfig() {
  if (!fs.existsSync(configFile)) {
    return {
      runtime: {
        persistSessions: true,
        persistAudit: true,
        sessionFile: 'generated/runtime/sessions.json',
        auditFile: 'generated/runtime/audit-log.json',
        healthFile: 'generated/runtime/health-snapshots.json'
      },
      execution: {
        requestTimeoutMs: 8000,
        maxRetries: 1,
        retryMethods: ['GET'],
        healthCacheTtlMs: 15000,
        defaultReuseCached: true
      },
      guardrails: {
        safeOnlyByDefault: false,
        maxAutoExecuteTools: 3,
        allowMutationWithoutApproval: false
      },
      results: {
        largeResultRowThreshold: 100,
        previewRowLimit: 20,
        maxInlineText: 1200
      },
      remoteHttp: {
        port: 3333,
        publicBaseUrl: 'http://localhost:3333',
        requireBearerAuth: true
      },
      approval: {
        approvalTtlMinutes: 30,
        approvalFile: 'generated/runtime/approval-requests.json'
      }
    };
  }
  return JSON.parse(fs.readFileSync(configFile, 'utf8'));
}

const fabricConfig = loadRuntimeConfig();
const runtimeDir = path.join(root, 'generated', 'runtime');
fs.mkdirSync(runtimeDir, { recursive: true });
const sessionStateFile = path.join(root, fabricConfig.runtime.sessionFile || 'generated/runtime/sessions.json');
const auditFile = path.join(root, fabricConfig.runtime.auditFile || 'generated/runtime/audit-log.json');
const healthFile = path.join(root, fabricConfig.runtime.healthFile || 'generated/runtime/health-snapshots.json');
const approvalFile = path.join(root, fabricConfig.approval?.approvalFile || 'generated/runtime/approval-requests.json');
const authConfigFile = path.join(root, 'config', 'remote-auth.json');

const plans = new Map();
const sessions = new Map();
const resultVault = new Map();
const auditEvents = [];
const healthSnapshots = new Map();
const approvalRequests = new Map();
const APPROVAL_TTL_MS = Number(fabricConfig.approval?.approvalTtlMinutes || 30) * 60 * 1000;
const REMOTE_HTTP_PORT = Number(fabricConfig.remoteHttp?.port || process.env.PORT || 3333);
const REMOTE_PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || fabricConfig.remoteHttp?.publicBaseUrl || `http://localhost:${REMOTE_HTTP_PORT}`);
const REQUIRE_BEARER_AUTH = fabricConfig.remoteHttp?.requireBearerAuth !== false;

const SESSION_TTL_MS = 15 * 60 * 1000;
const RESULT_TTL_MS = 15 * 60 * 1000;
const MAX_SESSION_HISTORY = 20;
const MAX_SESSION_CACHE = 50;
const MAX_SESSION_RESULTS = 10;
const MAX_RESULT_RESOURCES = 50;
const MAX_ENTITY_VALUES = 5;
const LARGE_RESULT_ROW_THRESHOLD = Number(fabricConfig.results?.largeResultRowThreshold || 100);
const PREVIEW_ROW_LIMIT = Number(fabricConfig.results?.previewRowLimit || 20);
const MAX_INLINE_TEXT = Number(fabricConfig.results?.maxInlineText || 1200);
const REQUEST_TIMEOUT_MS = Number(fabricConfig.execution?.requestTimeoutMs || 8000);
const MAX_RETRIES = Number(fabricConfig.execution?.maxRetries || 1);
const RETRY_METHODS = new Set((fabricConfig.execution?.retryMethods || ['GET']).map((x) => String(x).toUpperCase()));
const HEALTH_CACHE_TTL_MS = Number(fabricConfig.execution?.healthCacheTtlMs || 15000);
const DEFAULT_REUSE_CACHED = fabricConfig.execution?.defaultReuseCached !== false;
const MAX_AUTO_EXECUTE_TOOLS = Number(fabricConfig.guardrails?.maxAutoExecuteTools || 3);
const SAFE_ONLY_BY_DEFAULT = fabricConfig.guardrails?.safeOnlyByDefault === true;
const ALLOW_MUTATION_WITHOUT_APPROVAL = fabricConfig.guardrails?.allowMutationWithoutApproval === true;


function loadAuthConfig() {
  if (!fs.existsSync(authConfigFile)) {
    return {
      tokens: [
        { token: 'demo-user-token', userId: 'sumit', roles: ['trader'], entitlements: ['trade.search', 'mm.read', 'risk.read'] },
        { token: 'demo-approver-token', userId: 'manager', roles: ['approver', 'ops_manager'], entitlements: ['approve.execution'] }
      ]
    };
  }
  return JSON.parse(fs.readFileSync(authConfigFile, 'utf8'));
}

const authConfig = loadAuthConfig();
const tokenDirectory = new Map((authConfig.tokens || []).map((entry) => [entry.token, {
  userId: entry.userId,
  roles: entry.roles || [],
  entitlements: entry.entitlements || []
}]));

function authenticateBearerHeader(headerValue) {
  if (!REQUIRE_BEARER_AUTH) return { authenticated: true, actor: { userId: 'anonymous', roles: ['anonymous'], entitlements: [] } };
  const header = String(headerValue || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { authenticated: false, reason: 'missing_bearer_token' };
  const actor = tokenDirectory.get(match[1]);
  if (!actor) return { authenticated: false, reason: 'invalid_bearer_token' };
  return { authenticated: true, actor };
}

function serializeApprovalRequest(approval) {
  return { ...approval };
}

function restoreApprovalRequests() {
  const payload = loadJsonFile(approvalFile, null);
  if (payload?.requests) {
    for (const item of payload.requests) {
      approvalRequests.set(item.approvalId, item);
    }
  }
}

function persistApprovalRequests() {
  writeJsonFile(approvalFile, {
    updatedAt: new Date().toISOString(),
    requests: Array.from(approvalRequests.values()).map(serializeApprovalRequest)
  });
}

function pruneApprovals() {
  const now = Date.now();
  for (const [approvalId, approval] of approvalRequests.entries()) {
    if (approval.status === 'pending' && Date.parse(approval.expiresAt) < now) {
      approval.status = 'expired';
      approval.updatedAt = new Date().toISOString();
    }
    if (Date.parse(approval.expiresAt) + APPROVAL_TTL_MS < now) {
      approvalRequests.delete(approvalId);
    }
  }
}

function buildApprovalUrl(approvalId) {
  return `${REMOTE_PUBLIC_BASE_URL.replace(/\/+$/, '')}/approvals/${encodeURIComponent(approvalId)}`;
}

function findPendingApprovalForPlan(planId) {
  pruneApprovals();
  return Array.from(approvalRequests.values()).find((approval) => approval.planId === planId && approval.status === 'pending');
}

function createApprovalRequest(plan, options = {}) {
  const existing = findPendingApprovalForPlan(plan.planId);
  if (existing) return existing;
  const now = new Date();
  const approval = {
    approvalId: crypto.randomUUID(),
    planId: plan.planId,
    sessionId: plan.sessionId || null,
    query: plan.query,
    status: 'pending',
    requestedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    requestedBy: options.requestedBy || 'unknown',
    reason: options.reason || 'Plan marked as requiring approval before execution.',
    requiredRoles: ['approver'],
    requiredEntitlements: ['approve.execution'],
    decision: null,
    approvalUrl: buildApprovalUrl(crypto.randomUUID())
  };
  approval.approvalUrl = buildApprovalUrl(approval.approvalId);
  approvalRequests.set(approval.approvalId, approval);
  persistApprovalRequests();
  recordAudit('approval_requested', { approvalId: approval.approvalId, planId: plan.planId, sessionId: plan.sessionId || null, query: plan.query });
  return approval;
}

function getApprovalStatus(approvalId) {
  pruneApprovals();
  return approvalRequests.get(approvalId) || null;
}

function actorCanApprove(actor) {
  if (!actor) return false;
  const roles = new Set(actor.roles || []);
  const entitlements = new Set(actor.entitlements || []);
  return roles.has('approver') || entitlements.has('approve.execution');
}

function applyApprovalDecision(approvalId, decision, actor, note = '') {
  const approval = getApprovalStatus(approvalId);
  if (!approval) throw new Error(`Unknown approvalId: ${approvalId}`);
  if (!actorCanApprove(actor)) throw new Error('Actor is not authorized to approve execution requests.');
  approval.status = decision === 'approved' ? 'approved' : 'rejected';
  approval.updatedAt = new Date().toISOString();
  approval.decision = {
    at: approval.updatedAt,
    by: actor.userId || 'unknown',
    decision: approval.status,
    note
  };
  approvalRequests.set(approval.approvalId, approval);
  persistApprovalRequests();
  recordAudit('approval_decided', { approvalId: approval.approvalId, planId: approval.planId, decision: approval.status, actor: actor.userId || 'unknown' });
  return approval;
}

function approvalSatisfiesPlan(approvalId, planId) {
  const approval = getApprovalStatus(approvalId);
  return Boolean(approval && approval.planId === planId && approval.status === 'approved' && Date.parse(approval.expiresAt) >= Date.now());
}

function renderApprovalHtml(approval, plan) {
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const tools = (plan?.selectedTools || []).map((tool) => `<li><code>${safe(tool.mcpToolName || tool.name)}</code> — ${safe(tool.description || '')}</li>`).join('');
  const decision = approval.decision ? `<p><strong>Decision:</strong> ${safe(approval.decision.decision)} by ${safe(approval.decision.by)} at ${safe(approval.decision.at)}</p>` : '';
  const form = approval.status === 'pending' ? `
    <form method="post" action="/approvals/${safe(approval.approvalId)}/decision">
      <label>Approver bearer token <input type="password" name="token" /></label><br/><br/>
      <label>Note <input type="text" name="note" /></label><br/><br/>
      <button type="submit" name="decision" value="approved">Approve</button>
      <button type="submit" name="decision" value="rejected">Reject</button>
    </form>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Approval ${safe(approval.approvalId)}</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 16px}code{background:#f4f4f4;padding:2px 4px;border-radius:4px}pre{background:#f8f8f8;padding:12px;border-radius:8px;overflow:auto}button{margin-right:8px;padding:8px 12px}</style></head><body><h1>MCP Fabric Approval Request</h1><p><strong>Status:</strong> ${safe(approval.status)}</p><p><strong>Query:</strong> ${safe(approval.query)}</p><p><strong>Reason:</strong> ${safe(approval.reason)}</p><p><strong>Requested by:</strong> ${safe(approval.requestedBy)}</p><p><strong>Expires:</strong> ${safe(approval.expiresAt)}</p>${decision}<h2>Planned tool calls</h2><ul>${tools}</ul><h2>Plan snapshot</h2><pre>${safe(JSON.stringify(plan, null, 2))}</pre>${form}</body></html>`;
}

function loadCatalogs() {
  if (!fs.existsSync(catalogDir)) return [];
  return fs
    .readdirSync(catalogDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(catalogDir, f), 'utf8')));
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function loadJsonFile(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function serializeSession(session) {
  return {
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    queryHistory: session.queryHistory,
    recentResults: session.recentResults,
    planIds: session.planIds,
    resultCache: Array.from(session.resultCache.values()),
    resultResources: Array.from(session.resultResources.values()).map((entry) => ({
      ...entry,
      rawDataPreview: makeResultPreview(entry.rawData)
    })),
    entityMemory: Object.fromEntries(Array.from(session.entityMemory.entries())),
    context: session.context,
    stats: session.stats
  };
}

function persistRuntimeState() {
  if (fabricConfig.runtime?.persistSessions) {
    const payload = {
      updatedAt: new Date().toISOString(),
      sessions: Array.from(sessions.values()).map(serializeSession)
    };
    writeJsonFile(sessionStateFile, payload);
  }
  if (fabricConfig.runtime?.persistAudit) {
    writeJsonFile(auditFile, { updatedAt: new Date().toISOString(), events: auditEvents.slice(-500) });
    writeJsonFile(healthFile, {
      updatedAt: new Date().toISOString(),
      snapshots: Array.from(healthSnapshots.values())
    });
  }
  persistApprovalRequests();
}

function restoreRuntimeState() {
  const payload = loadJsonFile(sessionStateFile, null);
  if (payload?.sessions) {
    for (const saved of payload.sessions) {
      const session = {
        sessionId: saved.sessionId,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
        queryHistory: saved.queryHistory || [],
        recentResults: saved.recentResults || [],
        planIds: saved.planIds || [],
        resultCache: new Map((saved.resultCache || []).map((entry) => [entry.cacheKey, entry])),
        resultResources: new Map((saved.resultResources || []).map((entry) => [entry.resultId, { ...entry, rawData: entry.rawDataPreview || null }])),
        entityMemory: new Map(Object.entries(saved.entityMemory || {})),
        context: saved.context || { actor: { userId: null, roles: [], entitlements: [] }, preferences: { largeResultMode: 'summary_only' } },
        stats: saved.stats || {
          cacheHits: 0,
          liveCalls: 0,
          savedCalls: 0,
          entityResolutions: 0,
          authorizationDenied: 0,
          largeResultsShaped: 0
        }
      };
      sessions.set(session.sessionId, session);
    }
  }

  const auditPayload = loadJsonFile(auditFile, null);
  if (auditPayload?.events) {
    auditEvents.push(...auditPayload.events.slice(-500));
  }

  const healthPayload = loadJsonFile(healthFile, null);
  if (healthPayload?.snapshots) {
    for (const snap of healthPayload.snapshots) {
      if (snap?.serviceName) healthSnapshots.set(snap.serviceName, snap);
    }
  }
  restoreApprovalRequests();
}

function recordAudit(eventType, payload = {}) {
  const entry = {
    auditId: crypto.randomUUID(),
    at: new Date().toISOString(),
    eventType,
    payload
  };
  auditEvents.push(entry);
  while (auditEvents.length > 500) auditEvents.shift();
  persistRuntimeState();
  return entry;
}

async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const retries = RETRY_METHODS.has(method) ? MAX_RETRIES : 0;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('request_timeout')), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok || attempt === retries || !RETRY_METHODS.has(method)) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === retries) throw error;
    }
  }
  throw lastError || new Error('request_failed');
}

async function getServiceHealth(forceRefresh = false) {
  const now = Date.now();
  const snapshots = [];
  for (const catalog of catalogs) {
    const cached = healthSnapshots.get(catalog.serviceName);
    if (!forceRefresh && cached && (now - Date.parse(cached.checkedAt)) < HEALTH_CACHE_TTL_MS) {
      snapshots.push(cached);
      continue;
    }
    const healthUrl = String(catalog.baseUrl).replace(/\/+$/, '') + '/health';
    const started = Date.now();
    let snapshot;
    try {
      const res = await fetchWithRetry(healthUrl, { method: 'GET' });
      const contentType = res.headers.get('content-type') || '';
      const body = contentType.includes('application/json') ? await res.json() : await res.text();
      snapshot = {
        serviceName: catalog.serviceName,
        baseUrl: catalog.baseUrl,
        checkedAt: new Date().toISOString(),
        ok: res.ok,
        status: res.status,
        latencyMs: Date.now() - started,
        body
      };
    } catch (error) {
      snapshot = {
        serviceName: catalog.serviceName,
        baseUrl: catalog.baseUrl,
        checkedAt: new Date().toISOString(),
        ok: false,
        status: 0,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    healthSnapshots.set(catalog.serviceName, snapshot);
    snapshots.push(snapshot);
  }
  persistRuntimeState();
  return snapshots;
}

function buildCatalogValidationReport(catalogsToValidate) {
  const warnings = [];
  for (const catalog of catalogsToValidate) {
    for (const tool of catalog.tools || []) {
      if (!tool.description) warnings.push({ serviceName: catalog.serviceName, toolName: tool.name, severity: 'warning', issue: 'missing_description' });
      if (!tool.inputSchema) warnings.push({ serviceName: catalog.serviceName, toolName: tool.name, severity: 'warning', issue: 'missing_input_schema' });
      if ((tool.method || '').toUpperCase() !== 'GET' && (!tool.riskLevel || tool.riskLevel === 'unknown')) warnings.push({ serviceName: catalog.serviceName, toolName: tool.name, severity: 'warning', issue: 'mutation_without_risk_level' });
      if (!tool.operationId) warnings.push({ serviceName: catalog.serviceName, toolName: tool.name, severity: 'warning', issue: 'missing_operation_id' });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    services: catalogsToValidate.length,
    warnings,
    warningCount: warnings.length
  };
}

function normalizeName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function sanitizeMcpToolName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[./\s:]+/g, '_')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}


const ENTITY_TYPE_SYNONYMS = {
  tradeId: ['trade', 'trades', 'transaction'],
  counterpartyId: ['counterparty', 'counterparties', 'cp', 'limit', 'limits', 'exposure', 'exposures', 'breach', 'breaches', 'risk'],
  currency: ['currency', 'currencies', 'rate', 'rates', 'fx'],
  portfolioId: ['portfolio', 'portfolios', 'position', 'positions'],
  settlementId: ['settlement', 'settlements']
};

function mapTokenToEntityType(token) {
  const normalized = String(token || '').toLowerCase();
  for (const [entityType, aliases] of Object.entries(ENTITY_TYPE_SYNONYMS)) {
    if (aliases.includes(normalized)) return entityType;
  }
  return null;
}

function inferToolSemanticKeywords(tool) {
  return unique([
    ...tokenize(tool.serviceName),
    ...tokenize(tool.name),
    ...tokenize(tool.operationId),
    ...tokenize(tool.description),
    ...tokenize(tool.path),
    ...(tool.tags || []).flatMap((x) => tokenize(x)),
    ...(tool.domainKeywords || []).flatMap((x) => tokenize(x))
  ]);
}

function inferRequiredEntityTypes(tool) {
  return unique(
    (tool.inputSchema?.required || [])
      .filter((key) => !['body', 'query'].includes(String(key).toLowerCase()))
      .map((key) => normalizeEntityType(key))
  );
}

function inferProducedEntityTypes(tool) {
  const keywords = inferToolSemanticKeywords(tool);
  const produced = new Set(inferRequiredEntityTypes(tool));

  for (const keyword of keywords) {
    const inferred = mapTokenToEntityType(keyword);
    if (inferred) produced.add(inferred);
  }

  const isReadDetail = tool.method === 'GET' && extractPathParams(tool.path).length > 0;
  if (isReadDetail) {
    if (produced.has('tradeId')) {
      produced.add('counterpartyId');
      produced.add('portfolioId');
      produced.add('currency');
      if (keywords.includes('settlement')) produced.add('settlementId');
    }
    if (produced.has('counterpartyId') && (keywords.includes('limit') || keywords.includes('exposure') || keywords.includes('risk'))) {
      produced.add('counterpartyId');
    }
  }

  return [...produced];
}

function computeToolSemanticProfile(tool) {
  const requiredEntityTypes = inferRequiredEntityTypes(tool);
  const producedEntityTypes = inferProducedEntityTypes(tool);
  const semanticKeywords = inferToolSemanticKeywords(tool);
  return {
    requiredEntityTypes,
    producedEntityTypes,
    semanticKeywords,
    isCollectionEndpoint: tool.method === 'GET' && extractPathParams(tool.path).length === 0,
    isDetailEndpoint: tool.method === 'GET' && extractPathParams(tool.path).length > 0
  };
}

function deriveToolName(serviceName, tool) {
  const op = tool.operationId || tool.name || `${tool.method}_${tool.path}`;
  return sanitizeMcpToolName(`${normalizeName(serviceName)}_${normalizeName(op)}`);
}

function flattenTools(catalogs) {
  const tools = [];
  for (const catalog of catalogs) {
    for (const tool of catalog.tools || []) {
      const enrichedTool = {
        ...tool,
        serviceName: catalog.serviceName,
        baseUrl: catalog.baseUrl,
        serviceType: catalog.serviceType,
        domainKeywords: catalog.domainKeywords || [],
        frameworkSummary: catalog.frameworkSummary || {},
        defaultAllowedRoles: catalog.defaultAllowedRoles || [],
        mcpToolName: deriveToolName(catalog.serviceName, tool)
      };
      enrichedTool.semanticProfile = computeToolSemanticProfile(enrichedTool);
      tools.push(enrichedTool);
    }
  }
  return tools;
}

function extractPathParams(pathTemplate) {
  return Array.from(pathTemplate.matchAll(/\{([^}]+)\}|:([A-Za-z0-9_]+)/g)).map((m) => m[1] || m[2]);
}

function applyPath(pathTemplate, args) {
  let result = pathTemplate;
  for (const key of extractPathParams(pathTemplate)) {
    const value = args[key];
    if (value === undefined || value === null) throw new Error(`Missing required path parameter: ${key}`);
    result = result.replace(`{${key}}`, encodeURIComponent(String(value)));
    result = result.replace(`:${key}`, encodeURIComponent(String(value)));
  }
  return result;
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function containsMutationVerb(query) {
  const q = String(query || '').toLowerCase();
  return /(create|update|delete|cancel|approve|submit|book|modify|amend|close|open)/.test(q);
}

function rankToolsByQuery(query, toolCatalog) {
  const q = String(query || '').toLowerCase();
  const tokens = tokenize(q);

  return toolCatalog
    .map((tool) => {
      let score = 0;
      const hay = [
        tool.serviceName,
        tool.name,
        tool.operationId,
        tool.description,
        tool.path,
        ...(tool.tags || []),
        ...(tool.domainKeywords || [])
      ].join(' ').toLowerCase();

      if (q.includes(String(tool.name || '').toLowerCase())) score += 10;
      if (q.includes(String(tool.operationId || '').toLowerCase())) score += 8;
      if (q.includes(String(tool.path || '').toLowerCase())) score += 6;

      for (const kw of [...(tool.domainKeywords || []), ...(tool.tags || [])]) {
        if (q.includes(String(kw).toLowerCase())) score += 4;
      }

      for (const token of tokens) {
        if (hay.includes(token)) score += 1;
      }

      if (tool.safe === true) score += 1;
      if (tool.riskLevel === 'low') score += 1;

      return { tool, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

function deriveIntent(query, rankedTools) {
  const mutationRequested = containsMutationVerb(query);
  const topTool = rankedTools[0]?.tool;
  const riskLevel = mutationRequested
    ? 'high'
    : topTool?.riskLevel || 'low';
  const requiresApproval = (mutationRequested && !ALLOW_MUTATION_WITHOUT_APPROVAL) || ['medium', 'high'].includes(riskLevel);

  return {
    mode: mutationRequested ? 'write-intent' : 'read-intent',
    riskLevel,
    requiresApproval,
    summary: mutationRequested
      ? 'Potential mutation request detected; approval is recommended before execution.'
      : 'Read-oriented request detected; execution can be automatic for safe tools.'
  };
}

function sanitizeSessionId(value) {
  const raw = String(value || 'default').trim();
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'default';
}

function pruneVault() {
  const now = Date.now();
  for (const [resultId, entry] of resultVault.entries()) {
    if ((entry.expiresAtMs || 0) <= now) resultVault.delete(resultId);
  }
}

function pruneExpiredCacheEntries(session) {
  const now = Date.now();
  for (const [cacheKey, entry] of session.resultCache.entries()) {
    if ((entry.expiresAtMs || 0) <= now) {
      session.resultCache.delete(cacheKey);
    }
  }
  for (const [resultId, entry] of session.resultResources.entries()) {
    if ((entry.expiresAtMs || 0) <= now) {
      session.resultResources.delete(resultId);
    }
  }
}

function trimSessionCollections(session) {
  while (session.queryHistory.length > MAX_SESSION_HISTORY) session.queryHistory.shift();
  while (session.recentResults.length > MAX_SESSION_RESULTS) session.recentResults.shift();
  while (session.resultCache.size > MAX_SESSION_CACHE) {
    const oldestKey = session.resultCache.keys().next().value;
    if (!oldestKey) break;
    session.resultCache.delete(oldestKey);
  }
  while (session.resultResources.size > MAX_RESULT_RESOURCES) {
    const oldestKey = session.resultResources.keys().next().value;
    if (!oldestKey) break;
    session.resultResources.delete(oldestKey);
  }
  for (const [entityType, values] of session.entityMemory.entries()) {
    while (values.length > MAX_ENTITY_VALUES) values.pop();
    if (values.length === 0) session.entityMemory.delete(entityType);
  }
}

function getOrCreateSession(sessionId) {
  const normalizedId = sanitizeSessionId(sessionId);
  let session = sessions.get(normalizedId);
  if (!session) {
    session = {
      sessionId: normalizedId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      queryHistory: [],
      recentResults: [],
      planIds: [],
      resultCache: new Map(),
      resultResources: new Map(),
      entityMemory: new Map(),
      context: {
        actor: {
          userId: null,
          roles: [],
          entitlements: []
        },
        preferences: {
          largeResultMode: 'summary_only'
        }
      },
      stats: {
        cacheHits: 0,
        liveCalls: 0,
        savedCalls: 0,
        entityResolutions: 0,
        authorizationDenied: 0,
        largeResultsShaped: 0
      }
    };
    sessions.set(normalizedId, session);
  }
  pruneExpiredCacheEntries(session);
  pruneVault();
  trimSessionCollections(session);
  session.updatedAt = new Date().toISOString();
  return session;
}

function stableSortValue(value) {
  if (Array.isArray(value)) return value.map(stableSortValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableSortValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function buildToolCacheKey(tool, args) {
  return `${tool.mcpToolName}::${JSON.stringify(stableSortValue(args || {}))}`;
}

function makeResultPreview(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 280 ? `${text.slice(0, 280)}...` : text;
}

function getToolAccessPolicy(tool) {
  const policy = tool.accessPolicy || {};
  const allowedRoles = unique([
    ...(policy.allowedRoles || []),
    ...(tool.allowedRoles || []),
    ...(tool.auth?.roles || []),
    ...(tool.defaultAllowedRoles || [])
  ]);
  const requiredEntitlements = unique([
    ...(policy.requiredEntitlements || []),
    ...(tool.requiredEntitlements || []),
    ...(tool.auth?.entitlements || [])
  ]);
  return {
    allowedRoles,
    requiredEntitlements
  };
}

function authorizeTool(tool, session) {
  const policy = getToolAccessPolicy(tool);
  if (policy.allowedRoles.length === 0 && policy.requiredEntitlements.length === 0) {
    return { allowed: true, reason: 'no_explicit_policy' };
  }
  const actor = session?.context?.actor || { roles: [], entitlements: [] };
  const actorRoles = new Set((actor.roles || []).map((x) => String(x).toLowerCase()));
  const actorEntitlements = new Set((actor.entitlements || []).map((x) => String(x).toLowerCase()));

  const roleOk = policy.allowedRoles.length === 0 || policy.allowedRoles.some((x) => actorRoles.has(String(x).toLowerCase()));
  const entitlementsOk = policy.requiredEntitlements.length === 0 || policy.requiredEntitlements.every((x) => actorEntitlements.has(String(x).toLowerCase()));

  if (roleOk && entitlementsOk) return { allowed: true, reason: 'authorized' };

  return {
    allowed: false,
    reason: 'authorization_failed',
    requiredRoles: policy.allowedRoles,
    requiredEntitlements: policy.requiredEntitlements,
    actorRoles: actor.roles || [],
    actorEntitlements: actor.entitlements || []
  };
}

function normalizeEntityType(type) {
  const t = String(type || '').toLowerCase();
  if (!t) return 'unknown';
  if (['tradeid', 'trade_id', 'trade'].includes(t)) return 'tradeId';
  if (['counterpartyid', 'counterparty_id', 'counterparty', 'cp'].includes(t)) return 'counterpartyId';
  if (['currency', 'ccy'].includes(t)) return 'currency';
  if (['portfolioid', 'portfolio_id', 'portfolio'].includes(t)) return 'portfolioId';
  if (['settlementid', 'settlement_id', 'settlement'].includes(t)) return 'settlementId';
  return t;
}

function entityTypeForParam(paramName) {
  return normalizeEntityType(paramName);
}

function extractEntitiesFromText(text) {
  const entities = [];
  const input = String(text || '');

  for (const match of input.matchAll(/\bT-\d{3,}\b/g)) {
    entities.push({ type: 'tradeId', value: match[0], confidence: 0.95, source: 'text' });
  }
  for (const match of input.matchAll(/\bCP-\d{3,}\b/g)) {
    entities.push({ type: 'counterpartyId', value: match[0], confidence: 0.95, source: 'text' });
  }
  for (const match of input.matchAll(/\b[A-Z]{3}\b/g)) {
    if (['USD', 'EUR', 'GBP', 'JPY', 'INR', 'AUD', 'CAD', 'CHF'].includes(match[0])) {
      entities.push({ type: 'currency', value: match[0], confidence: 0.7, source: 'text' });
    }
  }

  return entities;
}

function extractEntitiesFromData(data, seen = new Set(), depth = 0) {
  if (data == null || depth > 4) return [];
  const entities = [];

  if (typeof data === 'string') {
    return extractEntitiesFromText(data);
  }

  if (Array.isArray(data)) {
    for (const item of data.slice(0, 20)) {
      for (const entity of extractEntitiesFromData(item, seen, depth + 1)) entities.push(entity);
    }
    return entities;
  }

  if (typeof data === 'object') {
    if (seen.has(data)) return [];
    seen.add(data);
    for (const [key, value] of Object.entries(data)) {
      const entityType = normalizeEntityType(key);
      if (typeof value === 'string' && value.trim()) {
        if (['tradeId', 'counterpartyId', 'currency', 'portfolioId', 'settlementId'].includes(entityType)) {
          entities.push({ type: entityType, value: value.trim(), confidence: 0.9, source: 'data', key });
        }
        for (const entity of extractEntitiesFromText(value)) entities.push(entity);
      } else if (typeof value === 'number' && ['amount', 'limit'].includes(String(key).toLowerCase())) {
        entities.push({ type: normalizeEntityType(key), value, confidence: 0.5, source: 'data', key });
      } else if (typeof value === 'object') {
        for (const entity of extractEntitiesFromData(value, seen, depth + 1)) entities.push(entity);
      }
    }
  }

  return entities;
}

function upsertEntityMemory(session, entity, metadata = {}) {
  const entityType = normalizeEntityType(entity.type);
  if (!entityType || entity.value == null) return;
  const values = session.entityMemory.get(entityType) || [];
  const now = new Date().toISOString();
  const normalizedValue = typeof entity.value === 'string' ? entity.value.trim() : entity.value;
  const existingIndex = values.findIndex((x) => String(x.value) === String(normalizedValue));
  const record = {
    type: entityType,
    value: normalizedValue,
    confidence: entity.confidence ?? 0.7,
    source: entity.source || metadata.source || 'unknown',
    key: entity.key,
    lastSeenAt: now,
    ...metadata
  };
  if (existingIndex >= 0) {
    values.splice(existingIndex, 1);
  }
  values.unshift(record);
  session.entityMemory.set(entityType, values.slice(0, MAX_ENTITY_VALUES));
  session.updatedAt = now;
}

function recordEntitiesForSession(session, payload, metadata = {}) {
  if (!session) return;
  const entities = typeof payload === 'string'
    ? extractEntitiesFromText(payload)
    : extractEntitiesFromData(payload);
  for (const entity of entities) upsertEntityMemory(session, entity, metadata);
}

function buildEntitySummaryFromStore(entityStore) {
  const summary = {};
  for (const [type, values] of entityStore.entries()) {
    summary[type] = values.map((x) => ({
      value: x.value,
      confidence: x.confidence,
      source: x.source,
      lastSeenAt: x.lastSeenAt,
      fromTool: x.fromTool || null,
      fromQuery: x.fromQuery || null
    }));
  }
  return summary;
}

function buildEntitySummary(session) {
  return buildEntitySummaryFromStore(session.entityMemory);
}

function getMissingRequiredArgs(tool, args) {
  const required = tool.inputSchema?.required || [];
  return required.filter((key) => args[key] === undefined || args[key] === null || args[key] === '');
}

function createExecutionChainState() {
  return {
    entityMemory: new Map(),
    resultSequence: [],
    toolResultIndex: new Map()
  };
}

function recordEntitiesForEntityStore(entityStore, payload, metadata = {}) {
  const entities = typeof payload === 'string'
    ? extractEntitiesFromText(payload)
    : extractEntitiesFromData(payload);
  for (const entity of entities) {
    const entityType = normalizeEntityType(entity.type);
    if (!entityType || entity.value == null) continue;
    const values = entityStore.get(entityType) || [];
    const now = new Date().toISOString();
    const normalizedValue = typeof entity.value === 'string' ? entity.value.trim() : entity.value;
    const existingIndex = values.findIndex((x) => String(x.value) === String(normalizedValue));
    const record = {
      type: entityType,
      value: normalizedValue,
      confidence: entity.confidence ?? 0.7,
      source: entity.source || metadata.source || 'unknown',
      key: entity.key,
      lastSeenAt: now,
      ...metadata
    };
    if (existingIndex >= 0) values.splice(existingIndex, 1);
    values.unshift(record);
    entityStore.set(entityType, values.slice(0, MAX_ENTITY_VALUES));
  }
}

function recordExecutionChainEntities(chainState, payload, metadata = {}) {
  if (!chainState) return;
  recordEntitiesForEntityStore(chainState.entityMemory, payload, metadata);
}

function inferRequiredParamResolutions(tool, args, session, query = '', chainState = null) {
  const resolvedArgs = { ...args };
  const resolvedFromMemory = [];
  const required = tool.inputSchema?.required || [];
  const queryLower = String(query || '').toLowerCase();
  const relativeReference = /(same|that|it|this|previous|above|there|those|them)/.test(queryLower);

  for (const key of required) {
    if (resolvedArgs[key] !== undefined && resolvedArgs[key] !== null && resolvedArgs[key] !== '') continue;
    const entityType = entityTypeForParam(key);
    const chainCandidates = chainState?.entityMemory?.get(entityType) || [];
    const sessionCandidates = session?.entityMemory?.get(entityType) || [];

    let chosen = null;
    let source = null;

    if (chainCandidates.length > 0 && (chainCandidates.length === 1 || relativeReference || !String(query || '').trim())) {
      chosen = chainCandidates[0];
      source = 'cross_tool_chain';
    } else if (sessionCandidates.length > 0 && (sessionCandidates.length === 1 || relativeReference || !String(query || '').trim())) {
      chosen = sessionCandidates[0];
      source = 'entity_memory';
    }

    if (chosen) {
      resolvedArgs[key] = chosen.value;
      resolvedFromMemory.push({
        param: key,
        entityType,
        value: chosen.value,
        source,
        fromTool: chosen.fromTool || null
      });
      if (session) session.stats.entityResolutions += 1;
    }
  }

  return { resolvedArgs, resolvedFromMemory };
}

function buildSessionSummary(session) {
  pruneExpiredCacheEntries(session);
  const cacheEntries = Array.from(session.resultCache.values())
    .sort((a, b) => Date.parse(b.cachedAt) - Date.parse(a.cachedAt));

  return {
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    actorContext: session.context.actor,
    preferences: session.context.preferences,
    queryHistory: session.queryHistory,
    recentResults: session.recentResults,
    planIds: session.planIds,
    entities: buildEntitySummary(session),
    stats: {
      ...session.stats,
      activeCacheEntries: session.resultCache.size,
      activeResultResources: session.resultResources.size
    },
    reusableCachedResults: cacheEntries.map((entry) => ({
      toolName: entry.toolName,
      cachedAt: entry.cachedAt,
      expiresAt: entry.expiresAt,
      arguments: entry.args,
      preview: entry.preview,
      resultSummary: entry.resultSummary
    }))
  };
}

function recordSessionQuery(session, query, planId) {
  session.queryHistory.push({ at: new Date().toISOString(), query, planId });
  session.planIds.push(planId);
  trimSessionCollections(session);
  session.updatedAt = new Date().toISOString();
  recordEntitiesForSession(session, query, { source: 'query', fromQuery: query });
}

function findReusableCachedResults(session, selectedTools) {
  pruneExpiredCacheEntries(session);
  const toolNames = new Set(selectedTools.map((x) => x.tool.mcpToolName));
  return Array.from(session.resultCache.values())
    .filter((entry) => toolNames.has(entry.toolName))
    .sort((a, b) => Date.parse(b.cachedAt) - Date.parse(a.cachedAt))
    .slice(0, 10)
    .map((entry) => ({
      toolName: entry.toolName,
      cachedAt: entry.cachedAt,
      expiresAt: entry.expiresAt,
      arguments: entry.args,
      preview: entry.preview,
      resultSummary: entry.resultSummary
    }));
}

function storeResultResource(session, tool, rawData) {
  pruneVault();
  const resultId = crypto.randomUUID();
  const nowMs = Date.now();
  const expiresAtMs = nowMs + RESULT_TTL_MS;
  const entry = {
    resultId,
    sessionId: session?.sessionId || null,
    toolName: tool.mcpToolName,
    serviceName: tool.serviceName,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    rawData
  };
  resultVault.set(resultId, entry);
  if (session) {
    session.resultResources.set(resultId, entry);
    session.updatedAt = new Date(nowMs).toISOString();
    trimSessionCollections(session);
  }
  return {
    resultId,
    resourceUri: session
      ? `memory://session/${session.sessionId}/result/${resultId}`
      : `memory://result/${resultId}`,
    expiresAt: entry.expiresAt
  };
}

function summarizeLargeArray(arrayValue) {
  const previewRows = arrayValue.slice(0, PREVIEW_ROW_LIMIT);
  const columns = unique(previewRows.flatMap((row) => typeof row === 'object' && row ? Object.keys(row) : []));
  const numericColumns = columns.filter((column) => previewRows.some((row) => typeof row?.[column] === 'number')).slice(0, 5);
  const aggregates = {};
  for (const column of numericColumns) {
    const values = previewRows.map((row) => row?.[column]).filter((v) => typeof v === 'number');
    if (values.length > 0) {
      aggregates[column] = {
        min: Math.min(...values),
        max: Math.max(...values)
      };
    }
  }
  return {
    resultType: 'tabular_summary',
    totalRows: arrayValue.length,
    previewRowCount: previewRows.length,
    columns,
    previewRows,
    aggregates
  };
}

function shapeResultPayload(data, session, tool) {
  const serialized = typeof data === 'string' ? data : JSON.stringify(data);
  const isLargeText = typeof serialized === 'string' && serialized.length > MAX_INLINE_TEXT;

  if (Array.isArray(data) && data.length > LARGE_RESULT_ROW_THRESHOLD) {
    const stored = storeResultResource(session, tool, data);
    session && (session.stats.largeResultsShaped += 1);
    return {
      display: 'summary_only',
      systematicOutput: summarizeLargeArray(data),
      fullResult: stored,
      data: undefined
    };
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const arrayEntries = Object.entries(data).filter(([, value]) => Array.isArray(value));
    const largeArrayEntry = arrayEntries.find(([, value]) => value.length > LARGE_RESULT_ROW_THRESHOLD);
    if (largeArrayEntry) {
      const [field, arrayValue] = largeArrayEntry;
      const stored = storeResultResource(session, tool, data);
      session && (session.stats.largeResultsShaped += 1);
      return {
        display: 'summary_only',
        systematicOutput: {
          resultType: 'object_with_large_collection',
          field,
          ...summarizeLargeArray(arrayValue),
          objectKeys: Object.keys(data)
        },
        fullResult: stored,
        data: {
          ...Object.fromEntries(Object.entries(data).filter(([key]) => key !== field)),
          [field]: `Large collection omitted from inline response. Read ${stored.resourceUri} for full payload.`
        }
      };
    }
  }

  if (isLargeText) {
    const stored = storeResultResource(session, tool, data);
    session && (session.stats.largeResultsShaped += 1);
    return {
      display: 'summary_only',
      systematicOutput: {
        resultType: 'large_text',
        preview: serialized.slice(0, MAX_INLINE_TEXT),
        totalChars: serialized.length
      },
      fullResult: stored,
      data: undefined
    };
  }

  return {
    display: 'inline',
    systematicOutput: {
      resultType: Array.isArray(data) ? 'array' : typeof data,
      totalRows: Array.isArray(data) ? data.length : undefined
    },
    fullResult: null,
    data
  };
}

function storeSessionResult(session, tool, args, result, source = 'live_api') {
  if (!session || !result?.ok || source !== 'live_api') return;
  if (!(tool.safe === true || tool.method === 'GET')) return;

  const cacheKey = buildToolCacheKey(tool, args);
  const cachedAtMs = Date.now();
  const expiresAtMs = cachedAtMs + SESSION_TTL_MS;
  const entry = {
    cacheKey,
    toolName: tool.mcpToolName,
    args,
    cachedAt: new Date(cachedAtMs).toISOString(),
    cachedAtMs,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    preview: makeResultPreview(result.data),
    resultSummary: {
      ok: result.ok,
      status: result.status,
      latencyMs: result.latencyMs,
      serviceName: result.serviceName,
      invokedUrl: result.invokedUrl
    },
    result
  };

  session.resultCache.set(cacheKey, entry);
  session.recentResults.push({
    at: entry.cachedAt,
    toolName: tool.mcpToolName,
    source,
    preview: entry.preview,
    arguments: args,
    status: result.status,
    ok: result.ok
  });
  trimSessionCollections(session);
  session.updatedAt = entry.cachedAt;
}

function readFromSessionCache(session, tool, args) {
  if (!session) return null;
  pruneExpiredCacheEntries(session);
  const cacheKey = buildToolCacheKey(tool, args);
  return session.resultCache.get(cacheKey) || null;
}

function buildResourceUris(rankedTools, sessionId) {
  const serviceNames = unique(rankedTools.slice(0, 3).map((x) => x.tool.serviceName));
  const uris = [
    'catalog://services',
    'catalog://tools',
    'catalog://metrics',
    'catalog://validation',
    'catalog://runtime',
    'catalog://health',
    'catalog://planner/system'
  ];

  for (const serviceName of serviceNames) {
    uris.push(`catalog://service/${serviceName}`);
    uris.push(`catalog://service/${serviceName}/openapi-derived`);
  }

  for (const item of rankedTools.slice(0, 5)) {
    uris.push(`catalog://tool/${item.tool.serviceName}/${item.tool.name}`);
  }

  if (sessionId) {
    uris.push('memory://sessions');
    uris.push(`memory://session/${sanitizeSessionId(sessionId)}`);
    uris.push(`memory://session/${sanitizeSessionId(sessionId)}/entities`);
  }

  return unique(uris);
}

function summarizeTool(tool, score, session = null) {
  const authorization = authorizeTool(tool, session);
  return {
    name: tool.mcpToolName,
    serviceName: tool.serviceName,
    method: tool.method,
    path: tool.path,
    score,
    safe: tool.safe,
    riskLevel: tool.riskLevel || 'unknown',
    description: tool.description,
    tags: tool.tags || [],
    semanticProfile: tool.semanticProfile,
    authorization,
    inputSchema: tool.inputSchema || { type: 'object', properties: {}, required: [] }
  };
}


function getAvailableEntityTypesForPlanning(query, session) {
  const fromQuery = extractEntitiesFromText(query).map((x) => normalizeEntityType(x.type));
  const fromSession = session ? Array.from(session.entityMemory.keys()).map((x) => normalizeEntityType(x)) : [];
  return new Set(unique([...fromQuery, ...fromSession]));
}

function isPrefixPathDependency(producer, consumer) {
  const producerPath = String(producer.path || '');
  const consumerPath = String(consumer.path || '');
  return producerPath !== consumerPath && consumerPath.startsWith(producerPath.replace(/\/$/, ''));
}

function computeSemanticDependencyScore(producerEntry, consumerEntry, queryTokens, availableEntityTypes) {
  const producer = producerEntry.tool;
  const consumer = consumerEntry.tool;
  const producerProfile = producer.semanticProfile || computeToolSemanticProfile(producer);
  const consumerProfile = consumer.semanticProfile || computeToolSemanticProfile(consumer);

  const missingRequired = consumerProfile.requiredEntityTypes.filter((x) => !availableEntityTypes.has(x));
  const producedForConsumer = missingRequired.filter((x) => producerProfile.producedEntityTypes.includes(x));
  let score = producedForConsumer.length * 8;

  if (score === 0 && isPrefixPathDependency(producer, consumer)) {
    score += 5;
  }

  if (producerProfile.isDetailEndpoint && consumerProfile.isDetailEndpoint && isPrefixPathDependency(producer, consumer)) {
    score += 3;
  }

  const queryMentionsProducer = producerProfile.semanticKeywords.some((kw) => queryTokens.includes(kw));
  const queryMentionsConsumer = consumerProfile.semanticKeywords.some((kw) => queryTokens.includes(kw));
  if (queryMentionsProducer && queryMentionsConsumer) score += 2;
  if (queryTokens.includes('then') || queryTokens.includes('after') || queryTokens.includes('with')) score += 1;
  if (producer.method === 'GET' && producer.safe === true) score += 1;

  if (score <= 0) return null;
  return {
    from: producer.mcpToolName,
    to: consumer.mcpToolName,
    score,
    reason: producedForConsumer.length > 0
      ? `Producer can provide ${producedForConsumer.join(', ')} needed by consumer.`
      : 'Producer is a likely semantic precursor based on endpoint structure and query intent.',
    producedEntities: producerProfile.producedEntityTypes,
    requiredEntities: consumerProfile.requiredEntityTypes,
    bridgingEntities: producedForConsumer
  };
}

function buildSemanticDependencyPlan(selectedEntries, query, session = null) {
  const queryTokens = unique(tokenize(query));
  const availableEntityTypes = getAvailableEntityTypesForPlanning(query, session);
  const edges = [];
  const outgoingBoost = new Map();
  const indegree = new Map(selectedEntries.map((entry) => [entry.tool.mcpToolName, 0]));

  for (let i = 0; i < selectedEntries.length; i += 1) {
    for (let j = 0; j < selectedEntries.length; j += 1) {
      if (i === j) continue;
      const edge = computeSemanticDependencyScore(selectedEntries[i], selectedEntries[j], queryTokens, availableEntityTypes);
      if (!edge) continue;
      edges.push(edge);
      indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
      outgoingBoost.set(edge.from, (outgoingBoost.get(edge.from) || 0) + edge.score);
    }
  }

  const byName = new Map(selectedEntries.map((entry) => [entry.tool.mcpToolName, entry]));
  const queue = selectedEntries
    .filter((entry) => (indegree.get(entry.tool.mcpToolName) || 0) === 0)
    .sort((a, b) => ((outgoingBoost.get(b.tool.mcpToolName) || 0) - (outgoingBoost.get(a.tool.mcpToolName) || 0)) || (b.score - a.score));

  const ordered = [];
  const consumed = new Set();
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry || consumed.has(entry.tool.mcpToolName)) continue;
    consumed.add(entry.tool.mcpToolName);
    ordered.push(entry);
    for (const edge of edges.filter((x) => x.from === entry.tool.mcpToolName)) {
      indegree.set(edge.to, (indegree.get(edge.to) || 0) - 1);
      if ((indegree.get(edge.to) || 0) === 0) {
        const next = byName.get(edge.to);
        if (next && !consumed.has(next.tool.mcpToolName)) queue.push(next);
      }
    }
    queue.sort((a, b) => ((outgoingBoost.get(b.tool.mcpToolName) || 0) - (outgoingBoost.get(a.tool.mcpToolName) || 0)) || (b.score - a.score));
  }

  const fallback = selectedEntries
    .filter((entry) => !consumed.has(entry.tool.mcpToolName))
    .sort((a, b) => ((outgoingBoost.get(b.tool.mcpToolName) || 0) - (outgoingBoost.get(a.tool.mcpToolName) || 0)) || (b.score - a.score));

  return {
    orderedEntries: [...ordered, ...fallback],
    edges,
    availableEntityTypes: [...availableEntityTypes],
    notes: [
      'Semantic dependency planning prefers tools that can produce entities needed by later tools.',
      'Path hierarchy and detail-before-child endpoint structure also influence ordering.',
      'If the session or query already provides an entity, dependency pressure for that entity is reduced.'
    ]
  };
}

function buildPlan(query, catalogs, toolCatalog, options = {}) {
  const ranked = rankToolsByQuery(query, toolCatalog);
  const intent = deriveIntent(query, ranked);
  const selected = ranked.slice(0, Number(options.maxCandidates || 5));
  const planId = `plan_${crypto.randomUUID()}`;
  const sessionId = options.sessionId ? sanitizeSessionId(options.sessionId) : undefined;
  const session = sessionId ? getOrCreateSession(sessionId) : null;
  const semanticPlan = buildSemanticDependencyPlan(selected, query, session);
  const orderedSelected = semanticPlan.orderedEntries;
  const resourceUris = buildResourceUris(orderedSelected, sessionId);
  const reusableCachedResults = session ? findReusableCachedResults(session, orderedSelected) : [];
  const rememberedEntities = session ? buildEntitySummary(session) : {};

  const steps = [
    {
      id: 'step_1',
      type: 'inspect_resources',
      description: 'Read service, tool, planner, and memory resources relevant to the query.',
      resourceUris
    },
    {
      id: 'step_2',
      type: 'select_tools',
      description: 'Choose the best API-backed tool candidates for the query.',
      candidateTools: orderedSelected.map((x) => summarizeTool(x.tool, x.score, session))
    }
  ];

  if (session) {
    steps.splice(1, 0, {
      id: 'step_memory',
      type: 'inspect_session_memory',
      description: 'Inspect recent session context, remembered entities, and reusable cached tool results before making live API calls.',
      sessionResource: `memory://session/${session.sessionId}`,
      entityResource: `memory://session/${session.sessionId}/entities`,
      rememberedEntities,
      reusableCachedResults,
      actorContext: session.context.actor
    });
  }

  if (orderedSelected.length > 0) {
    steps.push({
      id: 'step_2b',
      type: 'semantic_dependency_planning',
      description: 'Order candidate tools using semantic dependency planning so producer tools run before consumer tools when later steps need entities produced earlier.',
      dependencyAnalysis: semanticPlan.edges,
      orderedTools: orderedSelected.map((x) => x.tool.mcpToolName),
      availableEntityTypes: semanticPlan.availableEntityTypes,
      notes: semanticPlan.notes
    });
    steps.push({
      id: 'step_3',
      type: 'execute_tools',
      description: intent.requiresApproval
        ? 'Execution requires approval or explicit opt-in because the query looks risky or mutating.'
        : 'Execute the semantically ordered safe tool set using validated arguments, reusing session cache, prior-tool entities, and session memory when possible.',
      defaultTools: orderedSelected.slice(0, 3).map((x) => x.tool.mcpToolName),
      autoExecutable: !intent.requiresApproval,
      cachePolicy: session
        ? 'Prefer session cache for safe repeated calls before issuing live API requests.'
        : 'No session memory attached; live API calls will be used.',
      semanticPlanningPolicy: 'Prefer producer tools before consumer tools when earlier results can supply later required entities.',
      chainPolicy: 'Resolve missing required parameters in this order: explicit arguments, entities learned from earlier tool results in the same plan, then session memory.',
      largeResultPolicy: 'For large payloads, return a systematic summary and expose the full result as a memory resource instead of dumping all rows inline.'
    });
  }

  steps.push({
    id: 'step_4',
    type: 'synthesize_answer',
    description: 'Return a final answer with execution trace, evidence, confidence, entity usage, and whether any cached evidence was reused.'
  });

  const plan = {
    planId,
    sessionId,
    createdAt: new Date().toISOString(),
    query,
    intent,
    transparency: {
      resourcesToRead: resourceUris,
      candidateTools: orderedSelected.map((x) => summarizeTool(x.tool, x.score, session)),
      dependencyAnalysis: semanticPlan.edges,
      reusableCachedResults,
      rememberedEntities,
      actorContext: session?.context?.actor || null,
      notes: [
        'Client or host LLM should ideally read relevant resources before execution.',
        'For mutation-like requests, present plan and seek confirmation before calling APIs.',
        session
          ? 'When the same safe tool is called again with the same arguments, session memory can reuse cached results and can resolve known entities like tradeId or counterpartyId.'
          : 'Attach a sessionId to enable conversation memory, entity reuse, and cached result reuse.',
        'Semantic dependency planning orders producer tools before consumer tools when the later tools need entities produced earlier.',
        'Earlier tool results in the same plan can supply missing arguments for later tools through cross-tool entity chaining.',
        'Large API responses are shaped into systematic summaries with retrievable result resources.'
      ]
    },
    steps,
    executionPolicy: {
      defaultMode: intent.requiresApproval ? 'plan_only' : 'plan_then_execute',
      maxRecommendedToolCalls: intent.requiresApproval ? 0 : Math.min(MAX_AUTO_EXECUTE_TOOLS, orderedSelected.length),
      requiresApproval: intent.requiresApproval,
      cacheEnabled: Boolean(session),
      entityMemoryEnabled: Boolean(session),
      crossToolChainingEnabled: true,
      semanticDependencyPlanningEnabled: true,
      safeOnlyByDefault: SAFE_ONLY_BY_DEFAULT,
      argumentResolutionOrder: ['explicit_arguments', 'prior_tool_results', 'session_memory']
    }
  };

  plans.set(planId, plan);
  if (session) recordSessionQuery(session, query, planId);
  return plan;
}

async function invokeHttpTool(tool, args = {}, context = {}) {
  const session = context.session || null;
  const pathResolved = applyPath(tool.path, args);
  const url = new URL(String(tool.baseUrl).replace(/\/+$/, '') + pathResolved);
  if (tool.method === 'GET' && args.query && typeof args.query === 'object') {
    for (const [k, v] of Object.entries(args.query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }

  const startedAt = Date.now();
  const res = await fetchWithRetry(url, {
    method: tool.method,
    headers: { 'content-type': 'application/json' },
    body: tool.method === 'GET' ? undefined : (args.body !== undefined ? JSON.stringify(args.body) : undefined)
  });

  const contentType = res.headers.get('content-type') || '';
  const rawData = contentType.includes('application/json') ? await res.json() : await res.text();
  const shaped = shapeResultPayload(rawData, session, tool);
  const responseHeaders = {
    contentType,
    demoRequestId: res.headers.get('x-demo-request-id') || null,
    demoServedAt: res.headers.get('x-demo-served-at') || null,
    demoService: res.headers.get('x-demo-service') || null,
    demoSource: res.headers.get('x-demo-source') || null
  };

  return {
    ok: res.ok,
    status: res.status,
    latencyMs: Date.now() - startedAt,
    serviceName: tool.serviceName,
    toolName: tool.mcpToolName,
    invokedUrl: url.toString(),
    request: {
      method: tool.method,
      pathTemplate: tool.path,
      pathResolved,
      arguments: args
    },
    responseHeaders,
    display: shaped.display,
    systematicOutput: shaped.systematicOutput,
    fullResult: shaped.fullResult,
    data: shaped.data
  };
}

async function executePlan(plan, toolCatalog, options = {}) {
  const executionTrace = [];
  const defaultToolNames = plan.steps.find((x) => x.type === 'execute_tools')?.defaultTools || [];
  const computedMaxToolCalls = Number.isFinite(Number(options.maxToolCalls))
    ? Number(options.maxToolCalls)
    : Math.min(defaultToolNames.length || 1, 3);
  const initialToolNames = Array.isArray(options.toolNames) && options.toolNames.length > 0
    ? options.toolNames
    : defaultToolNames.slice(0, computedMaxToolCalls);
  const selectedToolNames = SAFE_ONLY_BY_DEFAULT
    ? initialToolNames.filter((toolName) => {
        const tool = toolCatalog.find((t) => t.mcpToolName === toolName);
        return tool ? (tool.safe === true || tool.method === 'GET') : true;
      })
    : initialToolNames;
  const session = plan.sessionId ? getOrCreateSession(plan.sessionId) : null;
  const chainState = createExecutionChainState();
  const pendingTools = [...selectedToolNames];
  const blockedTools = [];

  while (pendingTools.length > 0 && executionTrace.length < computedMaxToolCalls) {
    let nextIndex = -1;
    let nextInference = null;
    let nextMissing = null;

    for (let i = 0; i < pendingTools.length; i += 1) {
      const candidateToolName = pendingTools[i];
      const tool = toolCatalog.find((t) => t.mcpToolName === candidateToolName);
      if (!tool) {
        nextIndex = i;
        nextInference = null;
        nextMissing = null;
        break;
      }
      const rawArgs = options.argumentsByTool?.[candidateToolName] || options.arguments || {};
      const inference = inferRequiredParamResolutions(tool, rawArgs, session, plan.query, chainState);
      const missing = getMissingRequiredArgs(tool, inference.resolvedArgs);
      if (missing.length === 0) {
        nextIndex = i;
        nextInference = inference;
        nextMissing = missing;
        break;
      }
      blockedTools.push({
        toolName: candidateToolName,
        missingRequiredArgs: missing,
        currentlyKnownEntities: buildEntitySummaryFromStore(chainState.entityMemory)
      });
    }

    if (nextIndex === -1) {
      executionTrace.push({
        ok: false,
        source: 'cross_tool_chain',
        error: 'No remaining tool could be executed with the currently available explicit arguments, session memory, or prior tool results.',
        blockedTools
      });
      break;
    }

    const toolName = pendingTools.splice(nextIndex, 1)[0];
    const tool = toolCatalog.find((t) => t.mcpToolName === toolName);
    if (!tool) {
      executionTrace.push({ toolName, ok: false, error: 'Tool not found in catalog.', source: 'planner' });
      if (options.stopOnError !== false) break;
      continue;
    }

    const authorization = authorizeTool(tool, session);
    if (!authorization.allowed) {
      session && (session.stats.authorizationDenied += 1);
      executionTrace.push({
        toolName,
        ok: false,
        source: 'authorization',
        error: 'Tool execution blocked by role/entitlement policy.',
        authorization
      });
      if (options.stopOnError !== false) break;
      continue;
    }

    try {
      const rawArgs = options.argumentsByTool?.[toolName] || options.arguments || {};
      const inference = nextInference || inferRequiredParamResolutions(tool, rawArgs, session, plan.query, chainState);
      const { resolvedArgs, resolvedFromMemory } = inference;
      const missing = nextMissing || getMissingRequiredArgs(tool, resolvedArgs);
      if (missing.length > 0) {
        executionTrace.push({
          toolName,
          ok: false,
          source: 'cross_tool_chain',
          error: 'Required arguments are still missing after explicit args, session memory, and prior-tool chaining were applied.',
          missingRequiredArgs: missing,
          resolvedFromMemory,
          currentlyKnownEntities: buildEntitySummaryFromStore(chainState.entityMemory)
        });
        if (options.stopOnError !== false) break;
        continue;
      }

      const useCache = session && options.reuseCached !== false && (tool.safe === true || tool.method === 'GET');
      if (useCache) {
        const cached = readFromSessionCache(session, tool, resolvedArgs);
        if (cached) {
          session.stats.cacheHits += 1;
          session.stats.savedCalls += 1;
          const cachedResult = {
            ...cached.result,
            latencyMs: 0,
            source: 'session_cache',
            cachedAt: cached.cachedAt,
            expiresAt: cached.expiresAt,
            resolvedFromMemory
          };
          executionTrace.push(cachedResult);
          recordExecutionChainEntities(chainState, resolvedArgs, { source: 'tool_args', fromTool: tool.mcpToolName, fromQuery: plan.query });
          recordExecutionChainEntities(chainState, cached.result.data || cached.result.systematicOutput, { source: 'tool_result', fromTool: tool.mcpToolName, fromQuery: plan.query });
          chainState.resultSequence.push({
            toolName: tool.mcpToolName,
            source: 'session_cache',
            status: cached.result.status,
            resolvedFromMemory,
            derivedEntities: buildEntitySummaryFromStore(chainState.entityMemory)
          });
          chainState.toolResultIndex.set(tool.mcpToolName, cached.result);
          session.recentResults.push({
            at: new Date().toISOString(),
            toolName: tool.mcpToolName,
            source: 'session_cache',
            preview: cached.preview,
            arguments: resolvedArgs,
            status: cached.result.status,
            ok: cached.result.ok
          });
          trimSessionCollections(session);
          session.updatedAt = new Date().toISOString();
          continue;
        }
      }

      const result = await invokeHttpTool(tool, resolvedArgs, { session });
      recordExecutionChainEntities(chainState, resolvedArgs, { source: 'tool_args', fromTool: tool.mcpToolName, fromQuery: plan.query });
      recordExecutionChainEntities(chainState, result.data || result.systematicOutput, { source: 'tool_result', fromTool: tool.mcpToolName, fromQuery: plan.query });
      const enrichedResult = {
        ...result,
        source: 'live_api',
        resolvedFromMemory,
        chainStateAfterCall: buildEntitySummaryFromStore(chainState.entityMemory)
      };
      executionTrace.push(enrichedResult);
      chainState.resultSequence.push({
        toolName: tool.mcpToolName,
        source: 'live_api',
        status: result.status,
        resolvedFromMemory,
        derivedEntities: buildEntitySummaryFromStore(chainState.entityMemory)
      });
      chainState.toolResultIndex.set(tool.mcpToolName, result);
      if (session) {
        session.stats.liveCalls += 1;
        storeSessionResult(session, tool, resolvedArgs, enrichedResult, 'live_api');
        recordEntitiesForSession(session, resolvedArgs, { source: 'tool_args', fromTool: tool.mcpToolName, fromQuery: plan.query });
        recordEntitiesForSession(session, result.data || result.systematicOutput, { source: 'tool_result', fromTool: tool.mcpToolName, fromQuery: plan.query });
      }
      if (!result.ok && options.stopOnError !== false) break;
    } catch (error) {
      executionTrace.push({
        toolName,
        ok: false,
        source: 'planner',
        error: error instanceof Error ? error.message : String(error)
      });
      if (options.stopOnError !== false) break;
    }
  }

  const synthesis = synthesizeBusinessResult(plan, executionTrace, session);

  const executionResult = {
    planId: plan.planId,
    sessionId: plan.sessionId,
    executedAt: new Date().toISOString(),
    query: plan.query,
    executedTools: selectedToolNames,
    executionTrace,
    chainSummary: {
      enabled: true,
      resolutionOrder: ['explicit_arguments', 'prior_tool_results', 'session_memory'],
      finalEntities: buildEntitySummaryFromStore(chainState.entityMemory),
      sequence: chainState.resultSequence
    },
    semanticPlanningSummary: {
      orderedTools: selectedToolNames,
      dependencyDriven: true
    },
    synthesis,
    summary: {
      totalCalls: executionTrace.length,
      successfulCalls: executionTrace.filter((x) => x.ok).length,
      failedCalls: executionTrace.filter((x) => x.ok === false).length,
      cacheHits: executionTrace.filter((x) => x.source === 'session_cache').length,
      liveApiCalls: executionTrace.filter((x) => x.source === 'live_api').length,
      entityResolutions: executionTrace.reduce((sum, x) => sum + (x.resolvedFromMemory?.length || 0), 0),
      chainedResolutions: executionTrace.reduce((sum, x) => sum + ((x.resolvedFromMemory || []).filter((entry) => entry.source === 'cross_tool_chain').length), 0),
      largeResultsShaped: executionTrace.filter((x) => x.display === 'summary_only').length,
      synthesisAvailable: true,
      synthesizedOutcome: synthesis.outcome
    }
  };
  recordAudit('plan_executed', {
    planId: plan.planId,
    sessionId: plan.sessionId || null,
    query: plan.query,
    executedTools: selectedToolNames,
    summary: executionResult.summary
  });
  persistRuntimeState();
  return executionResult;
}


function unwrapTracePayload(trace) {
  if (!trace) return null;
  if (trace.data !== undefined && trace.data !== null) return trace.data;
  if (trace.systematicOutput !== undefined && trace.systematicOutput !== null) return trace.systematicOutput;
  return null;
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function collectDomainArtifacts(executionTrace) {
  const artifacts = {
    trades: [],
    settlements: [],
    limits: [],
    exposures: [],
    breaches: [],
    rates: [],
    collections: []
  };

  for (const trace of executionTrace || []) {
    const payload = unwrapTracePayload(trace);
    if (!payload) continue;

    const visit = (value) => {
      if (value == null) return;
      if (Array.isArray(value)) {
        if (value.length > 0 && value.every((item) => item && typeof item === 'object')) {
          artifacts.collections.push({ toolName: trace.toolName, totalRows: value.length, previewType: 'object_array' });
        }
        for (const item of value.slice(0, 100)) visit(item);
        return;
      }
      if (typeof value !== 'object') return;

      if (typeof value.tradeId === 'string' && value.amount !== undefined) {
        artifacts.trades.push({ ...value, _toolName: trace.toolName });
      }
      if (typeof value.tradeId === 'string' && (value.settlementDate || /settlement/i.test(trace.toolName || ''))) {
        artifacts.settlements.push({ ...value, _toolName: trace.toolName });
      }
      if (typeof value.counterpartyId === 'string' && (value.intradayLimit !== undefined || value.limit !== undefined || value.utilized !== undefined)) {
        artifacts.limits.push({ ...value, _toolName: trace.toolName });
      }
      if (typeof value.counterpartyId === 'string' && (value.available !== undefined || value.exposure !== undefined)) {
        artifacts.exposures.push({ ...value, _toolName: trace.toolName });
      }
      if (typeof value.breachId === 'string') {
        artifacts.breaches.push({ ...value, _toolName: trace.toolName });
      }
      if (typeof value.currency === 'string' && value.rate !== undefined) {
        artifacts.rates.push({ ...value, _toolName: trace.toolName });
      }

      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') visit(child);
      }
    };

    visit(payload);
  }

  return artifacts;
}

function buildEvidence(executionTrace) {
  return (executionTrace || [])
    .filter((trace) => trace && trace.toolName)
    .map((trace) => ({
      toolName: trace.toolName,
      serviceName: trace.serviceName,
      source: trace.source,
      status: trace.status,
      ok: trace.ok,
      invokedUrl: trace.invokedUrl,
      display: trace.display,
      preview: makeResultPreview(unwrapTracePayload(trace))
    }));
}

function synthesizeBusinessResult(plan, executionTrace, session = null) {
  const successful = (executionTrace || []).filter((trace) => trace && trace.ok);
  const artifacts = collectDomainArtifacts(successful);
  const evidence = buildEvidence(successful);
  const headlines = [];
  const derivedMetrics = {};
  const recommendations = [];
  const structuredAnswer = {
    trades: artifacts.trades,
    settlements: artifacts.settlements,
    limits: artifacts.limits,
    exposures: artifacts.exposures,
    breaches: artifacts.breaches,
    rates: artifacts.rates
  };

  const primaryTrade = artifacts.trades[0] || null;
  const primarySettlement = artifacts.settlements.find((item) => !primaryTrade || item.tradeId === primaryTrade.tradeId) || artifacts.settlements[0] || null;
  const primaryLimit = artifacts.limits.find((item) => !primaryTrade || item.counterpartyId === primaryTrade.counterpartyId) || artifacts.limits[0] || null;
  const primaryExposure = artifacts.exposures.find((item) => !primaryTrade || item.counterpartyId === primaryTrade.counterpartyId) || artifacts.exposures[0] || null;
  const relevantBreaches = primaryTrade
    ? artifacts.breaches.filter((item) => item.counterpartyId === primaryTrade.counterpartyId)
    : artifacts.breaches;

  if (primaryTrade) {
    headlines.push(`Trade ${primaryTrade.tradeId} was retrieved with amount ${primaryTrade.amount ?? 'unknown'} ${primaryTrade.currency || ''}`.trim());
    derivedMetrics.trade = {
      tradeId: primaryTrade.tradeId,
      amount: primaryTrade.amount ?? null,
      currency: primaryTrade.currency || null,
      status: primaryTrade.status || null,
      counterpartyId: primaryTrade.counterpartyId || null,
      portfolio: primaryTrade.portfolio || null
    };
  }

  if (primarySettlement) {
    headlines.push(`Settlement status is ${primarySettlement.status || 'unknown'}${primarySettlement.settlementDate ? ` for ${primarySettlement.settlementDate}` : ''}.`);
    derivedMetrics.settlement = {
      tradeId: primarySettlement.tradeId || null,
      settlementDate: primarySettlement.settlementDate || null,
      status: primarySettlement.status || null,
      cashAccount: primarySettlement.cashAccount || null
    };
  }

  let availableHeadroom = null;
  if (primaryExposure && safeNumber(primaryExposure.available) !== null) {
    availableHeadroom = safeNumber(primaryExposure.available);
    headlines.push(`Available counterparty headroom is ${availableHeadroom} ${primaryExposure.currency || ''}`.trim());
    derivedMetrics.exposure = {
      counterpartyId: primaryExposure.counterpartyId || null,
      exposure: safeNumber(primaryExposure.exposure),
      available: availableHeadroom,
      currency: primaryExposure.currency || null
    };
  } else if (primaryLimit) {
    const limitValue = safeNumber(primaryLimit.intradayLimit ?? primaryLimit.limit);
    const utilizedValue = safeNumber(primaryLimit.utilized);
    if (limitValue !== null && utilizedValue !== null) {
      availableHeadroom = limitValue - utilizedValue;
      headlines.push(`Counterparty ${primaryLimit.counterpartyId} has ${availableHeadroom} ${primaryLimit.currency || ''} of available headroom.`.trim());
      derivedMetrics.limit = {
        counterpartyId: primaryLimit.counterpartyId || null,
        limit: limitValue,
        utilized: utilizedValue,
        availableHeadroom,
        currency: primaryLimit.currency || null
      };
    }
  }

  if (primaryTrade && availableHeadroom !== null && safeNumber(primaryTrade.amount) !== null) {
    const amount = safeNumber(primaryTrade.amount);
    const withinHeadroom = amount <= availableHeadroom;
    const delta = availableHeadroom - amount;
    derivedMetrics.riskAssessment = {
      withinHeadroom,
      tradeAmount: amount,
      availableHeadroom,
      delta
    };
    headlines.push(withinHeadroom
      ? `Trade amount is within available headroom by ${delta}.`
      : `Trade amount exceeds available headroom by ${Math.abs(delta)}.`);
    recommendations.push(withinHeadroom
      ? 'Settlement can proceed from a limit-capacity perspective, subject to other controls.'
      : 'Escalate to risk or reduce exposure before settlement.'
    );
  }

  if (relevantBreaches.length > 0) {
    const openBreaches = relevantBreaches.filter((item) => item.open === true);
    derivedMetrics.breaches = {
      total: relevantBreaches.length,
      open: openBreaches.length,
      severities: unique(relevantBreaches.map((item) => item.severity).filter(Boolean))
    };
    headlines.push(`Found ${relevantBreaches.length} breach record(s)${openBreaches.length > 0 ? `, including ${openBreaches.length} open breach(es)` : ''}.`);
    if (openBreaches.length > 0) {
      recommendations.push('Review open breaches before executing any high-risk operational action.');
    }
  }

  if (!primaryTrade && artifacts.rates.length > 0) {
    const primaryRate = artifacts.rates[0];
    headlines.push(`Retrieved ${artifacts.rates.length} money-market rate row(s).`);
    derivedMetrics.rates = {
      total: artifacts.rates.length,
      primaryCurrency: primaryRate.currency || null,
      primaryRate: primaryRate.rate ?? null
    };
  }

  if (headlines.length === 0) {
    headlines.push(`Completed ${successful.length} successful tool call(s) for query: ${plan.query}`);
  }

  const summaryText = headlines.join(' ');
  return {
    synthesisVersion: '1.0.0',
    query: plan.query,
    outcome: successful.length > 0 ? 'completed' : 'no_successful_results',
    finalAnswer: summaryText,
    businessSummary: headlines,
    structuredAnswer,
    derivedMetrics,
    recommendations: unique(recommendations),
    evidence,
    rememberedEntities: session ? buildEntitySummary(session) : {},
    systemNote: 'The final answer is synthesized from tool results and execution evidence, not from model-only reasoning.'
  };
}

function readMetrics() {
  return fs.existsSync(metricsFile)
    ? JSON.parse(fs.readFileSync(metricsFile, 'utf8'))
    : { message: 'Run npm run demo:generate first.' };
}

function buildToolResource(tool) {
  return {
    uri: `catalog://tool/${tool.serviceName}/${tool.name}`,
    name: tool.mcpToolName,
    mimeType: 'application/json',
    description: `Detailed metadata for ${tool.mcpToolName}`
  };
}

const catalogs = loadCatalogs();
const toolCatalog = flattenTools(catalogs);
const validationReport = buildCatalogValidationReport(catalogs);
restoreRuntimeState();

const server = new Server(
  { name: 'mcp-fabric', version: '0.8.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...toolCatalog.map((tool) => ({
      name: tool.mcpToolName,
      description: `${tool.description} [service=${tool.serviceName}, method=${tool.method}, path=${tool.path}, risk=${tool.riskLevel || 'unknown'}]`,
      inputSchema: {
        type: 'object',
        properties: {
          ...(tool.inputSchema?.properties || {}),
          _sessionId: {
            type: 'string',
            description: 'Optional session identifier for transparent conversation memory, entity reuse, and cached result reuse.'
          }
        },
        required: tool.inputSchema?.required || []
      }
    })),
    {
      name: 'fabric_set_session_context',
      description: 'Set actor context such as userId, roles, entitlements, and output preferences for a session.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          userId: { type: 'string' },
          roles: { type: 'array', items: { type: 'string' } },
          entitlements: { type: 'array', items: { type: 'string' } },
          largeResultMode: { type: 'string', enum: ['summary_only', 'inline_if_small'] }
        },
        required: ['sessionId']
      }
    },
    {
      name: 'fabric_plan_query',
      description: 'Create a transparent action plan showing which resources to inspect, which tools are relevant, and what entities can be reused from memory.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          sessionId: { type: 'string', description: 'Optional conversation session id for memory-aware planning.' },
          maxCandidates: { type: 'number' }
        },
        required: ['query']
      }
    },
    {
      name: 'fabric_execute_plan',
      description: 'Execute a previously created plan with explicit tool arguments and return a full execution trace plus a synthesized business answer.',
      inputSchema: {
        type: 'object',
        properties: {
          planId: { type: 'string' },
          toolNames: { type: 'array', items: { type: 'string' } },
          argumentsByTool: { type: 'object' },
          maxToolCalls: { type: 'number' },
          approved: { type: 'boolean' },
          stopOnError: { type: 'boolean' },
          reuseCached: { type: 'boolean' }
        },
        required: ['planId']
      }
    },
    {
      name: 'fabric_resolve_query',
      description: 'Plan, expose resource/tool transparency, and optionally execute safe tool calls in one step with synthesized final output.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          sessionId: { type: 'string' },
          autoExecute: { type: 'boolean' },
          approved: { type: 'boolean' },
          maxCandidates: { type: 'number' },
          maxToolCalls: { type: 'number' },
          reuseCached: { type: 'boolean' },
          argumentsByTool: { type: 'object' }
        },
        required: ['query']
      }
    },
    {
      name: 'fabric_get_runtime_status',
      description: 'Return runtime status including config, cache sizes, health snapshots, and recent audit counters.',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'fabric_refresh_service_health',
      description: 'Refresh health checks for all registered services and return the latest health snapshots.',
      inputSchema: {
        type: 'object',
        properties: { forceRefresh: { type: 'boolean' } },
        required: []
      }
    },
    {
      name: 'fabric_list_audit_events',
      description: 'Return recent audit events for plans, executions, authorization denials, and session actions.',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number' } },
        required: []
      }
    },
    {
      name: 'fabric_get_session_state',
      description: 'Return transparent session memory including recent queries, cached results, entity memory, and cache metrics.',
      inputSchema: {
        type: 'object',
        properties: { sessionId: { type: 'string' } },
        required: ['sessionId']
      }
    },
    {
      name: 'fabric_clear_session',
      description: 'Clear a session memory state and all cached results.',
      inputSchema: {
        type: 'object',
        properties: { sessionId: { type: 'string' } },
        required: ['sessionId']
      }
    },
    {
      name: 'fabric_request_execution_approval',
      description: 'Create or fetch an approval request for a plan that requires human approval before execution.',
      inputSchema: {
        type: 'object',
        properties: {
          planId: { type: 'string' },
          requestedBy: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['planId']
      }
    },
    {
      name: 'fabric_get_approval_status',
      description: 'Check the status of a pending or completed approval request.',
      inputSchema: {
        type: 'object',
        properties: { approvalId: { type: 'string' } },
        required: ['approvalId']
      }
    },
    {
      name: 'fabric_submit_approval_decision',
      description: 'Approve or reject a pending execution request. Intended for approver personas or automation.',
      inputSchema: {
        type: 'object',
        properties: {
          approvalId: { type: 'string' },
          decision: { type: 'string', enum: ['approved', 'rejected'] },
          approverUserId: { type: 'string' },
          note: { type: 'string' },
          approverRoles: { type: 'array', items: { type: 'string' } },
          approverEntitlements: { type: 'array', items: { type: 'string' } }
        },
        required: ['approvalId', 'decision']
      }
    },
    {
      name: 'fabric_list_pending_approvals',
      description: 'List currently pending approval requests.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'fabric_show_demo_scorecard',
      description: 'Return measurable demo metrics for the current generated catalog.',
      inputSchema: { type: 'object', properties: {}, required: [] }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};

  if (name === 'fabric_set_session_context') {
    const session = getOrCreateSession(args.sessionId);
    if (args.userId !== undefined) session.context.actor.userId = args.userId;
    if (Array.isArray(args.roles)) session.context.actor.roles = unique(args.roles.map(String));
    if (Array.isArray(args.entitlements)) session.context.actor.entitlements = unique(args.entitlements.map(String));
    if (args.largeResultMode) session.context.preferences.largeResultMode = args.largeResultMode;
    session.updatedAt = new Date().toISOString();
    recordAudit('session_context_updated', { sessionId: session.sessionId, actor: session.context.actor, preferences: session.context.preferences });
    persistRuntimeState();
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', session: buildSessionSummary(session) }, null, 2) }] };
  }

  if (name === 'fabric_plan_query') {
    const plan = buildPlan(args.query, catalogs, toolCatalog, args);
    recordAudit('plan_created', { planId: plan.planId, sessionId: plan.sessionId || null, query: plan.query, candidateTools: plan.transparency.candidateTools.map((x) => x.name) });
    return { content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }] };
  }

  if (name === 'fabric_execute_plan') {
    const plan = plans.get(args.planId);
    if (!plan) {
      return { content: [{ type: 'text', text: JSON.stringify({ planId: args.planId, error: 'Unknown planId. Run fabric_plan_query first.' }, null, 2) }] };
    }
    if (plan.executionPolicy.requiresApproval && !(args.approved === true || approvalSatisfiesPlan(args.approvalId, plan.planId))) {
      const approval = createApprovalRequest(plan, { requestedBy: args.requestedBy || 'mcp-user', reason: 'This plan is marked as requiring approval before execution.' });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            planId: args.planId,
            status: 'approval_required',
            message: 'This plan is marked as requiring approval before execution.',
            approval,
            plan
          }, null, 2)
        }]
      };
    }
    const result = await executePlan(plan, toolCatalog, args);
    return { content: [{ type: 'text', text: JSON.stringify({ plan, result }, null, 2) }] };
  }

  if (name === 'fabric_resolve_query') {
    const plan = buildPlan(args.query, catalogs, toolCatalog, args);
    const response = { plan, execution: null };

    if (args.autoExecute === true && !plan.executionPolicy.requiresApproval) {
      response.execution = await executePlan(plan, toolCatalog, args);
    } else if (args.autoExecute === true && plan.executionPolicy.requiresApproval && (args.approved === true || approvalSatisfiesPlan(args.approvalId, plan.planId))) {
      response.execution = await executePlan(plan, toolCatalog, args);
    } else if (args.autoExecute === true && plan.executionPolicy.requiresApproval) {
      response.approval = createApprovalRequest(plan, { requestedBy: args.requestedBy || 'mcp-user', reason: 'Auto-execution was requested for a plan that requires approval.' });
    }

    recordAudit('query_resolved', { planId: plan.planId, sessionId: plan.sessionId || null, query: plan.query, autoExecute: args.autoExecute === true, executed: Boolean(response.execution) });
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  }

  if (name === 'fabric_get_runtime_status') {
    const data = {
      runtime: {
        activePlans: plans.size,
        activeSessions: sessions.size,
        cachedResults: Array.from(sessions.values()).reduce((sum, session) => sum + session.resultCache.size, 0),
        resultVaultEntries: resultVault.size,
        auditEvents: auditEvents.length,
        config: fabricConfig
      },
      validationReport,
      recentHealth: Array.from(healthSnapshots.values())
    };
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }

  if (name === 'fabric_refresh_service_health') {
    const data = await getServiceHealth(args.forceRefresh === true);
    recordAudit('health_refreshed', { count: data.length, forceRefresh: args.forceRefresh === true });
    return { content: [{ type: 'text', text: JSON.stringify({ checkedAt: new Date().toISOString(), services: data }, null, 2) }] };
  }

  if (name === 'fabric_list_audit_events') {
    const limit = Math.max(1, Math.min(Number(args.limit || 25), 100));
    return { content: [{ type: 'text', text: JSON.stringify({ events: auditEvents.slice(-limit).reverse() }, null, 2) }] };
  }

  if (name === 'fabric_get_session_state') {
    const session = sessions.get(sanitizeSessionId(args.sessionId));
    const data = session ? buildSessionSummary(session) : { sessionId: sanitizeSessionId(args.sessionId), message: 'Session not found.' };
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }

  if (name === 'fabric_clear_session') {
    const sessionId = sanitizeSessionId(args.sessionId);
    const session = sessions.get(sessionId);
    if (session) {
      for (const resultId of session.resultResources.keys()) resultVault.delete(resultId);
      sessions.delete(sessionId);
    }
    recordAudit('session_cleared', { sessionId, cleared: Boolean(session) });
    persistRuntimeState();
    return { content: [{ type: 'text', text: JSON.stringify({ sessionId, cleared: Boolean(session) }, null, 2) }] };
  }

  if (name === 'fabric_request_execution_approval') {
    const plan = plans.get(args.planId);
    if (!plan) {
      return { content: [{ type: 'text', text: JSON.stringify({ planId: args.planId, error: 'Unknown planId. Run fabric_plan_query first.' }, null, 2) }] };
    }
    const approval = createApprovalRequest(plan, { requestedBy: args.requestedBy || 'mcp-user', reason: args.reason || 'Execution requires approval.' });
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'approval_requested', approval }, null, 2) }] };
  }

  if (name === 'fabric_get_approval_status') {
    const approval = getApprovalStatus(args.approvalId);
    return { content: [{ type: 'text', text: JSON.stringify({ approvalId: args.approvalId, approval }, null, 2) }] };
  }

  if (name === 'fabric_submit_approval_decision') {
    const actor = {
      userId: args.approverUserId || 'mcp-approver',
      roles: Array.isArray(args.approverRoles) ? args.approverRoles.map(String) : ['approver'],
      entitlements: Array.isArray(args.approverEntitlements) ? args.approverEntitlements.map(String) : ['approve.execution']
    };
    const approval = applyApprovalDecision(args.approvalId, args.decision, actor, args.note || '');
    return { content: [{ type: 'text', text: JSON.stringify({ status: approval.status, approval }, null, 2) }] };
  }

  if (name === 'fabric_list_pending_approvals') {
    pruneApprovals();
    const approvals = Array.from(approvalRequests.values()).filter((approval) => approval.status === 'pending');
    return { content: [{ type: 'text', text: JSON.stringify({ approvals }, null, 2) }] };
  }

  if (name === 'fabric_show_demo_scorecard') {
    return { content: [{ type: 'text', text: JSON.stringify(readMetrics(), null, 2) }] };
  }

  const tool = toolCatalog.find((t) => t.mcpToolName === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  const session = args._sessionId ? getOrCreateSession(args._sessionId) : null;
  const authorization = authorizeTool(tool, session);
  if (!authorization.allowed) {
    session && (session.stats.authorizationDenied += 1);
    recordAudit('authorization_denied', { sessionId: session?.sessionId || null, toolName: tool.mcpToolName, authorization });
    persistRuntimeState();
    return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Tool execution blocked by role/entitlement policy.', authorization }, null, 2) }] };
  }

  const directArgs = { ...args };
  delete directArgs._sessionId;
  const { resolvedArgs, resolvedFromMemory } = inferRequiredParamResolutions(tool, directArgs, session);

  const useCache = session && (tool.safe === true || tool.method === 'GET');
  if (useCache) {
    const cached = readFromSessionCache(session, tool, resolvedArgs);
    if (cached) {
      session.stats.cacheHits += 1;
      session.stats.savedCalls += 1;
      recordAudit('tool_cache_hit', { sessionId: session.sessionId, toolName: tool.mcpToolName, args: resolvedArgs });
      persistRuntimeState();
      return { content: [{ type: 'text', text: JSON.stringify({ ...cached.result, source: 'session_cache', resolvedFromMemory }, null, 2) }] };
    }
  }

  const result = await invokeHttpTool(tool, resolvedArgs, { session });
  const enrichedResult = { ...result, source: 'live_api', resolvedFromMemory };
  if (session) {
    session.stats.liveCalls += 1;
    storeSessionResult(session, tool, resolvedArgs, enrichedResult, 'live_api');
    recordEntitiesForSession(session, resolvedArgs, { source: 'tool_args', fromTool: tool.mcpToolName });
    recordEntitiesForSession(session, result.data || result.systematicOutput, { source: 'tool_result', fromTool: tool.mcpToolName });
  }
  recordAudit('tool_invoked', { sessionId: session?.sessionId || null, toolName: tool.mcpToolName, args: resolvedArgs, status: enrichedResult.status, source: enrichedResult.source });
  persistRuntimeState();
  return { content: [{ type: 'text', text: JSON.stringify(enrichedResult, null, 2) }] };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: 'catalog://planner/system', name: 'Planning System Guide', mimeType: 'application/json', description: 'Guidance for semantic planning, transparency, safety, RBAC, entity memory, and large result handling.' },
    { uri: 'catalog://services', name: 'Service Catalog', mimeType: 'application/json', description: 'Known services and base URLs' },
    { uri: 'catalog://tools', name: 'Tool Catalog', mimeType: 'application/json', description: 'Flattened generated MCP tool catalog' },
    { uri: 'catalog://metrics', name: 'Scan Metrics', mimeType: 'application/json', description: 'Generator metrics and cache information' },
    { uri: 'catalog://validation', name: 'Catalog Validation Report', mimeType: 'application/json', description: 'Warnings and issues found in generated catalogs' },
    { uri: 'catalog://runtime', name: 'Runtime Status', mimeType: 'application/json', description: 'Runtime config, caches, and recent health state' },
    { uri: 'catalog://health', name: 'Service Health', mimeType: 'application/json', description: 'Latest service health snapshots' },
    { uri: 'catalog://audit/recent', name: 'Recent Audit Events', mimeType: 'application/json', description: 'Recent runtime audit trail' },
    { uri: 'catalog://approvals', name: 'Approval Requests', mimeType: 'application/json', description: 'Pending and recent approval requests for guarded executions' },
    { uri: 'memory://sessions', name: 'Session Index', mimeType: 'application/json', description: 'Known conversation sessions' },
    ...catalogs.flatMap((catalog) => ([
      { uri: `catalog://service/${catalog.serviceName}`, name: `${catalog.serviceName} Catalog`, mimeType: 'application/json', description: `Catalog for ${catalog.serviceName}` },
      { uri: `catalog://service/${catalog.serviceName}/openapi-derived`, name: `${catalog.serviceName} Derived OpenAPI Metadata`, mimeType: 'application/json', description: `Generated metadata inferred from source code for ${catalog.serviceName}` }
    ])),
    ...toolCatalog.map(buildToolResource)
  ]
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  if (uri === 'catalog://planner/system') {
    const data = {
      planning: {
        mode: 'plan_then_execute',
        description: 'Plan query resolution, show resources and tools transparently, then execute safe tools.'
      },
      sessionMemory: {
        enabled: true,
        capabilities: ['query_history', 'cached_safe_results', 'entity_memory', 'actor_context'],
        entityExamples: ['tradeId', 'counterpartyId', 'currency', 'portfolioId', 'settlementId']
      },
      crossToolChaining: {
        enabled: true,
        resolutionOrder: ['explicit_arguments', 'prior_tool_results', 'session_memory'],
        behavior: 'If a later tool is missing a required parameter, the runtime first looks for entities produced by earlier tool results in the same plan before falling back to session memory.'
      },
      semanticDependencyPlanning: {
        enabled: true,
        behavior: 'The planner tries to run producer tools before consumer tools when later steps depend on entities like tradeId or counterpartyId that earlier tools can provide.',
        signals: ['required/provided entity overlap', 'path hierarchy', 'detail endpoint preference', 'query semantic overlap']
      },
      resultSynthesis: {
        enabled: true,
        behavior: 'After tool execution, the server synthesizes a business answer, derived metrics, evidence, and recommendations from actual tool results.',
        examples: ['trade amount versus available headroom', 'settlement status summary', 'open breach count', 'rate lookup summaries']
      },
      authorization: {
        transportAuth: 'Use MCP/VS Code auth for server access.',
        appAuth: 'Use session actor roles and entitlements for tool-level authorization policies.'
      },
      largeResultHandling: {
        inlineThresholdRows: LARGE_RESULT_ROW_THRESHOLD,
        behavior: 'Return systematic summary inline and expose the full payload through memory result resources.'
      }
    };
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  }

  if (uri === 'catalog://services') {
    const data = catalogs.map((c) => ({ serviceName: c.serviceName, baseUrl: c.baseUrl, domainKeywords: c.domainKeywords || [] }));
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  }

  if (uri === 'catalog://tools') {
    const data = toolCatalog.map((tool) => ({
      name: tool.mcpToolName,
      serviceName: tool.serviceName,
      method: tool.method,
      path: tool.path,
      riskLevel: tool.riskLevel,
      authorizationPolicy: getToolAccessPolicy(tool),
      semanticProfile: tool.semanticProfile
    }));
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  }

  if (uri === 'catalog://metrics') {
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(readMetrics(), null, 2) }] };
  }


  if (uri === 'catalog://validation') {
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(validationReport, null, 2) }] };
  }

  if (uri === 'catalog://runtime') {
    const data = {
      runtime: {
        activePlans: plans.size,
        activeSessions: sessions.size,
        cachedResults: Array.from(sessions.values()).reduce((sum, session) => sum + session.resultCache.size, 0),
        resultVaultEntries: resultVault.size,
        auditEvents: auditEvents.length,
        config: fabricConfig
      },
      validationReport,
      recentHealth: Array.from(healthSnapshots.values())
    };
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  }

  if (uri === 'catalog://health') {
    const data = await getServiceHealth(false);
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  }

  if (uri === 'catalog://audit/recent') {
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ events: auditEvents.slice(-100).reverse() }, null, 2) }] };
  }

  if (uri === 'catalog://approvals') {
    pruneApprovals();
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ approvals: Array.from(approvalRequests.values()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) }, null, 2) }] };
  }

  if (uri === 'memory://sessions') {    const data = Array.from(sessions.values()).map((session) => ({
      sessionId: session.sessionId,
      updatedAt: session.updatedAt,
      queryCount: session.queryHistory.length,
      cachedResults: session.resultCache.size,
      entities: Object.fromEntries(Array.from(session.entityMemory.entries()).map(([key, values]) => [key, values.map((x) => x.value)]))
    }));
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  }

  let match = uri.match(/^memory:\/\/session\/([^/]+)$/);
  if (match) {
    const session = sessions.get(sanitizeSessionId(match[1]));
    if (!session) throw new Error(`Unknown resource: ${uri}`);
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(buildSessionSummary(session), null, 2) }] };
  }

  match = uri.match(/^memory:\/\/session\/([^/]+)\/entities$/);
  if (match) {
    const session = sessions.get(sanitizeSessionId(match[1]));
    if (!session) throw new Error(`Unknown resource: ${uri}`);
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(buildEntitySummary(session), null, 2) }] };
  }

  match = uri.match(/^memory:\/\/session\/([^/]+)\/result\/([^/]+)$/);
  if (match) {
    const session = sessions.get(sanitizeSessionId(match[1]));
    if (!session) throw new Error(`Unknown resource: ${uri}`);
    const entry = session.resultResources.get(match[2]);
    if (!entry) throw new Error(`Unknown resource: ${uri}`);
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(entry.rawData, null, 2) }] };
  }

  match = uri.match(/^memory:\/\/result\/([^/]+)$/);
  if (match) {
    pruneVault();
    const entry = resultVault.get(match[1]);
    if (!entry) throw new Error(`Unknown resource: ${uri}`);
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(entry.rawData, null, 2) }] };
  }

  match = uri.match(/^catalog:\/\/service\/(.+)\/openapi-derived$/);
  if (match) {
    const catalog = catalogs.find((c) => c.serviceName === match[1]);
    if (!catalog) throw new Error(`Unknown resource: ${uri}`);
    const data = {
      serviceName: catalog.serviceName,
      baseUrl: catalog.baseUrl,
      tools: catalog.tools,
      assumptions: catalog.assumptions,
      scanMeta: catalog.scanMeta
    };
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  }

  match = uri.match(/^catalog:\/\/service\/(.+)$/);
  if (match) {
    const catalog = catalogs.find((c) => c.serviceName === match[1]);
    if (!catalog) throw new Error(`Unknown resource: ${uri}`);
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(catalog, null, 2) }] };
  }

  match = uri.match(/^catalog:\/\/tool\/(.+)\/(.+)$/);
  if (match) {
    const serviceName = match[1];
    const toolName = match[2];
    const tool = toolCatalog.find((x) => x.serviceName === serviceName && x.name === toolName);
    if (!tool) throw new Error(`Unknown resource: ${uri}`);
    const data = {
      ...tool,
      authorizationPolicy: getToolAccessPolicy(tool),
      semanticProfile: tool.semanticProfile
    };
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'fabric_route_query',
      description: 'Help the model inspect catalogs, session memory, and choose the best tool.',
      arguments: [
        { name: 'userQuery', description: 'Natural language business query', required: true },
        { name: 'sessionId', description: 'Optional session for entity-aware memory', required: false }
      ]
    }
  ]
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== 'fabric_route_query') throw new Error(`Unknown prompt: ${request.params.name}`);
  const q = request.params.arguments?.userQuery || '';
  const sessionId = request.params.arguments?.sessionId || '';
  return {
    description: 'Route a business query to the most relevant API-backed tool with transparent planning.',
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Inspect planner, service, tool, and optional memory resources, then choose the best tool for this user query: ${q}${sessionId ? ` (sessionId=${sessionId})` : ''}`
      }
    }]
  };
});

async function startStdioServer() {
  console.error('MCP Fabric server running on stdio with semantic dependency planning, entity-aware memory, RBAC hooks, and large-result shaping.');
  await server.connect(new StdioServerTransport());
}

async function startRemoteHttpServer() {
  const app = createMcpExpressApp({ host: '0.0.0.0' });
  app.use(cors());
  app.use((req, _res, next) => {
    req.fabricAuth = authenticateBearerHeader(req.headers.authorization);
    next();
  });
  app.use((req, res, next) => {
    if (req.path.startsWith('/approvals')) return next();
    if (req.path === '/healthz' || req.path === '/') return next();
    const auth = req.fabricAuth || authenticateBearerHeader(req.headers.authorization);
    if (!auth.authenticated) {
      return res.status(401).json({ error: 'unauthorized', reason: auth.reason, hint: 'Send Authorization: Bearer <token> (see config/remote-auth.json).' });
    }
    return next();
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true
  });
  await server.connect(transport);

  app.get('/', (_req, res) => {
    res.json({
      name: 'mcp-fabric-remote',
      mode: 'streamable-http-json-response',
      mcpEndpoint: `${REMOTE_PUBLIC_BASE_URL.replace(/\/+$/, '')}/mcp`,
      approvalUi: `${REMOTE_PUBLIC_BASE_URL.replace(/\/+$/, '')}/approvals/:approvalId`,
      authMode: REQUIRE_BEARER_AUTH ? 'bearer-token-demo' : 'none'
    });
  });

  app.get('/healthz', async (_req, res) => {
    const health = await getServiceHealth(false);
    res.json({ ok: true, health });
  });

  app.all('/mcp', async (req, res) => {
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Remote MCP request failed:', error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  app.get('/approvals/:approvalId', (req, res) => {
    const approval = getApprovalStatus(req.params.approvalId);
    if (!approval) return res.status(404).send('Unknown approvalId');
    const plan = plans.get(approval.planId);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(renderApprovalHtml(approval, plan));
  });

  app.post('/approvals/:approvalId/decision', expressUrlEncoded, (req, res) => {
    try {
      const auth = authenticateBearerHeader(`Bearer ${req.body.token || ''}`);
      if (!auth.authenticated) return res.status(401).send('Invalid approver token');
      const approval = applyApprovalDecision(req.params.approvalId, req.body.decision, auth.actor, req.body.note || '');
      return res.redirect(`/approvals/${encodeURIComponent(approval.approvalId)}`);
    } catch (error) {
      return res.status(400).send(error instanceof Error ? error.message : String(error));
    }
  });

  app.listen(REMOTE_HTTP_PORT, '0.0.0.0', () => {
    console.error(`MCP Fabric remote HTTP server listening on ${REMOTE_PUBLIC_BASE_URL.replace(/\/+$/, '')}/mcp`);
  });
}

const expressUrlEncoded = (req, res, next) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const params = new URLSearchParams(body);
    req.body = Object.fromEntries(params.entries());
    next();
  });
};

if (process.argv.includes('--http')) {
  await startRemoteHttpServer();
} else {
  await startStdioServer();
}
