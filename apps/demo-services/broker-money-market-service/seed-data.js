const investorCycle = ['INV-001', 'INV-002', 'INV-003', 'INV-004', 'INV-005', 'INV-006'];
const issuerCycle = ['ISS-001', 'ISS-002', 'ISS-003', 'ISS-004', 'ISS-005', 'ISS-006'];
const accountCycle = ['ACC-001', 'ACC-002', 'ACC-003', 'ACC-004', 'ACC-005', 'ACC-006'];
const currencies = ['USD', 'USD', 'USD', 'GBP', 'EUR', 'INR'];
const instruments = ['CP', 'CD', 'UST', 'Repo', 'CP', 'CD'];
const statuses = ['OPEN', 'SETTLED', 'OPEN', 'OPEN', 'MATURED', 'OPEN'];

function dayOffset(base, days) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const deals = Array.from({ length: 2400 }, (_, idx) => {
  const i = idx + 1;
  const currency = currencies[idx % currencies.length];
  const investorId = investorCycle[idx % investorCycle.length];
  const issuerId = issuerCycle[(idx + 1) % issuerCycle.length];
  const accountId = accountCycle[idx % accountCycle.length];
  const maturityDays = 7 + ((idx % 18) * 7);
  const notional = 250000 + ((idx % 40) * 125000);
  const outstanding = Math.round(notional * (0.55 + ((idx % 10) * 0.03)));
  return {
    dealId: `BMM-${String(i).padStart(5, '0')}`,
    broker: 'JPMC',
    investorId,
    issuerId,
    accountId,
    currency,
    instrumentType: instruments[idx % instruments.length],
    tenor: `${Math.max(1, Math.floor(maturityDays / 30))}M`,
    tradeDate: dayOffset('2026-03-01', -(idx % 4)),
    maturityDate: dayOffset('2026-03-14', maturityDays),
    maturityBucket: maturityDays <= 30 ? '0-30D' : maturityDays <= 90 ? '31-90D' : '91D+',
    notional,
    outstanding,
    status: statuses[idx % statuses.length],
    issuerName: issuerId,
    investorName: investorId,
    topAccount: ['ACC-001', 'ACC-002', 'ACC-003'].includes(accountId)
  };
});

export function filterDeals(filters = {}) {
  return deals.filter((deal) => {
    if (filters.currency && deal.currency !== filters.currency) return false;
    if (filters.issuerId && deal.issuerId !== filters.issuerId) return false;
    if (filters.investorId && deal.investorId !== filters.investorId) return false;
    if (filters.accountId && deal.accountId !== filters.accountId) return false;
    if (filters.status && deal.status !== filters.status) return false;
    return true;
  });
}

export function computeSummary(rows) {
  const totalOutstanding = rows.reduce((sum, row) => sum + row.outstanding, 0);
  const totalNotional = rows.reduce((sum, row) => sum + row.notional, 0);
  const weightedAvgMaturityDays = rows.length
    ? Math.round(rows.reduce((sum, row) => {
        const maturityDays = Math.max(1, Math.round((Date.parse(row.maturityDate) - Date.parse('2026-03-14')) / 86400000));
        return sum + (maturityDays * row.outstanding);
      }, 0) / totalOutstanding)
    : 0;

  const topAccount = aggregateBy(rows, 'accountId')[0] || null;
  const topInvestor = aggregateBy(rows, 'investorId')[0] || null;
  const topIssuer = aggregateBy(rows, 'issuerId')[0] || null;

  return {
    broker: 'JPMC',
    rowCount: rows.length,
    totalOutstanding,
    totalNotional,
    weightedAvgMaturityDays,
    issuerCount: new Set(rows.map((row) => row.issuerId)).size,
    investorCount: new Set(rows.map((row) => row.investorId)).size,
    topAccountId: topAccount?.key || null,
    topAccountOutstanding: topAccount?.value || null,
    topInvestorId: topInvestor?.key || null,
    topInvestorOutstanding: topInvestor?.value || null,
    topIssuerId: topIssuer?.key || null,
    topIssuerOutstanding: topIssuer?.value || null
  };
}

export function aggregateBy(rows, field) {
  const map = new Map();
  for (const row of rows) map.set(row[field], (map.get(row[field]) || 0) + row.outstanding);
  return Array.from(map.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);
}
