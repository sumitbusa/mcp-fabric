import express from 'express';
import crypto from 'node:crypto';
import { trades, settlements } from './seed-data.js';

const app = express();
app.use(express.json());

function sendDemoJson(res, payload) {
  res.setHeader('x-demo-request-id', crypto.randomUUID());
  res.setHeader('x-demo-served-at', new Date().toISOString());
  res.setHeader('x-demo-service', 'trade-service');
  res.setHeader('x-demo-source', 'live_api');
  return res.json(payload);
}

function buildBulkTrades(count = 10000) {
  const rows = [];
  for (let i = 1; i <= count; i += 1) {
    rows.push({
      tradeId: `TB-${String(i).padStart(5, '0')}`,
      instrument: i % 2 === 0 ? 'UST_NOTE' : 'IRS_5Y',
      counterpartyId: `CP-00${(i % 3) + 1}`,
      amount: 100000 + (i * 250),
      currency: i % 2 === 0 ? 'USD' : 'GBP',
      status: i % 7 === 0 ? 'PENDING' : 'BOOKED',
      portfolio: i % 2 === 0 ? 'MM-ALPHA' : 'RATES-BETA'
    });
  }
  return rows;
}

app.get('/health', (_req, res) => sendDemoJson(res, { ok: true, service: 'trade-service' }));
app.get('/trades', (_req, res) => sendDemoJson(res, trades));
app.get('/trades/:tradeId', (req, res) => {
  const trade = trades.find((t) => t.tradeId === req.params.tradeId);
  if (!trade) return res.status(404).json({ message: 'Trade not found' });
  return sendDemoJson(res, trade);
});
app.get('/trades/:tradeId/settlement', (req, res) => {
  const settlement = settlements.find((s) => s.tradeId === req.params.tradeId);
  if (!settlement) return res.status(404).json({ message: 'Settlement not found' });
  return sendDemoJson(res, settlement);
});
app.get('/trades/bulk', (req, res) => {
  const count = Math.min(Number(req.query.count || 10000), 10000);
  const rows = buildBulkTrades(count);
  return sendDemoJson(res, {
    count: rows.length,
    generatedAt: new Date().toISOString(),
    trades: rows
  });
});
app.get('/positions', (req, res) => {
  const portfolio = req.query.portfolio;
  const filtered = portfolio ? trades.filter((t) => t.portfolio === portfolio) : trades;
  return sendDemoJson(res, { portfolio: portfolio || 'ALL', positions: filtered.map((t) => ({ instrument: t.instrument, amount: t.amount, currency: t.currency })) });
});
app.post('/trades/search', (req, res) => {
  const { counterpartyId, status } = req.body || {};
  let result = trades;
  if (counterpartyId) result = result.filter((x) => x.counterpartyId === counterpartyId);
  if (status) result = result.filter((x) => x.status === status);
  return sendDemoJson(res, { count: result.length, trades: result });
});
app.listen(4010, () => console.log('trade-service listening on http://localhost:4010'));
