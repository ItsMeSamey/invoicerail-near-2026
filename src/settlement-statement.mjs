import { Buffer } from 'node:buffer';
import { extractEvents, reconcile, units } from './ledger.mjs';

const successful = receipt => {
  const status = receipt?.outcome?.status;
  return status && !('Failure' in status) && ('SuccessValue' in status || 'SuccessReceiptId' in status);
};
const decodeJson = encoded => JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));

function uniqueReceipts(raw) {
  const byId = new Map();
  for (const receipt of raw.receipts_outcome ?? []) {
    if (!receipt.id || !receipt.outcome) throw new Error('Receipt identity and outcome are required');
    const previous = byId.get(receipt.id);
    // Proof paths may differ between copies; the execution outcome must not.
    if (previous && JSON.stringify(previous.outcome) !== JSON.stringify(receipt.outcome)) throw new Error(`Conflicting receipt identity: ${receipt.id}`);
    if (!previous) byId.set(receipt.id, receipt);
  }
  return byId;
}

function transfers(receipt) {
  const rows = [];
  for (const [logIndex, line] of (receipt.outcome.logs ?? []).entries()) {
    if (!line.startsWith('EVENT_JSON:')) continue;
    const event = JSON.parse(line.slice(11));
    if (event.standard !== 'nep141' || event.version !== '1.0.0' || event.event !== 'ft_transfer') continue;
    if (!Array.isArray(event.data)) throw new Error('Invalid token transfer event');
    for (const [dataIndex, data] of event.data.entries()) rows.push({ ...data, logIndex, dataIndex });
  }
  return rows;
}

function observedReturn(raw, byId, event, paymentCount, contract, token) {
  const d = event.details, requested = units(d.unused);
  const unresolved = reason => ({ status: requested === 0n ? 'not_requested' : 'unresolved', observedRaw: null, unresolvedRaw: requested.toString(), reason, provenance: null });
  if (requested === 0n) return unresolved('No return requested; no positive return movement is asserted');
  if (paymentCount !== 1) return unresolved('More than one invoice payment in the transaction');
  try {
    const tx = raw.transaction, actions = tx?.actions;
    if (tx.receiver_id !== token || tx.signer_id !== d.payer || actions?.length !== 1 || actions[0].FunctionCall?.method_name !== 'ft_transfer_call') return unresolved('Transaction is not an attributable single transfer-call');
    const args = decodeJson(actions[0].FunctionCall.args);
    if (args.receiver_id !== contract || args.msg !== d.id || args.amount !== d.offered) return unresolved('Transfer-call arguments do not match the invoice event');
    const txOutcome = raw.transaction_outcome;
    if (txOutcome?.id !== tx.hash || !successful(txOutcome)) return unresolved('Missing successful transaction outcome');
    const initialId = txOutcome.outcome.status.SuccessReceiptId;
    if (!txOutcome.outcome.receipt_ids?.includes(initialId)) return unresolved('Missing transaction-to-token receipt link');
    const initial = byId.get(initialId);
    if (!successful(initial) || initial.outcome.executor_id !== token) return unresolved('Missing successful initial token receipt');
    const incoming = transfers(initial).filter(t => t.old_owner_id === d.payer && t.new_owner_id === contract && t.amount === d.offered);
    if (incoming.length !== 1) return unresolved('Incoming token movement is missing or ambiguous');
    const resolverId = initial.outcome.status.SuccessReceiptId;
    const children = initial.outcome.receipt_ids ?? [];
    if (resolverId === event.receipt || !children.includes(event.receipt) || !children.includes(resolverId)) return unresolved('Missing linked receiver and resolver receipts');
    const receiver = byId.get(event.receipt), resolver = byId.get(resolverId);
    if (!successful(receiver) || receiver.outcome.executor_id !== contract || !successful(resolver) || resolver.outcome.executor_id !== token) return unresolved('Linked receiver or token resolver did not succeed');
    const receiverUnused = decodeJson(receiver.outcome.status.SuccessValue);
    if (receiverUnused !== d.unused) return unresolved('Receiver return disagrees with its invoice event');
    const matching = transfers(resolver).filter(t => t.old_owner_id === contract && t.new_owner_id === d.payer && t.memo === 'refund');
    if (matching.length !== 1) return unresolved('Resolver return movement is missing or ambiguous');
    const movement = matching[0], observed = units(movement.amount);
    const used = units(decodeJson(resolver.outcome.status.SuccessValue));
    // This checks an observed token movement, never converts the receiver request
    // into a refund. Partial observed returns leave the remainder unresolved.
    if (observed === 0n || observed > requested || used + observed !== units(d.offered)) return unresolved('Resolver movement does not reconcile with offered and unused amounts');
    return {
      status: observed === requested ? 'observed' : 'partially_observed',
      observedRaw: observed.toString(), unresolvedRaw: (requested - observed).toString(),
      reason: 'Observed matching NEP-141 return in the linked successful token resolver receipt',
      provenance: { initialTokenReceipt: initialId, receiverReceipt: event.receipt, resolverReceipt: resolverId, resolverLogIndex: movement.logIndex, resolverDataIndex: movement.dataIndex },
    };
  } catch {
    return unresolved('Resolver evidence could not be decoded or validated');
  }
}

const amount = (raw, decimals) => {
  if (raw === null) return null;
  const n = units(raw), scale = 10n ** BigInt(decimals);
  return { raw, formatted: decimals === 0 ? raw : `${n / scale}.${(n % scale).toString().padStart(decimals, '0')}` };
};
const reference = event => ({ sequence: event.sequence, event: event.event, timestampNs: event.timestamp_ns, transaction: event.transaction, receipt: event.receipt, eventKey: event.key });

/** Offline statement for the retained local fixture, not a public-network indexer. */
export function buildSettlementStatement(report, { decimals = 6, symbol = 'Demo USD' } = {}) {
  if (report.network !== 'local-sandbox') throw new Error('Only local-sandbox fixture reports are supported');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38 || typeof symbol !== 'string' || !symbol.trim()) throw new Error('Explicit valid fixture asset display metadata is required');
  if (typeof report.contract !== 'string' || !report.contract || typeof report.token !== 'string' || !report.token || !Array.isArray(report.steps)) throw new Error('Report contract, token and steps are required');
  const events = [], payments = [], seenPayments = new Map(), seenTransactions = new Map();
  for (const step of report.steps) {
    const raw = step.raw;
    if (!raw || raw.final_execution_status !== 'FINAL') throw new Error('Every source transaction must be FINAL');
    if (!raw.transaction?.hash || step.transaction !== raw.transaction.hash) throw new Error('Step transaction identity mismatch');
    const byId = uniqueReceipts(raw);
    const transactionEvidence = JSON.stringify({ transaction: raw.transaction, status: raw.status, initialId: raw.transaction_outcome?.id, initial: raw.transaction_outcome?.outcome, receipts: [...byId].sort(([a], [b]) => a.localeCompare(b)).map(([id, receipt]) => [id, receipt.outcome]) });
    if (seenTransactions.has(raw.transaction.hash)) {
      if (seenTransactions.get(raw.transaction.hash) !== transactionEvidence) throw new Error('Conflicting duplicate transaction evidence');
      continue;
    }
    seenTransactions.set(raw.transaction.hash, transactionEvidence);
    const extracted = extractEvents({ ...raw, receipts_outcome: [...byId.values()] }, report.contract, report.token);
    events.push(...extracted);
    const paymentEvents = extracted.filter(e => e.event === 'payment_received' || e.event === 'payment_rejected');
    for (const event of paymentEvents) {
      const previous = seenPayments.get(event.key);
      if (previous) {
        if (previous !== JSON.stringify(event)) throw new Error('Conflicting duplicate payment event');
        continue;
      }
      seenPayments.set(event.key, JSON.stringify(event));
      const d = event.details;
      if (event.event === 'payment_rejected' && Object.hasOwn(d, 'accepted') && d.accepted !== '0') throw new Error('Rejected payment cannot have accepted income');
      const returned = observedReturn(raw, byId, event, paymentEvents.length, report.contract, report.token);
      payments.push({
        invoiceId: d.id, payer: d.payer, kind: event.event, rejectionReason: d.reason ?? null,
        offered: amount(d.offered, decimals), accepted: amount(event.event === 'payment_rejected' ? '0' : d.accepted, decimals), requestedUnused: amount(d.unused, decimals),
        observedReturned: amount(returned.observedRaw, decimals), unresolvedReturn: amount(returned.unresolvedRaw, decimals),
        returnStatus: returned.status, returnExplanation: returned.reason,
        returnEvidenceType: returned.provenance ? 'finalized_token_transfer_event' : 'none',
        independentPayerBalanceDeltaVerified: false,
        provenance: { payment: reference(event), returnMovement: returned.provenance },
      });
    }
  }
  // Rebuild from raw finalized receipts; report.ledger/events are not used as evidence.
  const ledger = reconcile(events);
  if (!ledger.timeline.length) throw new Error('No invoice events in the report');
  const last = ledger.timeline.at(-1), asOfNs = units(last.timestamp_ns);
  const invoices = ledger.invoices.map(invoice => {
    const row = { id: invoice.id, payer: invoice.payer, status: invoice.status, expiresNs: invoice.expires_ns, amounts: {}, provenance: [] };
    for (const field of ['due', 'received', 'outstanding', 'withdrawn', 'pending', 'available']) row.amounts[field] = amount(invoice[field], decimals);
    row.provenance = ledger.timeline.filter(e => (e.details.id ?? e.details.invoice?.id) === invoice.id).map(reference);
    return row;
  });
  return {
    schemaVersion: '1.0.0', network: report.network, contract: report.contract,
    asset: { tokenContract: report.token, symbol, decimals, localFixture: true, metadataSource: 'Explicit local fixture display convention; not fetched token metadata or a real stablecoin' },
    asOf: { timestampNs: asOfNs.toString(), sequence: ledger.sequence, meaning: 'Last included invoice receipt timestamp; not current time or report creation time' },
    sourceReportGeneratedAt: report.generatedAt ?? null,
    evidenceBasis: 'Recorded finalized RPC outcomes and token events; trusted local fixture evidence, not independent cryptographic proofs or a fresh balance query',
    invoices, payments,
  };
}

function csvRows(columns, rows) {
  const cell = value => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  return [columns.join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))].join('\n') + '\n';
}
function context(statement) {
  return { network: statement.network, invoice_contract: statement.contract, token_contract: statement.asset.tokenContract, asset_label: statement.asset.symbol, decimals: statement.asset.decimals, local_fixture: statement.asset.localFixture, as_of_ns: statement.asOf.timestampNs, as_of_sequence: statement.asOf.sequence };
}
const contextColumns = ['network', 'invoice_contract', 'token_contract', 'asset_label', 'decimals', 'local_fixture', 'as_of_ns', 'as_of_sequence'];
function flattenAmounts(row, fields) {
  return Object.fromEntries(fields.flatMap(field => [[`${field}_raw`, row[field]?.raw ?? ''], [`${field}_formatted`, row[field]?.formatted ?? '']]));
}
export function invoiceStatementCsv(statement) {
  const fields = ['due', 'received', 'outstanding', 'withdrawn', 'pending', 'available'];
  const columns = ['invoice_id', 'payer', 'status', ...contextColumns, ...fields.flatMap(f => [`${f}_raw`, `${f}_formatted`]), 'transaction_ids', 'receipt_ids'];
  return csvRows(columns, statement.invoices.map(i => ({ ...context(statement), invoice_id: i.id, payer: i.payer, status: i.status, ...flattenAmounts(i.amounts, fields), transaction_ids: [...new Set(i.provenance.map(p => p.transaction))].join(';'), receipt_ids: [...new Set(i.provenance.map(p => p.receipt))].join(';') })));
}
export function paymentStatementCsv(statement) {
  const fields = ['offered', 'accepted', 'requestedUnused', 'observedReturned', 'unresolvedReturn'];
  const columns = ['invoice_id', 'payer', 'return_status', 'return_evidence_type', 'independent_payer_balance_delta_verified', ...contextColumns, ...fields.flatMap(f => [`${f}_raw`, `${f}_formatted`]), 'transaction_id', 'invoice_receipt', 'resolver_receipt', 'explanation'];
  return csvRows(columns, statement.payments.map(p => ({ ...context(statement), invoice_id: p.invoiceId, payer: p.payer, return_status: p.returnStatus, return_evidence_type: p.returnEvidenceType, independent_payer_balance_delta_verified: p.independentPayerBalanceDeltaVerified, ...flattenAmounts(p, fields), transaction_id: p.provenance.payment.transaction, invoice_receipt: p.provenance.payment.receipt, resolver_receipt: p.provenance.returnMovement?.resolverReceipt ?? '', explanation: p.returnExplanation })));
}
