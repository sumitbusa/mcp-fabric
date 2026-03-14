export const issuers = [
  { issuerId: 'ISS-001', legalName: 'US Treasury', shortName: 'UST', country: 'US', sector: 'Sovereign', rating: 'AA+', lei: 'LEIUST0001', supportTier: 'Tier-1' },
  { issuerId: 'ISS-002', legalName: 'JPM Treasury Funding', shortName: 'JPMTF', country: 'US', sector: 'Bank', rating: 'A+', lei: 'LEIJPM0002', supportTier: 'Tier-1' },
  { issuerId: 'ISS-003', legalName: 'Alpha Bank Funding', shortName: 'ALPHA', country: 'US', sector: 'Bank', rating: 'A', lei: 'LEIALP0003', supportTier: 'Tier-2' },
  { issuerId: 'ISS-004', legalName: 'Beta Industrial CP', shortName: 'BETA', country: 'UK', sector: 'Corporate', rating: 'A-', lei: 'LEIBET0004', supportTier: 'Tier-2' },
  { issuerId: 'ISS-005', legalName: 'Gamma Infrastructure Notes', shortName: 'GAMMA', country: 'IN', sector: 'Corporate', rating: 'BBB+', lei: 'LEIGAM0005', supportTier: 'Tier-3' },
  { issuerId: 'ISS-006', legalName: 'Delta Sovereign Agency', shortName: 'DELTA', country: 'DE', sector: 'Agency', rating: 'AA', lei: 'LEIDEL0006', supportTier: 'Tier-1' }
];

export const investors = [
  { investorId: 'INV-001', legalName: 'Blackstone Liquidity Fund', shortName: 'BLK-LIQ', country: 'US', investorType: 'Fund', riskTier: 'Tier-1', lei: 'LEIINV0001' },
  { investorId: 'INV-002', legalName: 'JPMC Treasury Investments', shortName: 'JPM-TI', country: 'US', investorType: 'BrokerTreasury', riskTier: 'Tier-1', lei: 'LEIINV0002' },
  { investorId: 'INV-003', legalName: 'Alpha Pension Reserve', shortName: 'ALPHA-PEN', country: 'UK', investorType: 'Pension', riskTier: 'Tier-2', lei: 'LEIINV0003' },
  { investorId: 'INV-004', legalName: 'Gamma Insurance Float', shortName: 'GAMMA-INS', country: 'US', investorType: 'Insurance', riskTier: 'Tier-2', lei: 'LEIINV0004' },
  { investorId: 'INV-005', legalName: 'SBI Money Market Desk', shortName: 'SBI-MM', country: 'IN', investorType: 'BankTreasury', riskTier: 'Tier-2', lei: 'LEIINV0005' },
  { investorId: 'INV-006', legalName: 'Nordic Cash Pool', shortName: 'NORDIC', country: 'SE', investorType: 'Fund', riskTier: 'Tier-3', lei: 'LEIINV0006' }
];

export const accounts = [
  { accountId: 'ACC-001', accountName: 'JPMC House USD 01', investorId: 'INV-002', issuerId: 'ISS-002', currency: 'USD', book: 'MM-USD', topAccount: true },
  { accountId: 'ACC-002', accountName: 'JPMC House USD 02', investorId: 'INV-002', issuerId: 'ISS-001', currency: 'USD', book: 'MM-USD', topAccount: true },
  { accountId: 'ACC-003', accountName: 'Blackstone USD Prime', investorId: 'INV-001', issuerId: 'ISS-003', currency: 'USD', book: 'PRIME', topAccount: true },
  { accountId: 'ACC-004', accountName: 'Alpha Pension Sterling', investorId: 'INV-003', issuerId: 'ISS-004', currency: 'GBP', book: 'STERLING', topAccount: false },
  { accountId: 'ACC-005', accountName: 'Gamma Float USD', investorId: 'INV-004', issuerId: 'ISS-002', currency: 'USD', book: 'FLOAT', topAccount: false },
  { accountId: 'ACC-006', accountName: 'SBI INR Liquidity', investorId: 'INV-005', issuerId: 'ISS-005', currency: 'INR', book: 'INR-LIQ', topAccount: true }
];

export const counterpartyLinks = [
  { counterpartyId: 'CP-001', investorId: 'INV-001', issuerId: 'ISS-003', accountId: 'ACC-003' },
  { counterpartyId: 'CP-002', investorId: 'INV-003', issuerId: 'ISS-004', accountId: 'ACC-004' },
  { counterpartyId: 'CP-003', investorId: 'INV-005', issuerId: 'ISS-005', accountId: 'ACC-006' }
];
