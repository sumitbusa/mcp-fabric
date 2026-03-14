import express from 'express';
import crypto from 'node:crypto';
import { issuers, investors, accounts, counterpartyLinks } from './seed-data.js';

const app = express();
app.use(express.json());

function sendDemoJson(res, payload) {
  res.setHeader('x-demo-request-id', crypto.randomUUID());
  res.setHeader('x-demo-served-at', new Date().toISOString());
  res.setHeader('x-demo-service', 'reference-data-service');
  res.setHeader('x-demo-source', 'live_api');
  return res.json(payload);
}

app.get('/health', (_req, res) => sendDemoJson(res, { ok: true, service: 'reference-data-service' }));

app.get('/refdata/investors/:investorId', (req, res) => {
  const row = investors.find((item) => item.investorId === req.params.investorId);
  if (!row) return res.status(404).json({ message: 'Investor not found' });
  return sendDemoJson(res, row);
});

app.get('/refdata/issuers/:issuerId', (req, res) => {
  const row = issuers.find((item) => item.issuerId === req.params.issuerId);
  if (!row) return res.status(404).json({ message: 'Issuer not found' });
  return sendDemoJson(res, row);
});

app.get('/refdata/accounts/:accountId', (req, res) => {
  const row = accounts.find((item) => item.accountId === req.params.accountId);
  if (!row) return res.status(404).json({ message: 'Account not found' });
  return sendDemoJson(res, row);
});

app.get('/refdata/investors', (req, res) => {
  const { country, investorType } = req.query;
  let result = investors;
  if (country) result = result.filter((item) => item.country === country);
  if (investorType) result = result.filter((item) => item.investorType === investorType);
  return sendDemoJson(res, result);
});

app.get('/refdata/issuers', (req, res) => {
  const { country, sector } = req.query;
  let result = issuers;
  if (country) result = result.filter((item) => item.country === country);
  if (sector) result = result.filter((item) => item.sector === sector);
  return sendDemoJson(res, result);
});

app.get('/refdata/counterparties/:counterpartyId/link', (req, res) => {
  const row = counterpartyLinks.find((item) => item.counterpartyId === req.params.counterpartyId);
  if (!row) return res.status(404).json({ message: 'Counterparty link not found' });
  return sendDemoJson(res, row);
});

app.listen(4060, () => console.log('reference-data-service listening on http://localhost:4060'));
