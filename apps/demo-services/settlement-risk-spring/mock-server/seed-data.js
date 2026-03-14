export const counterparties = [
  {
    "counterpartyId": "CP-001",
    "name": "Alpha Bank",
    "country": "US",
    "rating": "A"
  },
  {
    "counterpartyId": "CP-002",
    "name": "Beta Treasury",
    "country": "UK",
    "rating": "AA"
  },
  {
    "counterpartyId": "CP-003",
    "name": "Gamma Liquidity",
    "country": "IN",
    "rating": "A-"
  }
];

export const limits = [
  {
    "counterpartyId": "CP-001",
    "currency": "USD",
    "limit": 25000000,
    "utilized": 18250000
  },
  {
    "counterpartyId": "CP-002",
    "currency": "GBP",
    "limit": 18000000,
    "utilized": 12100000
  },
  {
    "counterpartyId": "CP-003",
    "currency": "INR",
    "limit": 900000000,
    "utilized": 455000000
  }
];

export const breaches = [
  {
    "breachId": "BR-9001",
    "counterpartyId": "CP-001",
    "severity": "HIGH",
    "open": true
  },
  {
    "breachId": "BR-9002",
    "counterpartyId": "CP-003",
    "severity": "MEDIUM",
    "open": false
  }
];
