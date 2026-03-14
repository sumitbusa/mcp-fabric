import express from 'express';
import crypto from 'node:crypto';
import { deals, filterDeals, computeSummary, aggregateBy } from './seed-data.js';

const app = express();
app.use(express.json());

function sendDemoJson(res, payload) {
  res.setHeader('x-demo-request-id', crypto.randomUUID());
  res.setHeader('x-demo-served-at', new Date().toISOString());
  res.setHeader('x-demo-service', 'broker-money-market-service');
  res.setHeader('x-demo-source', 'live_api');
  return res.json(payload);
}

app.get('/health', (_req, res) => sendDemoJson(res, { ok: true, service: 'broker-money-market-service' }));

app.get('/broker/mm/outstanding', (req, res) => {
  const rows = filterDeals(req.query);
  return sendDemoJson(res, {
    currency: req.query.currency || 'ALL',
    ...computeSummary(rows)
  });
});

app.get('/broker/mm/top-accounts', (req, res) => {
  const rows = filterDeals(req.query);
  const limit = Math.min(Number(req.query.limit || 5), 20);
  const top = aggregateBy(rows, 'accountId').slice(0, limit).map((entry, index) => ({
    rank: index + 1,
    accountId: entry.key,
    outstanding: entry.value,
    currency: req.query.currency || rows.find((x) => x.accountId === entry.key)?.currency || 'MULTI',
    investorId: rows.find((x) => x.accountId === entry.key)?.investorId || null,
    issuerId: rows.find((x) => x.accountId === entry.key)?.issuerId || null
  }));
  return sendDemoJson(res, { count: top.length, accounts: top });
});

app.get('/broker/mm/maturity-ladder', (req, res) => {
  const rows = filterDeals(req.query);
  const buckets = ['0-30D', '31-90D', '91D+'].map((bucket) => ({
    maturityBucket: bucket,
    outstanding: rows.filter((row) => row.maturityBucket === bucket).reduce((sum, row) => sum + row.outstanding, 0),
    dealCount: rows.filter((row) => row.maturityBucket === bucket).length
  }));
  return sendDemoJson(res, { currency: req.query.currency || 'ALL', buckets });
});

app.get('/broker/mm/issuers/:issuerId/exposure', (req, res) => {
  const rows = filterDeals({ ...req.query, issuerId: req.params.issuerId });
  if (!rows.length) return res.status(404).json({ message: 'Issuer exposure not found' });
  return sendDemoJson(res, {
    issuerId: req.params.issuerId,
    ...computeSummary(rows)
  });
});

app.get('/broker/mm/investors/:investorId/activity', (req, res) => {
  const rows = filterDeals({ ...req.query, investorId: req.params.investorId });
  if (!rows.length) return res.status(404).json({ message: 'Investor activity not found' });
  return sendDemoJson(res, {
    investorId: req.params.investorId,
    ...computeSummary(rows)
  });
});

app.post('/broker/mm/deals/search', (req, res) => {
  const rows = filterDeals(req.body || {});
  const limit = Math.min(Number(req.body?.limit || 100), 1000);
  return sendDemoJson(res, { count: rows.length, deals: rows.slice(0, limit) });
});

app.get('/broker/mm/intraday-view', (req, res) => {
  const rows = filterDeals(req.query);
  const openRows = rows.filter((row) => row.status === 'OPEN');
  const summary = computeSummary(openRows);
  return sendDemoJson(res, {
    broker: 'JPMC',
    currency: req.query.currency || 'ALL',
    intradayTimestamp: new Date().toISOString(),
    openDealCount: openRows.length,
    openOutstanding: openRows.reduce((sum, row) => sum + row.outstanding, 0),
    peakAccountId: summary.topAccountId,
    peakInvestorId: summary.topInvestorId,
    peakIssuerId: summary.topIssuerId
  });
});

app.listen(4040, () => console.log('broker-money-market-service listening on http://localhost:4040'));
