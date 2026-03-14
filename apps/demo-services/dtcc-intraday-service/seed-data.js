const investorCycle = ['INV-001', 'INV-002', 'INV-003', 'INV-004', 'INV-005', 'INV-006'];
const issuerCycle = ['ISS-001', 'ISS-002', 'ISS-003', 'ISS-004', 'ISS-005', 'ISS-006'];
const accountCycle = ['ACC-001', 'ACC-002', 'ACC-003', 'ACC-004', 'ACC-005', 'ACC-006'];
const currencies = ['USD', 'USD', 'USD', 'GBP', 'EUR', 'INR'];
const statuses = ['PENDING', 'PENDING', 'MATCHED', 'SETTLING', 'RELEASED', 'PENDING'];

function isoWithOffset(minutes) {
  return new Date(Date.UTC(2026, 2, 14, 9, 0, 0) + (minutes * 60000)).toISOString();
}

export const obligations = Array.from({ length: 18000 }, (_, idx) => {
  const i = idx + 1;
  const currency = currencies[idx % currencies.length];
  const investorId = investorCycle[idx % investorCycle.length];
  const issuerId = issuerCycle[(idx + 2) % issuerCycle.length];
  const accountId = accountCycle[(idx + 1) % accountCycle.length];
  const amount = 100000 + ((idx % 70) * 35000);
  const status = statuses[idx % statuses.length];
  const maturityDays = 2 + (idx % 90);
  return {
    obligationId: `DTCC-${String(i).padStart(6, '0')}`,
    dtccCycle: idx % 2 === 0 ? 'INTRADAY-1' : 'INTRADAY-2',
    broker: 'JPMC',
    issuerId,
    investorId,
    accountId,
    currency,
    amount,
    status,
    maturityDate: new Date(Date.UTC(2026, 2, 14 + maturityDays)).toISOString().slice(0, 10),
    settlementDate: '2026-03-14',
    updatedAt: isoWithOffset(idx % 300),
    topAccount: ['ACC-001', 'ACC-002', 'ACC-003'].includes(accountId)
  };
});

export function filterObligations(filters = {}) {
  return obligations.filter((row) => {
    if (filters.currency && row.currency !== filters.currency) return false;
    if (filters.issuerId && row.issuerId !== filters.issuerId) return false;
    if (filters.investorId && row.investorId !== filters.investorId) return false;
    if (filters.accountId && row.accountId !== filters.accountId) return false;
    if (filters.status && row.status !== filters.status) return false;
    return true;
  });
}

export function summarize(rows) {
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const byIssuer = aggregateBy(rows, 'issuerId');
  const byInvestor = aggregateBy(rows, 'investorId');
  const byAccount = aggregateBy(rows, 'accountId');
  return {
    broker: 'JPMC',
    rowCount: rows.length,
    totalAmount,
    pendingCount: rows.filter((row) => row.status === 'PENDING').length,
    largestIssuerId: byIssuer[0]?.key || null,
    largestIssuerAmount: byIssuer[0]?.value || null,
    largestInvestorId: byInvestor[0]?.key || null,
    largestInvestorAmount: byInvestor[0]?.value || null,
    peakAccountId: byAccount[0]?.key || null,
    peakAccountAmount: byAccount[0]?.value || null
  };
}

export function aggregateBy(rows, field) {
  const map = new Map();
  for (const row of rows) map.set(row[field], (map.get(row[field]) || 0) + row.amount);
  return Array.from(map.entries()).map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}
