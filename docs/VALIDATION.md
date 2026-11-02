# Validation scope

The included October 28, 2026 report records 24 successful assertions from actual local NEAR Sandbox execution of the compiled Rust invoice receiver and official-standard fixture token. It includes 15 transaction steps, raw finalized receipts, contract views, token balances and WASM hashes. No public-chain transaction was performed. The report SHA-256 is b3863fa0197fa45c9bb48b52d2308d5cfaa97bb2ff5248c334559f8bd780e568.

Retained development validation also reports seven ledger tests and ten HTTP/module checks. On October 29, private browser validation passed 26 focused checks and eight desktop/mobile screenshots received independent review. That check exercised replay bounds, amounts, filters, evidence expansion and CSV equality at 1440x1000 and 390x844. These are historical results; browser recordings/internal execution records are not included in this source bundle. No physical-device, touch, accessibility or broad browser-compatibility claim is made.

On November 2, all 12 dedicated statement cases passed with no failures, cancellations, skips or todos. The TAP log is included. JSON, invoice CSV and payment CSV generation each exited successfully. Independent inspection checked output amounts and selected raw receipt links. The new exports have four invoices and eight payments. Their exact bytes are identified in PUBLIC_SOURCE_MANIFEST.json.

The 100.00 example has 85.00 accepted and 15.00 requested/observed return, with the resolver receipt identified. This event-based statement evidence is distinct from the historical sandbox's separate token-balance assertions. Missing/partial/ambiguous return tests use deliberate input variations; they do not claim additional actual token transfers.

The final four-invoice statement conserves 135.00 received = 125.00 withdrawn + 10.00 available. The failed withdrawal is retained at sequence 6; the later successful completion is sequence 8. Final totals do not display the intermediate failure snapshot or count the failed transfer as withdrawn.

No new chain run was performed for the statement increment. No deployment, live stablecoin, wallet integration, hosted merchant workflow, accounting-service integration, customer adoption or production readiness is established. The replay dashboard and saved statements demonstrate recorded local behavior.
