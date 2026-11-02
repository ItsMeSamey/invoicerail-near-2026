const MAX = (1n << 128n) - 1n;
export function units(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Amount must be a canonical integer string');
  const result = BigInt(value);
  if (result > MAX) throw new Error('Amount exceeds u128');
  return result;
}
export function decimal(value, precision = 6) {
  const n = units(value), scale = 10n ** BigInt(precision);
  return `${n / scale}.${(n % scale).toString().padStart(precision, '0')}`;
}
export function parseDecimal(value, precision = 6) {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) throw new Error('Enter a positive decimal amount');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > precision) throw new Error(`At most ${precision} decimal places`);
  const result = (BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0'))).toString();
  units(result);
  return result;
}

// The caller supplies finalized RPC results. A log from another executor or a failed
// receipt is never accepted as an invoice event, even if its text is identical.
export function extractEvents(result, contract, token) {
  if (result.final_execution_status !== 'FINAL') throw new Error('Transaction is not final');
  const events = [];
  for (const receipt of result.receipts_outcome ?? []) {
    const o = receipt.outcome;
    if (o.executor_id !== contract || !o.status || 'Failure' in o.status || !('SuccessValue' in o.status || 'SuccessReceiptId' in o.status)) continue;
    for (const [index, line] of (o.logs ?? []).entries()) {
      if (!line.startsWith('EVENT_JSON:')) continue;
      let log;
      try { log = JSON.parse(line.slice(11)); } catch { throw new Error('Malformed invoice event'); }
      if (log.standard !== 'invoicerail') continue;
      if (log.version !== '1.0.0' || !Array.isArray(log.data) || log.data.length !== 1) throw new Error('Unsupported invoice event schema');
      const data = log.data[0];
      if (data.token !== token) throw new Error('Event token mismatch');
      events.push({ key: `${receipt.id}:${index}`, receipt: receipt.id, transaction: result.transaction?.hash ?? '', event: log.event, ...data });
    }
  }
  return events;
}

export function reconcile(events) {
  const invoices = new Map(), seen = new Map(), timeline = [];
  let sequence = 0n, totalUnused = 0n;
  for (const e of events) {
    if (seen.has(e.key)) {
      if (seen.get(e.key) !== JSON.stringify(e)) throw new Error('Conflicting duplicate receipt');
      continue;
    }
    const next = units(e.sequence);
    if (next !== sequence + 1n) throw new Error(`Missing or unordered event: expected ${sequence + 1n}, received ${next}`);
    const d = e.details;
    if (e.event === 'invoice_created') {
      const i = d.invoice;
      if (invoices.has(i.id)) throw new Error('Duplicate invoice');
      if (units(i.due) === 0n || units(i.received) !== 0n || units(i.withdrawn) !== 0n || units(i.pending) !== 0n) throw new Error('Invalid initial balances');
      invoices.set(i.id, { ...i });
    } else if (e.event === 'payment_rejected') {
      if (units(d.offered) !== units(d.unused)) throw new Error('Rejected amount mismatch');
      totalUnused += units(d.unused);
    } else {
      const i = invoices.get(d.id);
      if (!i) throw new Error(`Unknown invoice ${d.id}`);
      switch (e.event) {
        case 'payment_received': {
          const accepted = units(d.accepted), unused = units(d.unused);
          if (accepted + unused !== units(d.offered) || units(i.received) + accepted !== units(d.received) || d.due !== i.due || d.payer !== i.payer || i.cancelled) throw new Error('Payment conservation mismatch');
          i.received = d.received;
          totalUnused += unused;
          break;
        }
        case 'invoice_cancelled': i.cancelled = true; break;
        case 'withdrawal_started':
          if (units(i.pending) !== 0n || units(d.amount) === 0n || units(d.amount) !== units(i.received) - units(i.withdrawn)) throw new Error('Invalid withdrawal reservation');
          i.pending = d.amount; break;
        case 'withdrawal_completed':
        case 'withdrawal_failed':
          if (units(d.amount) === 0n || d.amount !== i.pending) throw new Error('Withdrawal callback mismatch');
          if (e.event === 'withdrawal_completed') i.withdrawn = (units(i.withdrawn) + units(d.amount)).toString();
          i.pending = '0'; break;
        default: throw new Error(`Unsupported event ${e.event}`);
      }
      if (units(i.received) > units(i.due) || units(i.withdrawn) + units(i.pending) > units(i.received)) throw new Error('Invoice conservation violated');
    }
    seen.set(e.key, JSON.stringify(e));
    sequence = next;
    timeline.push(e);
  }
  const asOf = BigInt(timeline.at(-1)?.timestamp_ns ?? '0');
  const rows = [...invoices.values()].map(i => ({ ...i, outstanding: (units(i.due) - units(i.received)).toString(), available: (units(i.received) - units(i.withdrawn) - units(i.pending)).toString(), status: i.cancelled ? 'cancelled' : i.received === i.due ? 'paid' : i.expires_ns && BigInt(i.expires_ns) <= asOf ? 'expired' : i.received === '0' ? 'open' : 'partial' }));
  return { invoices: rows, timeline, totalUnused: totalUnused.toString(), sequence: sequence.toString() };
}

export function csv(ledger) {
  const cols = ['id', 'payer', 'due', 'received', 'outstanding', 'withdrawn', 'pending', 'available', 'status'];
  const cell = value => `"${String(value).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  return [cols.join(','), ...ledger.invoices.map(i => cols.map(c => cell(i[c])).join(','))].join('\n') + '\n';
}
