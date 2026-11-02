# InvoiceRail

InvoiceRail is a NEAR invoice-reconciliation prototype. Its Rust receiver accepts partial NEP-141 payments up to an invoice's remaining amount, asks the token resolver to return excess funds, and tracks asynchronous merchant withdrawals. The local replay app and offline statements distinguish invoice acceptance, requested returns, observed resolver events and unresolved amounts.

The bundled demo replays actual October 28 local NEAR Sandbox execution with a fixture token. It does not connect a wallet, create live invoices or send public-chain transactions. There is no live stablecoin, hosted merchant service or production-readiness claim.

## Try the recorded demo

Use Node 22 or later. No dependency installation or blockchain is needed for these commands.

```sh
node scripts/server.mjs
```

Open http://127.0.0.1:4173 and move through the recorded steps:

1. Invoice 001 is for 125.00; the first payment accepts 40.00.
2. A later payment offers 100.00. The receiver accepts the remaining 85.00 and requests 15.00 back. The recorded sandbox separately checked the token resolver's effect on the payer balance.
3. An initial merchant withdrawal fails because the merchant is not registered with the token. Its callback releases the reservation. After registration, the later withdrawal succeeds for 125.00.
4. Inspect rejected/cancelled/expired payments, the partial invoice, receipt evidence and exact-unit CSV export.

These controls replay finalized recorded transactions. They do not submit new payments or show an interactive pending-transaction workflow. Stop the local server with Ctrl+C.

## Inspect the settlement statement

```sh
node scripts/statement.mjs --format json
node scripts/statement.mjs --format invoices-csv
node scripts/statement.mjs --format payments-csv
```

Each command reads the bundled raw report and writes to stdout. It uses standard-library and local modules only. The saved outputs are also in `artifacts/statement.json`, `artifacts/invoices-statement.csv` and `artifacts/payments-statement.csv`.

The 100.00 payment has 85.00 accepted, 15.00 requested unused, 15.00 observed in a linked successful token-resolver event and zero unresolved. An observed event is not a fresh independent payer-balance measurement. Missing or ambiguous evidence remains unresolved; a blank observed-return CSV cell makes no observation claim. See [statement semantics](docs/STATEMENT.md).

`Demo USD` and six decimals are explicit local-fixture display conventions, not fetched token metadata or real stablecoin value. Raw integer amounts and formatted decimal strings are both retained without floating-point conversion.

## Reproduce the local checks

The dedicated offline tests need Node 22 only:

```sh
node --test test/ledger.test.mjs
node --test test/settlement-statement.test.mjs
```

To rebuild contracts and execute a new local sandbox scenario, use Linux x86-64 with npm and rustup. This downloads dependencies and a sandbox binary; all scenario accounts and tokens are local fixtures.

```sh
npm ci
rustup toolchain install 1.86.0 --profile minimal --target wasm32-unknown-unknown
npm run build:contracts
npm run test:sandbox
```

The sandbox command replaces `artifacts/sandbox-report.json` and `artifacts/invoices.csv`. Preserve the bundled files if comparing against the published snapshot hashes; a fresh run has different account/transaction/timestamp evidence. It does not automatically replace the saved derived statement files. The locked Rust/SDK versions and WASM flags are tested compatibility choices, not latest-version claims.

## What was validated

The October 28 local run passed 24 sandbox assertions with compiled contracts and token-balance checks. The retained ledger test result is seven tests. Separate historical dashboard/HTTP validation is described in [validation scope](docs/VALIDATION.md).

On November 2, all 12 dedicated statement cases passed, followed by all three export commands. They cover missing/partial/ambiguous returns, inconsistent receipt identities, duplicates, finality, exact large integers and CSV context. The bundled TAP log is `artifacts/statement-test.tap`. The saved statement contains four invoices and eight payments. Missing/partial uncertainty cases are synthetic test variations, not extra transactions claimed in that complete fixture.

This is trusted finalized-RPC replay, not a cryptographic light client. Public-network behavior, real stablecoin compatibility, live issuing/payment links/withdrawal UI, business adoption and production operations remain unverified. Invoice creation retains 0.01 NEAR for storage in the contract design; the demo uses only local valueless funds. Invoice records are not deleted. There is no customer-initiated refund of accepted payments, tax engine or currency conversion.

## Provenance and attribution

Built from scratch for NEAR HACKATHON's Real-World Money track beginning October 28, 2026; the statement increment was added November 1-2. No pre-announcement project baseline is claimed. AI assistance generated and reviewed substantial code and documentation. This repository does not claim market-first invoicing or equivalent features absent from established products.

Original project code is MIT licensed. NEAR SDK, NEAR Contract Standards, near-sys and near-workspaces remain under their upstream licenses; see [attribution](THIRD_PARTY.md) and the lockfiles. Source references are in [docs/SOURCES.md](docs/SOURCES.md).

The human demo outline is [docs/DEMO.md](docs/DEMO.md). A human-recorded public demo video is still required for the organizer's local-only route; screenshots or this source bundle alone do not fulfill it.
