import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { checkoutSignatureValid, webhookSignatureValid } from './payments.js';
import { calculateBookingPrice } from './pricing.js';
import { HttpError } from './http.js';

test('checkout signature matches server order id and payment id', () => {
  const secret = 'local-test-secret'; const order = 'order_test_123'; const payment = 'pay_test_456';
  const signature = createHmac('sha256', secret).update(`${order}|${payment}`).digest('hex');
  assert.equal(checkoutSignatureValid(order, payment, signature, secret), true);
  assert.equal(checkoutSignatureValid('order_attacker_supplied', payment, signature, secret), false);
  assert.equal(checkoutSignatureValid(order, payment, '0'.repeat(64), secret), false);
});

test('webhook signature is tied to the exact raw request bytes', () => {
  const secret = 'webhook-test-secret'; const body = Buffer.from('{"event":"payment.captured"}');
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(webhookSignatureValid(body, signature, secret), true);
  assert.equal(webhookSignatureValid(Buffer.from('{ "event":"payment.captured"}'), signature, secret), false);
  assert.equal(webhookSignatureValid(body, 'x'.repeat(64), secret), false);
});

test('booking price uses agreed offer terms and a server-calculated service fee', () => {
  const result = calculateBookingPrice(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-04T00:00:00Z'), 12550, 30000);
  assert.deepEqual(result, { rentalDays: 3, rentalTotalPaise: 37650, serviceFeePaise: 3012, totalPaise: 70662 });
});

test('booking prices reject invalid periods and unsafe amounts', () => {
  assert.throws(() => calculateBookingPrice(new Date('2026-11-04T00:00:00Z'), new Date('2026-11-04T00:00:00Z'), 1000, 0), HttpError);
  assert.throws(() => calculateBookingPrice(new Date('2026-11-01Z'), new Date('2026-11-02Z'), Number.MAX_SAFE_INTEGER, 0), HttpError);
});
