import test from 'node:test';
import assert from 'node:assert/strict';
import { units, decimal, parseDecimal, extractEvents, reconcile, csv } from '../src/ledger.mjs';
const event = (sequence, name, details) => ({ key: `receipt-${sequence}:0`, sequence: String(sequence), event: name, details });
const initial = event(1, 'invoice_created', { invoice: { id: 'INV-1', payer: 'buyer.near', due: '125000000', received: '0', withdrawn: '0', pending: '0', cancelled: false } });
const paid = event(2, 'payment_received', { id: 'INV-1', payer: 'buyer.near', due: '125000000', offered: '140000000', accepted: '125000000', unused: '15000000', received: '125000000' });
test('u128 stays exact beyond JavaScript number precision', () => {
  assert.equal(units('340282366920938463463374607431768211455'), (1n << 128n) - 1n);
  assert.equal(decimal('9007199254740993'), '9007199254.740993');
  assert.equal(parseDecimal('9007199254.740993'), '9007199254740993');
  for (const x of ['-1', '01', '1e6', '1.5', 123, String(1n << 128n)]) assert.throws(() => units(x));
  assert.throws(() => parseDecimal('0.0000001'));
});
test('conservation and idempotent replay', () => {
  const ledger = reconcile([initial, paid, paid]);
  assert.equal(ledger.invoices[0].status, 'paid');
  assert.equal(ledger.totalUnused, '15000000');
  assert.equal(ledger.timeline.length, 2);
  assert.throws(() => reconcile([initial, { ...paid, details: { ...paid.details, accepted: '125000001' } }]));
  assert.throws(() => reconcile([initial, paid, { ...paid, details: { ...paid.details, unused: '1' } }]));
});
test('missing or reordered events fail visibly', () => {
  assert.throws(() => reconcile([paid]), /Missing or unordered/);
  assert.throws(() => reconcile([initial, { ...paid, sequence: '3' }]), /Missing or unordered/);
});
test('withdrawal failure releases reserved amount and retry settles once', () => {
  const events = [initial, paid,
    event(3, 'withdrawal_started', { id: 'INV-1', amount: '125000000' }),
    event(4, 'withdrawal_failed', { id: 'INV-1', amount: '125000000' }),
    event(5, 'withdrawal_started', { id: 'INV-1', amount: '125000000' }),
    event(6, 'withdrawal_completed', { id: 'INV-1', amount: '125000000' })];
  assert.equal(reconcile(events.slice(0, 3)).invoices[0].available, '0');
  assert.equal(reconcile(events.slice(0, 4)).invoices[0].available, '125000000');
  assert.equal(reconcile(events).invoices[0].withdrawn, '125000000');
  assert.throws(() => reconcile([...events.slice(0, 3), event(4, 'withdrawal_started', { id: 'INV-1', amount: '125000000' })]));
});
test('only successful receipts from the configured executor contribute', () => {
  const log = 'EVENT_JSON:' + JSON.stringify({ standard: 'invoicerail', version: '1.0.0', event: 'invoice_created', data: [{ sequence: '1', token: 'usd.near', details: initial.details }] });
  const receipt = (id, executor_id, status) => ({ id, outcome: { executor_id, status, logs: [log] } });
  const result = { final_execution_status: 'FINAL', transaction: { hash: 'tx' }, receipts_outcome: [receipt('r1', 'rail.near', { SuccessValue: '' }), receipt('r2', 'other.near', { SuccessValue: '' }), receipt('r3', 'rail.near', { Failure: {} })] };
  const events = extractEvents(result, 'rail.near', 'usd.near');
  assert.equal(events.length, 1); assert.equal(events[0].key, 'r1:0');
  assert.throws(() => extractEvents(result, 'rail.near', 'wrong.near'), /token mismatch/);
  assert.throws(() => extractEvents({ ...result, final_execution_status: 'EXECUTED_OPTIMISTIC' }, 'rail.near', 'usd.near'), /not final/);
});
test('expiry is evaluated as of the recorded receipt timestamp', () => {
  const created = structuredClone(initial);
  created.details.invoice.expires_ns = '200'; created.timestamp_ns = '100';
  assert.equal(reconcile([created]).invoices[0].status, 'open');
  const rejected = event(2, 'payment_rejected', { id: 'INV-1', offered: '1', unused: '1', reason: 'expired' });
  rejected.timestamp_ns = '201';
  assert.equal(reconcile([created, rejected]).invoices[0].status, 'expired');
});
test('CSV contains exact minor units and quotes cells', () => {
  assert.match(csv(reconcile([initial, paid])), /"125000000"/);
  const modified = structuredClone(initial); modified.details.invoice.id = '=SUM(A1)';
  assert.match(csv(reconcile([modified])), /"'=SUM\(A1\)"/);
});
