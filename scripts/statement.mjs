import { readFile } from 'node:fs/promises';
import { buildSettlementStatement, invoiceStatementCsv, paymentStatementCsv } from '../src/settlement-statement.mjs';

const usage = `Offline InvoiceRail settlement statement (stdout only)

node scripts/statement.mjs [--input report.json] [--format json|invoices-csv|payments-csv]
                          [--decimals 6] [--symbol "Demo USD"]

Defaults to the bundled local-sandbox report. Asset label and decimals are local
fixture display conventions, not fetched token metadata. No network, wallet,
transaction, dependency download, or source-artifact write is performed.
Missing/ambiguous return evidence remains unresolved. Blank observed-return CSV
cells make no observed-return assertion: consult return_status (unresolved versus
not_requested), and never infer zero. Raw invoice CSV and reports are unchanged.
`;
try {
  const options = { input: new URL('../artifacts/sandbox-report.json', import.meta.url), format: 'json', decimals: 6, symbol: 'Demo USD' };
  const args = process.argv.slice(2), seen = new Set();
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(usage);
  } else {
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i], value = args[i + 1];
      if (!['--input', '--format', '--decimals', '--symbol'].includes(flag) || value === undefined || seen.has(flag)) throw new Error('Use --help for supported, non-repeated options');
      seen.add(flag);
      if (flag === '--decimals') {
        if (!/^(0|[1-9][0-9]?)$/.test(value)) throw new Error('Decimals must be an integer from 0 to 38');
        options.decimals = Number(value);
      } else options[flag.slice(2)] = value;
    }
    if (!['json', 'invoices-csv', 'payments-csv'].includes(options.format)) throw new Error('Unknown statement format');
    const report = JSON.parse(await readFile(options.input, 'utf8'));
    const statement = buildSettlementStatement(report, { decimals: options.decimals, symbol: options.symbol });
    const output = options.format === 'invoices-csv' ? invoiceStatementCsv(statement) : options.format === 'payments-csv' ? paymentStatementCsv(statement) : JSON.stringify(statement, null, 2) + '\n';
    process.stdout.write(output);
  }
} catch (error) {
  process.stderr.write(`Statement not produced: ${error.message}\n`);
  process.exitCode = 1;
}
