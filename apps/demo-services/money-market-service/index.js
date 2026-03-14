import express from 'express';
import crypto from 'node:crypto';
import { rates, deals, instruments } from './seed-data.js';

const app = express();
app.use(express.json());

function sendDemoJson(res, payload) {
  res.setHeader('x-demo-request-id', crypto.randomUUID());
  res.setHeader('x-demo-served-at', new Date().toISOString());
  res.setHeader('x-demo-service', 'money-market-service');
  res.setHeader('x-demo-source', 'live_api');
  return res.json(payload);
}

app.get('/health', (_req, res) => sendDemoJson(res, { ok: true, service: 'money-market-service' }));
app.get('/money-market/rates', (req, res) => {
  const currency = req.query.currency;
  const filtered = currency ? rates.filter((r) => r.currency === currency) : rates;
  return sendDemoJson(res, filtered);
});
app.get('/money-market/instruments/:instrumentId', (req, res) => {
  const instrument = instruments.find((i) => i.instrumentId === req.params.instrumentId);
  if (!instrument) return res.status(404).json({ message: 'Instrument not found' });
  return sendDemoJson(res, instrument);
});
app.get('/money-market/deals', (req, res) => {
  const currency = req.query.currency;
  const filtered = currency ? deals.filter((d) => d.currency === currency) : deals;
  return sendDemoJson(res, filtered);
});
app.post('/money-market/deals/search', (req, res) => {
  const { counterpartyId } = req.body || {};
  const filtered = counterpartyId ? deals.filter((d) => d.counterpartyId === counterpartyId) : deals;
  return sendDemoJson(res, { count: filtered.length, deals: filtered });
});
app.get('/counterparties/:counterpartyId/limits', (req, res) => {
  const limits = {
    'CP-001': { intradayLimit: 10000000, utilized: 5500000, currency: 'USD' },
    'CP-002': { intradayLimit: 8000000, utilized: 2200000, currency: 'USD' }
  };
  const limit = limits[req.params.counterpartyId];
  if (!limit) return res.status(404).json({ message: 'Counterparty not found' });
  return sendDemoJson(res, { counterpartyId: req.params.counterpartyId, ...limit });
});
app.listen(4020, () => console.log('money-market-service listening on http://localhost:4020'));
