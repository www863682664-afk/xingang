const { computeItemAmounts } = require('./index.js');

function assertEqual(actual, expected, message) {
  if (Math.abs(actual - expected) > 1e-6) {
    console.error('Test failed:', message, 'expected', expected, 'got', actual);
    process.exitCode = 1;
  }
}

function run() {
  const item = { quantity: 5, price: 100, handCount: 3, laborUnitPrice: 50, laborCost: 0 };
  const result = computeItemAmounts(item);
  assertEqual(result.subtotal, 650, 'example subtotal');
  assertEqual(result.laborTotal, 150, 'example labor total');

  const zeroItem = { quantity: 0, price: 100, handCount: 0, laborUnitPrice: 50, laborCost: 0 };
  const zeroResult = computeItemAmounts(zeroItem);
  assertEqual(zeroResult.subtotal, 0, 'zero subtotal');
}

run();

