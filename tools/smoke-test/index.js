const tests = [
  {
    name: 'trade lookup',
    url: 'http://localhost:4010/trades/T-1001'
  },
  {
    name: 'money market USD rates',
    url: 'http://localhost:4020/money-market/rates?currency=USD'
  },
  {
    name: 'counterparty limit',
    url: 'http://localhost:4030/risk/limits/CP-001'
  },
  {
    name: 'broker outstanding',
    url: 'http://localhost:4040/broker/mm/outstanding?currency=USD'
  },
  {
    name: 'dtcc intraday summary',
    url: 'http://localhost:4050/dtcc/intraday/summary?currency=USD'
  },
  {
    name: 'reference investor',
    url: 'http://localhost:4060/refdata/investors/INV-001'
  }
];

let failed = false;
for (const test of tests) {
  try {
    const res = await fetch(test.url);
    const body = await res.text();
    console.log(`PASS ${test.name}: ${res.status} ${test.url}`);
    console.log(body.slice(0, 220));
  } catch (err) {
    failed = true;
    console.error(`FAIL ${test.name}: ${test.url}`);
    console.error(err instanceof Error ? err.message : String(err));
  }
}

if (failed) process.exit(1);
