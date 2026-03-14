export const trades = [
  {
    "tradeId": "T-1001",
    "portfolio": "ALPHA",
    "instrument": "UST-5Y",
    "counterpartyId": "CP-001",
    "amount": 2500000,
    "currency": "USD",
    "status": "SETTLED"
  },
  {
    "tradeId": "T-1002",
    "portfolio": "BETA",
    "instrument": "CP-3M",
    "counterpartyId": "CP-002",
    "amount": 1750000,
    "currency": "USD",
    "status": "PENDING_SETTLEMENT"
  }
];

export const settlements = [
  {
    "tradeId": "T-1001",
    "settlementDate": "2026-03-12",
    "cashAccount": "USD-CASH-001",
    "status": "COMPLETE"
  },
  {
    "tradeId": "T-1002",
    "settlementDate": "2026-03-14",
    "cashAccount": "USD-CASH-002",
    "status": "SCHEDULED"
  }
];
