import { reconcile, decimal, csv } from '/src/ledger.mjs';
const $ = id => document.getElementById(id);
const money = value => { const [a,b] = decimal(value).split('.'); return a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + b.replace(/0+$/, '').padEnd(2, '0'); };
const element = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
const names = { invoice_created: 'Invoice issued', payment_received: 'Payment processed', payment_rejected: 'Payment marked unused; return requested', invoice_cancelled: 'Invoice cancelled', withdrawal_started: 'Merchant transfer reserved', withdrawal_failed: 'Transfer failed; funds available again', withdrawal_completed: 'Merchant transfer completed' };
let report, current, downloadUrl;
function render() {
  const index = Number($('step').value), step = report.steps[index];
  current = reconcile(report.events.slice(0, step.eventCount));
  $('position').textContent = `${index + 1} / ${report.steps.length}`;
  $('stepLabel').textContent = step.label;
  $('previous').disabled = index === 0; $('next').disabled = index === report.steps.length - 1;
  for (const field of ['due', 'received', 'withdrawn']) $(field).textContent = money(current.invoices.reduce((sum, i) => sum + BigInt(i[field]), 0n).toString());
  $('returned').textContent = money(current.totalUnused);
  const rows = current.invoices.filter(i => $('filter').value === 'all' || i.status === $('filter').value);
  $('rows').replaceChildren(...rows.map(i => {
    const row = document.createElement('tr'), id = element('td', i.id); id.append(element('small', i.payer)); row.append(id);
    for (const field of ['due','received','outstanding']) { const cell = element('td', money(i[field])); cell.title = `${i[field]} exact minor units`; row.append(cell); }
    const badge = element('td', ''); badge.append(element('span', i.status === 'partial' ? 'Partially paid' : i.status[0].toUpperCase()+i.status.slice(1), `badge ${i.status}`)); row.append(badge); return row;
  }));
  if (!rows.length) { const row = document.createElement('tr'); const cell = element('td', 'No invoices at this step for this filter.', 'empty'); cell.colSpan = 5; row.append(cell); $('rows').append(row); }
  $('events').replaceChildren(...[...current.timeline].reverse().map(e => {
    const li = document.createElement('li'); li.append(element('span', `#${e.sequence}`), element('strong', names[e.event] ?? e.event));
    const d = e.details, amount = d.accepted ?? d.amount ?? d.unused;
    li.append(element('small', `${d.id ?? d.invoice?.id ?? ''}${amount ? ` · ${money(amount)} Demo USD` : ''}${d.reason ? ` · ${d.reason.replaceAll('_', ' ')}` : ''}`));
    li.append(element('small', `Receipt ${e.receipt}`)); return li;
  }));
  $('balances').replaceChildren();
  for (const [key, label] of [['payer','Customer token balance'], ['merchant','Merchant token balance'], ['contract','Invoice contract balance']]) $('balances').append(element('dt', label), element('dd', money(step.balances[key])));
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([csv(current)], { type: 'text/csv' })); $('export').href = downloadUrl; $('export').download = `invoicerail-step-${index+1}.csv`;
}
try {
  const response = await fetch('/artifacts/sandbox-report.json'); if (!response.ok) throw new Error('Run npm run test:sandbox to generate execution evidence.');
  report = await response.json(); if (!report.steps.length) throw new Error('Execution report has no steps.');
  $('step').max = report.steps.length - 1; $('step').value = report.steps.length - 1;
  $('notice').textContent = `Recorded local NEAR execution · ${report.passed} assertions passed · ${new Date(report.generatedAt).toUTCString()}`;
  $('checks').textContent = `${report.passed} checks. The receipts to prove them.`;
  $('proof').textContent = 'Amounts are reconciled from finalized invoice-contract receipts. Unused amounts are return requests; the sandbox separately verifies actual token balances after the token resolver runs. This demo uses a local token, not a real stablecoin.';
  $('details').textContent = report.checks.map(c => `PASS ${c}`).join('\n') + '\n\nWASM SHA-256\n' + JSON.stringify(report.wasmSha256, null, 2);
  $('step').addEventListener('input', render); $('filter').addEventListener('change', render);
  $('previous').addEventListener('click', () => { $('step').value = Number($('step').value) - 1; render(); });
  $('next').addEventListener('click', () => { $('step').value = Number($('step').value) + 1; render(); });
  render();
} catch (error) { $('notice').textContent = error.message; $('notice').style.color = '#9a382c'; }
