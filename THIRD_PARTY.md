# Attribution and licenses

InvoiceRail's original code is distributed under the included MIT LICENSE. Substantial original implementation and documentation were generated and reviewed with AI assistance. No external invoicing-product source was imported.

The fixture token wraps the official NEAR Contract Standards fungible-token implementation; it is not a new token-standard implementation. Dependencies retain their own upstream licenses:

| Component | Pinned direct version | Upstream attribution |
| --- | --- | --- |
| near-sdk |5.17.2| NEAR SDK contributors; MIT/Apache-2.0 licensing; https://github.com/near/near-sdk-rs |
| near-contract-standards |5.17.2| NEAR SDK contributors; MIT/Apache-2.0 licensing; https://github.com/near/near-sdk-rs |
| near-sys |0.2.5| NEAR SDK contributors; upstream license applies; https://github.com/near/near-sdk-rs |
| near-workspaces |5.0.0| NEAR workspaces contributors; installed package manifest declares (MIT AND Apache-2.0); https://github.com/near/workspaces-js |

Cargo.lock and package-lock.json preserve the exact dependency resolution. This bundle does not vendor dependency code, node_modules, sandbox binaries or compiled WASM. Installations fetch those upstream packages under their own license terms. The project's MIT license does not replace third-party licenses. Node.js, Rust and the NEAR sandbox are separate toolchains, not bundled project code.
