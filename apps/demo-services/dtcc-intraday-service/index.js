import express from 'express';
import crypto from 'node:crypto';
import { obligations, filterObligations, summarize, aggregateBy } from './seed-data.js';

const app = express();
app.use(express.json());

function sendDemoJson(res, payload) {
  res.setHeader('x-demo-request-id', crypto.randomUUID());
  res.setHeader('x-demo-served-at', new Date().toISOString());
  res.setHeader('x-demo-service', 'dtcc-intraday-service');
  res.setHeader('x-demo-source', 'live_api');
  return res.json(payload);
}

app.get('/health', (_req, res) => sendDemoJson(res, { ok: true, service: 'dtcc-intraday-service' }));

app.get('/dtcc/intraday/summary', (req, res) => {
  const rows = filterObligations(req.query);
  return sendDemoJson(res, {
    currency: req.query.currency || 'ALL',
    asOf: new Date().toISOString(),
    ...summarize(rows)
  });
});

app.get('/dtcc/intraday/obligations', (req, res) => {
  const rows = filterObligations(req.query);
  const limit = Math.min(Number(req.query.limit || 100), 1000);
  return sendDemoJson(res, { count: rows.length, obligations: rows.slice(0, limit) });
});

app.post('/dtcc/intraday/obligations/search', (req, res) => {
  const rows = filterObligations(req.body || {});
  const limit = Math.min(Number(req.body?.limit || 100), 2000);
  return sendDemoJson(res, { count: rows.length, obligations: rows.slice(0, limit) });
});

app.get('/dtcc/intraday/outstanding', (req, res) => {
  const rows = filterObligations(req.query);
  const byIssuer = aggregateBy(rows, 'issuerId').slice(0, 5).map((entry, index) => ({ rank: index + 1, issuerId: entry.key, amount: entry.value }));
  return sendDemoJson(res, {
    currency: req.query.currency || 'ALL',
    totalAmount: rows.reduce((sum, row) => sum + row.amount, 0),
    topIssuers: byIssuer,
    largestIssuerId: byIssuer[0]?.issuerId || null
  });
});

app.get('/dtcc/intraday/positions/bulk', (req, res) => {
  const count = Math.min(Number(req.query.count || 12000), obligations.length);
  const rows = obligations.slice(0, count);
  return sendDemoJson(res, {
    count: rows.length,
    generatedAt: new Date().toISOString(),
    positions: rows
  });
});

app.get('/dtcc/intraday/accounts/:accountId/net-flow', (req, res) => {
  const rows = filterObligations({ ...req.query, accountId: req.params.accountId });
  if (!rows.length) return res.status(404).json({ message: 'Account flow not found' });
  return sendDemoJson(res, {
    accountId: req.params.accountId,
    totalAmount: rows.reduce((sum, row) => sum + row.amount, 0),
    currencies: Array.from(new Set(rows.map((row) => row.currency))),
    investorId: rows[0].investorId,
    issuerId: rows[0].issuerId,
    pendingCount: rows.filter((row) => row.status === 'PENDING').length
  });
});

app.listen(4050, () => console.log('dtcc-intraday-service listening on http://localhost:4050'));
