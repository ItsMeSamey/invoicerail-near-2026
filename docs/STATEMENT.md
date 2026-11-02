# Settlement statement semantics

The exporter reads the retained local-sandbox report and rebuilds invoice events from raw FINAL receipt outcomes. It does not trust cached report.ledger or report.events as settlement evidence. It checks transaction and receipt links, token, payer, receiver, invoice, transfer arguments and amount relationships. Duplicate identical evidence is counted once; conflicting identities are rejected.

Payment rows separate offered, accepted, requestedUnused, observedReturned and unresolvedReturn. A receiver's unused return value is a request. A positive observed return requires one attributable transfer-call, successful linked receipts, matching incoming movement, matching receiver return value and a matching token-resolver transfer event. Ambiguous or missing evidence remains unresolved. A partial observation leaves the remainder unresolved.

`returnEvidenceType: finalized_token_transfer_event` describes the evidence used. `independentPayerBalanceDeltaVerified` remains false. Historical sandbox balance checks are separate evidence, not a fresh independent balance query performed by this exporter.

A blank observed-return CSV cell means no observation assertion; consult return_status and never infer zero. `not_requested` distinguishes an explicit zero request from an unknown positive return. The complete retained fixture has six observed positive returns and two not_requested records; its unresolved totals are zero. Missing and partial-return conditions are covered by synthetic tests.

Invoice statements contain due, received, outstanding, withdrawn, pending and available amounts, with invoice/token/network/precision and as-of receipt references. Outstanding includes unpaid cancelled/expired invoices; it does not mean every outstanding amount is collectible. The final statement has 135.00 received = 125.00 withdrawn + 10.00 available, with zero pending. Earlier failed withdrawal and later completion appear separately in provenance.

Amounts use exact integer strings and BigInt. The six-decimal Demo USD label is a fixture convention, not fetched token metadata or a claim of market value. For example 15000000 raw units display as 15.000000. The as-of timestamp is the last included invoice receipt, not current time.

Commands write stdout only. Use `node scripts/statement.mjs --help` for --input, --format, --decimals and --symbol options. Changing display metadata does not establish a different real token integration. This is a trusted local-record reader, not a production indexer or cryptographic proof.
