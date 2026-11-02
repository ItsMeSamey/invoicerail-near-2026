import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { buildSettlementStatement, invoiceStatementCsv, paymentStatementCsv } from '../src/settlement-statement.mjs';

const retained = JSON.parse(await readFile(new URL('../artifacts/sandbox-report.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(retained);
const payment = statement => statement.payments.find(p => p.invoiceId === 'INV-2026-001' && p.offered.raw === '100000000');
const scenario = report => {
  const step = report.steps.find(s => s.label === 'Pay INV-2026-001: 100000000 units');
  const initial = step.raw.receipts_outcome.find(r => r.id === step.raw.transaction_outcome.outcome.status.SuccessReceiptId);
  const resolver = step.raw.receipts_outcome.find(r => r.id === initial.outcome.status.SuccessReceiptId);
  const receiver = step.raw.receipts_outcome.find(r => r.outcome.executor_id === report.contract && r.outcome.logs.some(l => l.includes('payment_received')));
  return { step, initial, resolver, receiver };
};
const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64');
const editReturn = (resolver, edit) => {
  const index = resolver.outcome.logs.findIndex(l => l.includes('ft_transfer'));
  const event = JSON.parse(resolver.outcome.logs[index].slice(11)); edit(event.data[0]);
  resolver.outcome.logs[index] = 'EVENT_JSON:' + JSON.stringify(event);
};

test('retained 100 payment reconciles 85 accepted and 15 observed token return', () => {
  const statement = buildSettlementStatement(retained), p = payment(statement);
  assert.equal(p.accepted.raw, '85000000');
  assert.deepEqual(p.requestedUnused, { raw: '15000000', formatted: '15.000000' });
  assert.deepEqual(p.observedReturned, p.requestedUnused);
  assert.equal(p.unresolvedReturn.raw, '0'); assert.equal(p.returnStatus, 'observed');
  assert.equal(p.returnEvidenceType, 'finalized_token_transfer_event');
  assert.equal(p.independentPayerBalanceDeltaVerified, false);
  assert.equal(p.provenance.returnMovement.resolverReceipt, scenario(retained).resolver.id);
  assert.equal(p.provenance.payment.transaction, scenario(retained).step.transaction);
  assert.equal(statement.asset.tokenContract, retained.token); assert.equal(statement.asset.localFixture, true);
  assert.equal(statement.asset.decimals, 6); assert.equal(statement.network, 'local-sandbox');
  assert.ok(BigInt(statement.asOf.timestampNs) > 0n);
});

test('invoice balances conserve accepted funds without counting unused as income', () => {
  const statement = buildSettlementStatement(retained);
  const first = statement.invoices.find(i => i.id === 'INV-2026-001');
  const third = statement.invoices.find(i => i.id === 'INV-2026-003');
  assert.deepEqual(first.amounts.withdrawn, { raw: '125000000', formatted: '125.000000' });
  assert.equal(first.amounts.received.raw, '125000000');
  assert.deepEqual(third.amounts.available, { raw: '10000000', formatted: '10.000000' });
  assert.deepEqual(third.amounts.outstanding, { raw: '20000000', formatted: '20.000000' });
  for (const i of statement.invoices) {
    const a = i.amounts;
    assert.equal(BigInt(a.withdrawn.raw) + BigInt(a.pending.raw) + BigInt(a.available.raw), BigInt(a.received.raw));
    assert.equal(BigInt(a.received.raw) + BigInt(a.outstanding.raw), BigInt(a.due.raw));
    assert.ok(i.provenance.every(p => p.receipt && p.transaction));
  }
});

test('missing resolver evidence remains unknown despite receiver request and balances', () => {
  const report = copy(), { step, resolver } = scenario(report);
  step.raw.receipts_outcome = step.raw.receipts_outcome.filter(r => r.id !== resolver.id);
  const p = payment(buildSettlementStatement(report));
  assert.equal(p.returnStatus, 'unresolved'); assert.equal(p.observedReturned, null);
  assert.equal(p.unresolvedReturn.raw, '15000000'); assert.equal(p.returnEvidenceType, 'none');
  assert.equal(p.provenance.returnMovement, null);
});

test('multiple matching movements or transaction actions remain ambiguous', () => {
  for (const mutate of [
    ({ resolver }) => resolver.outcome.logs.push(resolver.outcome.logs.find(l => l.includes('ft_transfer'))),
    ({ step }) => step.raw.transaction.actions.push(structuredClone(step.raw.transaction.actions[0])),
  ]) {
    const report = copy(); mutate(scenario(report));
    const p = payment(buildSettlementStatement(report));
    assert.equal(p.returnStatus, 'unresolved'); assert.equal(p.observedReturned, null);
  }
});

test('wrong counterpart, failed resolver, broken graph or undecodable return never confirm', () => {
  const changes = [
    ({ resolver }) => editReturn(resolver, t => { t.new_owner_id = 'unrelated.test.near'; }),
    ({ resolver }) => { resolver.outcome.executor_id = 'another-token.test.near'; },
    ({ resolver }) => { resolver.outcome.status = { Failure: {} }; },
    ({ resolver }) => { resolver.outcome.status = { SuccessValue: 'not-json' }; },
    ({ initial, receiver }) => { initial.outcome.receipt_ids = initial.outcome.receipt_ids.filter(id => id !== receiver.id); },
    ({ resolver }) => editReturn(resolver, t => { t.amount = '0'; }),
  ];
  for (const mutate of changes) {
    const report = copy(); mutate(scenario(report));
    const p = payment(buildSettlementStatement(report));
    assert.equal(p.returnStatus, 'unresolved'); assert.equal(p.observedReturned, null);
  }
});

test('observed partial return leaves the unobserved requested remainder unresolved', () => {
  const report = copy(), { resolver } = scenario(report);
  editReturn(resolver, t => { t.amount = '5000000'; });
  resolver.outcome.status.SuccessValue = encoded('95000000');
  const p = payment(buildSettlementStatement(report));
  assert.equal(p.returnStatus, 'partially_observed');
  assert.equal(p.observedReturned.raw, '5000000'); assert.equal(p.unresolvedReturn.raw, '10000000');
});

test('identical duplicate receipts and whole transaction steps are idempotent', () => {
  const report = copy();
  for (const step of report.steps) step.raw.receipts_outcome.push(...structuredClone(step.raw.receipts_outcome));
  report.steps.push(structuredClone(report.steps[2]));
  assert.deepEqual(buildSettlementStatement(report), buildSettlementStatement(retained));
});

test('conflicting duplicates, sequence gaps and nonfinal evidence are surfaced', () => {
  const conflict = copy(), { step, resolver } = scenario(conflict);
  const changed = structuredClone(resolver); editReturn(changed, t => { t.amount = '1'; });
  step.raw.receipts_outcome.push(changed);
  assert.throws(() => buildSettlementStatement(conflict), /Conflicting receipt/);
  const duplicateTx = copy(), otherStep = structuredClone(scenario(duplicateTx).step);
  otherStep.raw.receipts_outcome.pop(); duplicateTx.steps.push(otherStep);
  assert.throws(() => buildSettlementStatement(duplicateTx), /Conflicting duplicate transaction/);
  const conflictingId = copy(), otherIdentity = structuredClone(scenario(conflictingId).step);
  otherIdentity.raw.transaction_outcome.id = 'different-transaction-identity';
  conflictingId.steps.push(otherIdentity);
  assert.throws(() => buildSettlementStatement(conflictingId), /Conflicting duplicate transaction/);
  const gap = copy(); gap.steps.shift();
  assert.throws(() => buildSettlementStatement(gap), /Missing or unordered/);
  const optimistic = copy(); optimistic.steps[0].raw.final_execution_status = 'EXECUTED_OPTIMISTIC';
  assert.throws(() => buildSettlementStatement(optimistic), /FINAL/);
});

test('full rejection returns and zero-unused payments are distinct', () => {
  const statement = buildSettlementStatement(retained);
  const rejected = statement.payments.find(p => p.rejectionReason === 'cancelled');
  assert.equal(rejected.accepted.raw, '0'); assert.equal(rejected.returnStatus, 'observed');
  assert.deepEqual(rejected.observedReturned, rejected.offered);
  const partial = statement.payments.find(p => p.offered.raw === '40000000');
  assert.equal(partial.returnStatus, 'not_requested'); assert.equal(partial.observedReturned, null);
  assert.equal(partial.unresolvedReturn.raw, '0');
  const contradictory = copy();
  const rejectedStep = contradictory.steps.find(s => s.raw.receipts_outcome.some(r => r.outcome.logs.some(l => l.includes('payment_rejected'))));
  const rejectedReceipt = rejectedStep.raw.receipts_outcome.find(r => r.outcome.executor_id === contradictory.contract && r.outcome.logs.some(l => l.includes('payment_rejected')));
  const index = rejectedReceipt.outcome.logs.findIndex(l => l.includes('payment_rejected'));
  const rejectedEvent = JSON.parse(rejectedReceipt.outcome.logs[index].slice(11));
  rejectedEvent.data[0].details.accepted = '1';
  rejectedReceipt.outcome.logs[index] = 'EVENT_JSON:' + JSON.stringify(rejectedEvent);
  assert.throws(() => buildSettlementStatement(contradictory), /Rejected payment cannot have accepted income/);
});

test('display remains exact above the JavaScript safe integer limit', () => {
  const report = copy(); report.steps = [report.steps[0]];
  const receipt = report.steps[0].raw.receipts_outcome.find(r => r.outcome.executor_id === report.contract && r.outcome.logs.length);
  const event = JSON.parse(receipt.outcome.logs[0].slice(11));
  event.data[0].details.invoice.due = '9007199254740993';
  receipt.outcome.logs[0] = 'EVENT_JSON:' + JSON.stringify(event);
  const i = buildSettlementStatement(report).invoices[0];
  assert.deepEqual(i.amounts.due, { raw: '9007199254740993', formatted: '9007199254.740993' });
  assert.equal(buildSettlementStatement(report, { decimals: 0 }).invoices[0].amounts.due.formatted, '9007199254740993');
});

test('cached ledger and aggregate balances never substitute for receipt evidence', () => {
  const report = copy(); report.ledger = { invented: true }; report.events = [];
  for (const step of report.steps) step.balances = { payer: '0', merchant: '99999999999', contract: '0' };
  assert.deepEqual(buildSettlementStatement(report), buildSettlementStatement(retained));
});

test('separate CSV statements carry units, exact amounts and receipt provenance', () => {
  const statement = buildSettlementStatement(retained);
  const invoices = invoiceStatementCsv(statement), payments = paymentStatementCsv(statement);
  assert.match(invoices, /token_contract,asset_label,decimals,local_fixture,as_of_ns/);
  assert.match(invoices, /due_raw,due_formatted/); assert.match(invoices, /"125000000","125\.000000"/);
  assert.ok(invoices.includes(retained.token)); assert.ok(invoices.includes(statement.asOf.timestampNs));
  assert.match(invoices, /network,invoice_contract,token_contract/);
  assert.ok(invoices.includes(retained.contract)); assert.ok(payments.includes(retained.contract));
  assert.ok(payments.includes(scenario(retained).resolver.id));
  assert.match(payments, /requestedUnused_raw,requestedUnused_formatted,observedReturned_raw/);
  assert.match(payments, /"finalized_token_transfer_event","false"/);
  assert.equal(invoices.trimEnd().split('\n').length, statement.invoices.length + 1);
  // These fixture rows have no embedded newlines. Decode quoted cells to check
  // that absent observations remain blank, separately from explicit zeroes.
  const records = text => {
    const [header, ...lines] = text.trimEnd().split('\n'), columns = header.split(',');
    return lines.map(line => {
      const values = [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m => m[1].replaceAll('""', '"'));
      assert.equal(values.length, columns.length);
      return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    });
  };
  const missing = copy(), { step, resolver } = scenario(missing);
  step.raw.receipts_outcome = step.raw.receipts_outcome.filter(r => r.id !== resolver.id);
  const unresolved = records(paymentStatementCsv(buildSettlementStatement(missing))).find(row => row.transaction_id === step.transaction);
  assert.equal(unresolved.return_status, 'unresolved');
  assert.equal(unresolved.observedReturned_raw, ''); assert.equal(unresolved.observedReturned_formatted, '');
  assert.equal(unresolved.unresolvedReturn_raw, '15000000');
  const notRequested = records(payments).find(row => row.offered_raw === '40000000');
  assert.equal(notRequested.return_status, 'not_requested'); assert.equal(notRequested.observedReturned_raw, '');
  assert.equal(notRequested.requestedUnused_raw, '0'); assert.equal(notRequested.unresolvedReturn_raw, '0');
});
