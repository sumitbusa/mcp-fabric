import express from 'express';
import crypto from 'node:crypto';
import { counterparties, limits, breaches } from './seed-data.js';

const app = express();
app.use(express.json());

function sendDemoJson(res, payload) {
  res.setHeader('x-demo-request-id', crypto.randomUUID());
  res.setHeader('x-demo-served-at', new Date().toISOString());
  res.setHeader('x-demo-service', 'settlement-risk-spring');
  res.setHeader('x-demo-source', 'live_api');
  return res.json(payload);
}

app.get('/risk/counterparties', (_req, res) => {
  return sendDemoJson(res, counterparties);
});

app.get('/risk/counterparties/:counterpartyId', (req, res) => {
  const row = counterparties.find((item) => item.counterpartyId === req.params.counterpartyId);
  if (!row) return res.status(404).json({ message: 'Counterparty not found' });
  return sendDemoJson(res, row);
});

app.get('/risk/limits/:counterpartyId', (req, res) => {
  const row = limits.find((item) => item.counterpartyId === req.params.counterpartyId);
  if (!row) return res.status(404).json({ message: 'Limit not found' });
  return sendDemoJson(res, row);
});

app.get('/risk/exposures/:counterpartyId', (req, res) => {
  const limit = limits.find((item) => item.counterpartyId === req.params.counterpartyId);
  const party = counterparties.find((item) => item.counterpartyId === req.params.counterpartyId);
  if (!limit || !party) return res.status(404).json({ message: 'Exposure not found' });
  return sendDemoJson(res, {
    counterpartyId: req.params.counterpartyId,
    counterpartyName: party.name,
    exposure: limit.utilized,
    available: limit.limit - limit.utilized,
    currency: limit.currency
  });
});

app.post('/risk/breaches/search', (req, res) => {
  const onlyOpen = Boolean(req.body?.onlyOpen);
  const counterpartyId = req.body?.counterpartyId;
  let result = breaches;
  if (onlyOpen) result = result.filter((item) => item.open);
  if (counterpartyId) result = result.filter((item) => item.counterpartyId === counterpartyId);
  return sendDemoJson(res, result);
});

app.listen(4030, () => {
  console.log('settlement-risk-spring mock service listening on http://localhost:4030');
});
