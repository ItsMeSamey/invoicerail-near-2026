# Sources and compatibility pins

- NEAR HACKATHON rules, rechecked November 1, 2026: https://nearhackathon.com/HACKATHON.md . Q-001 permits work from the October 19 announcement; Q-005 permits disclosed AI assistance; Q-011 makes integrations optional; Q-012 permits a public reproducible local demo with a video. Recheck current rules before entry.
- NEP-141: https://github.com/near/NEPs/blob/master/neps/nep-0141.md . Token amounts are decimal-string u128 values. ft_on_transfer returns unused tokens; the token contract resolves that request.
- NEAR Rust SDK and Contract Standards: https://github.com/near/near-sdk-rs . The project pins 5.17.2 with near-sys 0.2.5 and Rust 1.86.0 for the tested WASM/sandbox compatibility.
- near-workspaces JavaScript: https://github.com/near/workspaces-js . Version 5.0.0 supplies the local sandbox test driver; the retained run used sandbox 2.6.2/protocol 77.
- Transaction finality: https://docs.near.org/api/rpc/transactions . The scenario requests FINAL and the ledger rejects nonfinal evidence.

Version pins describe tested compatibility, not the latest upstream release. Local fixture behavior does not establish real stablecoin issuer compatibility or a NEAR Intents integration.
