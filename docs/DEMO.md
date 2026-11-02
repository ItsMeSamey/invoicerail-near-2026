# Human demo outline

Use Node 22 or later to run `node scripts/server.mjs`, then open http://127.0.0.1:4173. The browser replays the included October28 local execution; it does not submit new transactions. Show its dated evidence panel.

1. Show invoice 001: 125.00 due, first payment 40.00, 85.00 outstanding.
2. Advance to 100.00 offered. Explain 85.00 accepted and 15.00 requested back. Distinguish the request from the separately recorded token-balance check.
3. Show failed withdrawal, reservation release and the later successful 125.00 withdrawal after token registration. These are finalized recorded transaction steps.
4. Open saved artifacts/statement.json. Show the 100/85/15 fields, linked resolver receipt, finalized_token_transfer_event and independentPayerBalanceDeltaVerified:false.
5. Show payments-statement.csv and its exact raw/formatted units, token/contract identifiers and receipt references. The fixture has no unresolved positive return; point to the passing missing/partial test names in statement-test.tap to explain synthetic uncertainty coverage honestly.
6. State the scope: local fixture contracts and replay, no live stablecoin or merchant payment workflow. End with the actual repository URL after publication.

The organizer's retained rules require the human to record and publish the X demo for the local-only route. Screenshots are not a replacement. Suggested caption for the human: Built at NEAR HACKATHON: InvoiceRail separates accepted invoice payments, requested returns, observed resolver events and unresolved exceptions. Local fixture demo; AI-assisted implementation. @NEARProtocol #NEARHackathon [actual repository URL]

This outline is not a recorded or published video. No current video URL is supplied. Recheck the official submission instructions before entry.
