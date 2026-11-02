use near_sdk::collections::{LookupMap, Vector};
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, PromiseResult};
use near_sdk::serde_json::json;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Invoice {
    pub id: String,
    pub payer: AccountId,
    pub due: U128,
    pub received: U128,
    pub withdrawn: U128,
    pub pending: U128,
    pub expires_ns: U64,
    pub cancelled: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct InvoiceRail {
    owner: AccountId,
    token: AccountId,
    invoices: LookupMap<String, Invoice>,
    ids: Vector<String>,
    sequence: u64,
}

#[near]
impl InvoiceRail {
    #[init]
    pub fn new(owner: AccountId, token: AccountId) -> Self {
        Self { owner, token, invoices: LookupMap::new(b"i"), ids: Vector::new(b"k"), sequence: 0 }
    }

    /// Fixed 0.01 NEAR covers bounded per-invoice storage; retained by the contract.
    #[payable]
    pub fn create_invoice(&mut self, id: String, payer: AccountId, due: U128, expires_ns: U64) -> Invoice {
        self.assert_owner();
        require!(env::attached_deposit() == NearToken::from_millinear(10), "Attach exactly 0.01 NEAR for storage");
        require!(!id.is_empty() && id.len() <= 64 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-'), "Invalid invoice ID");
        require!(self.invoices.get(&id).is_none(), "Invoice already exists");
        require!(due.0 > 0, "Amount must be positive");
        require!(expires_ns.0 > env::block_timestamp(), "Expiry must be in the future");
        let invoice = Invoice { id: id.clone(), payer, due, received: U128(0), withdrawn: U128(0), pending: U128(0), expires_ns, cancelled: false };
        self.invoices.insert(&id, &invoice);
        self.ids.push(&id);
        self.emit("invoice_created", json!({"invoice": invoice}));
        invoice
    }

    pub fn get_invoice(&self, id: String) -> Option<Invoice> { self.invoices.get(&id) }

    pub fn list_invoices(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        let start = from_index.unwrap_or(0) as u64;
        let end = start.saturating_add(limit.unwrap_or(50).min(100) as u64).min(self.ids.len());
        (start..end).filter_map(|i| self.ids.get(i).and_then(|id| self.invoices.get(&id))).collect()
    }

    pub fn configuration(&self) -> near_sdk::serde_json::Value {
        json!({"owner": self.owner, "token": self.token, "invoice_count": self.ids.len(), "sequence": self.sequence})
    }

    pub fn cancel_invoice(&mut self, id: String) {
        self.assert_owner();
        let mut invoice = self.invoices.get(&id).expect("Invoice not found");
        require!(!invoice.cancelled, "Already cancelled");
        invoice.cancelled = true;
        self.invoices.insert(&id, &invoice);
        self.emit("invoice_cancelled", json!({"id": id}));
    }

    /// NEP-141 receiver: unused amounts are returned to the token's resolver.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, "Unsupported token contract");
        let found = self.invoices.get(&msg);
        let reason = match &found {
            None => Some("unknown_invoice"),
            Some(i) if i.payer != sender_id => Some("wrong_payer"),
            Some(i) if i.cancelled => Some("cancelled"),
            Some(i) if env::block_timestamp() >= i.expires_ns.0 => Some("expired"),
            _ => None,
        };
        if let Some(reason) = reason {
            self.emit("payment_rejected", json!({"id": msg, "payer": sender_id, "offered": amount, "unused": amount, "reason": reason}));
            return PromiseOrValue::Value(amount);
        }
        let mut invoice = found.unwrap();
        let accepted = amount.0.min(invoice.due.0 - invoice.received.0);
        invoice.received.0 += accepted;
        self.invoices.insert(&msg, &invoice);
        self.emit("payment_received", json!({"id": msg, "payer": sender_id, "offered": amount, "accepted": U128(accepted), "unused": U128(amount.0 - accepted), "received": invoice.received, "due": invoice.due}));
        PromiseOrValue::Value(U128(amount.0 - accepted))
    }

    /// Reserve the amount before the cross-contract call; callback restores on failure.
    #[payable]
    pub fn withdraw(&mut self, id: String) -> Promise {
        self.assert_owner();
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "Attach one yoctoNEAR");
        let mut invoice = self.invoices.get(&id).expect("Invoice not found");
        require!(invoice.pending.0 == 0, "Withdrawal is already pending");
        let amount = invoice.received.0 - invoice.withdrawn.0;
        require!(amount > 0, "No funds available");
        invoice.pending = U128(amount);
        self.invoices.insert(&id, &invoice);
        self.emit("withdrawal_started", json!({"id": id, "amount": U128(amount)}));
        Promise::new(self.token.clone()).function_call(
            "ft_transfer".into(),
            json!({"receiver_id": self.owner, "amount": U128(amount), "memo": format!("InvoiceRail:{id}")}).to_string().into_bytes(),
            NearToken::from_yoctonear(1), Gas::from_tgas(20)
        ).then(Promise::new(env::current_account_id()).function_call(
            "on_withdraw".into(), json!({"id": id}).to_string().into_bytes(), NearToken::from_yoctonear(0), Gas::from_tgas(15)
        ))
    }

    #[private]
    pub fn on_withdraw(&mut self, id: String) -> bool {
        let mut invoice = self.invoices.get(&id).expect("Invoice not found");
        require!(invoice.pending.0 > 0, "No pending withdrawal");
        let amount = invoice.pending;
        let success = matches!(env::promise_result(0), PromiseResult::Successful(_));
        if success { invoice.withdrawn.0 += amount.0; }
        invoice.pending = U128(0);
        self.invoices.insert(&id, &invoice);
        self.emit(if success { "withdrawal_completed" } else { "withdrawal_failed" }, json!({"id": id, "amount": amount}));
        success
    }
}

impl InvoiceRail {
    fn assert_owner(&self) { require!(env::predecessor_account_id() == self.owner, "Only merchant may call"); }
    fn emit(&mut self, event: &str, data: near_sdk::serde_json::Value) {
        self.sequence += 1;
        env::log_str(&format!("EVENT_JSON:{}", json!({"standard": "invoicerail", "version": "1.0.0", "event": event, "data": [{"sequence": self.sequence.to_string(), "timestamp_ns": env::block_timestamp().to_string(), "token": self.token, "details": data}]})));
    }
}
