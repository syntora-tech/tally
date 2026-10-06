# Tally MCP: guide for agents

This document is for an AI agent (Claude Code, Claude, Cowork) that reads and enters Tally data over MCP: the Ledger, people, clients and trips. Decisions and limits: `docs/assumptions.md` A-054…A-056, A-061…A-066, A-070. Monthly bank statements: section 7. How clients, contracts, assignments and projects fit together, and what gets its own record versus a note: **`docs/agent-projects-guide.md`** — read it before entering people and clients.

## 1. What it is

Tally is the Syntora.Tech back-office. The `tally` MCP server lets an agent read and write Ledger accounts, categories, rates and transactions, plus people (Bench) profiles and clients. The agent acts as the token owner: the same permissions (RLS), and every change lands in the audit log marked “agent”.

| Environment        | MCP URL                                       |
| ------------------ | --------------------------------------------- |
| Local (`pnpm dev`) | `http://localhost:3000/api/mcp`               |
| Preview (Vercel)   | `https://tally-taupe-beta.vercel.app/api/mcp` |

Transport: Streamable HTTP without sessions. Authorization: `Authorization: Bearer <token>` header. Error messages from the server are always in English.

## 2. Connecting

1. The owner opens Tally → **Settings → Connected agents**, enters a name (e.g. “Claude Code — Ledger”), picks **“Assistant: read and write (Ledger, people, clients)”** and clicks “Create token”. The token is shown **once**; afterwards only its last 4 characters are visible.
2. The token is a password. Never paste it into chat, code, commits or repository files. Pass it through an environment variable:

   ```bash
   export TALLY_MCP_TOKEN='tally_pat_…'
   claude mcp add --transport http tally https://tally-taupe-beta.vercel.app/api/mcp \
     --header "Authorization: Bearer $TALLY_MCP_TOKEN"
   ```

   Or in `.mcp.json` (Claude Code expands environment variables):

   ```json
   {
     "mcpServers": {
       "tally": {
         "type": "http",
         "url": "https://tally-taupe-beta.vercel.app/api/mcp",
         "headers": { "Authorization": "Bearer ${TALLY_MCP_TOKEN}" }
       }
     }
   }
   ```

3. Check: `get_balances` returns the list of accounts (possibly empty).

Server responses: `401` — missing or unknown token; `403` — the token was revoked (ask the owner for a new one).

## 3. Tools

| Tool                      | Kind  | What it does                                                                                                                                            |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_balances`            | read  | Accounts: `name`, `kind`, `currency`, `network`, `address`, `openingBalance`, `openingDate`, `balance` (= opening + postings; `asOf` = up to that date) |
| `list_categories`         | read  | Categories: `txType`, `name`, `id`                                                                                                                      |
| `list_transactions`       | read  | Journal with postings; filters `from`, `to`, `type`, `categoryId`, `accountId`, `limit` (≤ 1000). The response includes `externalRef`                   |
| `list_fx_rates`           | read  | Stored rates: `onDate`, `base`, `quote`, `rate`, `source`                                                                                               |
| `upsert_accounts`         | write | Creates or updates accounts by exact name (≤ 100)                                                                                                       |
| `upsert_categories`       | write | Adds categories by (`txType`, `name`) (≤ 200); existing ones come back as `existing`                                                                    |
| `set_fx_rates`            | write | Manual rates (≤ 500); the same day and pair is overwritten                                                                                              |
| `add_transactions`        | write | Transactions in a batch (≤ 500), de-duplicated by `externalRef`                                                                                         |
| `update_transactions`     | write | Corrects transactions by `id` (≤ 100): only the fields sent change; legs `null` remove; links `personId` / `clientId`                                   |
| `delete_transactions`     | write | Deletes transactions by `id` (≤ 500) with their postings; allocated ones are refused. Destructive — only on the owner's explicit request                |
| `search_people`           | read  | People with Bench filters: `q`, `stack`, `seniority`, `maxRate`, `availableOn`, `allocation`, `location`, `bench`, `status`; no payee data              |
| `get_person`              | read  | A person's profile by `id`, current load (`load`, `bench`) and crypto `wallets`                                                                         |
| `list_clients`            | read  | Clients: `legalName`, `shortName`, `country`, `defaultCurrency`, number of contracts, crypto `wallets`                                                  |
| `find_wallets`            | read  | Who owns an address: wallets of people/clients with `owner`, plus our accounts with that address (`ownAccounts`)                                        |
| `list_payees`             | read  | Payees: `kind`, name, `taxId`, `iban`, payout wallet, linked `personId`                                                                                 |
| `upsert_person_profile`   | write | Creates or partially updates people profiles (≤ 200)                                                                                                    |
| `upsert_clients`          | write | Creates or partially updates clients (≤ 100)                                                                                                            |
| `list_contracts`          | read  | Client and FOP contracts: counterparty, currency, status, date rules, SOW/assignment counts, linked documents                                           |
| `get_contract`            | read  | One contract with its documents, SOWs/annexes and assignments of people                                                                                 |
| `upsert_contracts`        | write | Creates or partially updates contracts (≤ 50); `documentIds` links registry documents                                                                   |
| `list_contract_annexes`   | read  | SOWs/annexes inside contracts with their own date rules, documents and assignment count                                                                 |
| `upsert_contract_annexes` | write | Creates or partially updates SOWs/annexes (≤ 100); each result has the `id` for assignments                                                             |
| `list_assignments`        | read  | People on contracts/SOWs with the terms in force for a month and every terms version                                                                    |
| `upsert_assignments`      | write | Creates or partially updates assignments (≤ 100) with the first or next `billing`/`pay` versions                                                        |
| `upsert_wallets`          | write | Adds crypto wallets of people/clients or changes their `label` / `isActive` (≤ 200)                                                                     |
| `upsert_payees`           | write | Creates or partially updates payees (≤ 100), links them to a person, `makeDefault`                                                                      |
| `list_trips`              | read  | Trips: dates, status, participants with what is left to reimburse (UAH)                                                                                 |
| `get_trip`                | read  | One trip: expenses with UAH/USD values, reimbursements, per-person summary                                                                              |
| `upsert_trips`            | write | Creates or updates trips (≤ 20); adds participants                                                                                                      |
| `add_trip_expenses`       | write | Adds expenses to a trip (≤ 200) with optional receipt files; NBU rate by default; duplicate receipts refused                                            |
| `search_documents`        | read  | Document registry with linked records; filters `q`, `type`, `status`, `unlinked`, `linkedTo`                                                            |
| `get_document`            | read  | One document: metadata, links, version chain; `includeContent` returns the file (≤ 3 MB) as base64                                                      |
| `find_link_targets`       | read  | Records a document can be linked to, by `entityType` and text `q` → `{id, label}`                                                                       |
| `add_documents`           | write | Adds documents (≤ 10) with a base64 file (≤ 3 MB per call) or a link, plus links; `supersedesId` for a new version                                      |
| `update_documents`        | write | Corrects document metadata by `id` (≤ 100); `status: void` cancels; generated/signed files are read-only                                                |
| `link_documents`          | write | Links documents to records (≤ 200); an existing link comes back as `existing`                                                                           |
| `unlink_documents`        | write | Removes links (≤ 200); the documents stay. Destructive — only on the owner's request                                                                    |
| `delete_documents`        | write | Deletes documents uploaded by mistake (≤ 200) with their links; files go to the Drive trash. Destructive — only on the owner's request                  |

A wrong row is corrected with `update_transactions`. `delete_transactions` is only for an explicit request of the owner (A-063): run it with `dryRun` first and show what will go; a transaction allocated to an invoice or payout cannot be deleted until the allocation is removed in the UI. Agency fees, periods and hours are UI only; issuing invoices and acts is UI only, though their files are visible in the document registry.

## 4. Rules for every call

- **Money** is a decimal string: `"1400.20"`, `"0.001"`. Never a JSON number.
- **Dates** are `YYYY-MM-DD`.
- **Write tools** require `idempotencyKey`: a unique string of 8–200 characters per logical operation. Repeating the same key within 7 days returns the first result and writes nothing again. A new write needs a new key.
- **`dryRun: true`** runs everything, database checks included, and rolls back. Always `dryRun` first, then the same batch without `dryRun` and with a new key.
- **A batch is all-or-nothing.** If any item is invalid, nothing is written and `error.fieldErrors` holds keys like `transactions.3` (zero-based item index) with an explanation.
- An error comes back as `isError: true` with `{ "error": { "code", "message", "fieldErrors"? } }`. Codes: `validation_error`, `forbidden`, `conflict`, `not_found`, `rate_limited` (with `retryAfter` in seconds).
- **Limits:** 120 read and 30 write calls per minute.
- Split large volumes into batches of up to 500 transactions.

## 5. Transaction model

Every transaction is an event with postings. Amounts in `from` / `to` / `fee` are always **positive** in the account currency; the leg sets the sign:

| `type`                                     | Required legs                | Example                                                  |
| ------------------------------------------ | ---------------------------- | -------------------------------------------------------- |
| `revenue`                                  | `to`                         | Client payment received                                  |
| `expense`                                  | `from`                       | Contractor payment, taxes                                |
| `transfer`                                 | `from` + `to`                | Between our own accounts                                 |
| `fx_exchange`                              | `from` + `to`                | USD → EUR exchange: both actual amounts from a statement |
| `crypto_buy`, `crypto_sell`, `crypto_swap` | `from` + `to`                | Fiat ↔ crypto, crypto ↔ crypto                           |
| `adjustment`                               | exactly one of `from` / `to` | Balance correction                                       |

- `fee` is an optional fee; it is always debited (a negative posting) from the given account.
- **Crypto gas** (A-065): every outgoing on-chain transaction books its network fee in `fee` against the wallet's gas-token account (`Crypto ETH - ETH`, `Crypto TRON - TRX`), not against the token account. Take the fee from the explorer (ETH: `gasUsed × effectiveGasPrice`; TRON: burned TRX for energy and bandwidth, `0` when staked resources covered it — then omit `fee`). Amounts have at most 8 decimals: round wei to 8. Only the main token account of a wallet carries its `address` (one account per network + address); the other token and gas accounts of the same wallet have none.
- `account` is the exact account name or its `id`.
- `category` is the name of a category **of the same type** (or its `id`).
- The currency comes from the account. A transaction has no currency field (invariant I4).
- `externalRef` is a required stable unique key. If it already exists (including imported legacy records), the item comes back as `duplicate` and no second record is created.

## 6. Moving `Syntora Ledger.xlsx`

The file holds real financial data: read it only locally, copy it nowhere except into Tally, and never commit it. Order: **categories → accounts → rates → transactions → reconciliation.**

### 6.1 Before starting

Call `get_balances`, `list_categories`, `list_transactions` (`limit: 1000`). If accounts or transactions already exist, do not duplicate them: accounts are updated by name, transactions are filtered by `externalRef`.

### 6.2 Categories — sheet `Categories`

Columns: `Type`, `Category`. Type to `txType`: `Revenue` → `revenue`, `Expense` → `expense`, `Transfer` → `transfer`, `FX Exchange` → `fx_exchange`, `Crypto Buy` → `crypto_buy`, `Crypto Sell` → `crypto_sell`, `Crypto Swap` → `crypto_swap`, `Adjustment` → `adjustment`. One `upsert_categories` call. The `Bad Debt` (expense) category already exists.

### 6.3 Accounts — sheet `Accounts`

Columns: `Account ID` (not needed), `Account Name` → `name`, `Type` (`Bank` / `Crypto` / `Cash`) → `kind` in lower case, `Currency` → `currency`, `Network` → `network` (crypto only; one of `ETH`, `BSC`, `POLYGON`, `ARBITRUM`, `BASE`, `OPTIMISM`, `AVALANCHE`, `TRON`, `SOLANA`, `BTC`, `TON` — map `ERC20` → `ETH`, `TRC20` → `TRON`), `address` — our wallet address on that network if known, `Opening Balance` → `openingBalance` as a string.

`openingDate` is the date of the **earliest** transaction on the `Transactions` sheet (`2026-01-01` in this file), the same for all accounts.

### 6.4 Rates — sheet `FX_Rates`

Columns: `Date`, `Currency`, `Rate to USD` (how many USD one unit costs). Skip `USD`, `USDT`, `USDC` rows. Conversion:

- `UAH` with `Rate to USD = x` → `{ base: "USD", quote: "UAH", rate: 1/x }`, rounded to 6 places. E.g. `0.0232558…` → `"43.000000"`.
- Another currency (`EUR`) → `{ base: "EUR", quote: "USD", rate: x }`, rounded to 6 places.

### 6.5 Transactions — sheet `Transactions`

Columns by Excel letter:

| Column | Name                    | Goes to                                                    |
| ------ | ----------------------- | ---------------------------------------------------------- |
| A      | Date                    | `occurredOn`                                               |
| B      | Type                    | `type` (mapping as in 6.2)                                 |
| C      | Category                | `category`                                                 |
| D      | From Account            | `from.account`                                             |
| E      | To Account              | `to.account`                                               |
| F      | Amount From             | `from.amount`                                              |
| G      | Currency From           | check only                                                 |
| H      | Amount To               | `to.amount`                                                |
| I      | Currency To             | check only                                                 |
| J      | FX Rate                 | do not enter: the exchange rate comes from the two amounts |
| K      | Fee Amount              | `fee.amount`                                               |
| L      | Fee Account             | `fee.account`; if empty — the account from D, else E       |
| M      | Description             | `description`                                              |
| N, O   | USD Value, FX Gain/Loss | do not enter: formulas                                     |

Rules:

1. **Dates** in the xlsx are Excel serial numbers. `YYYY-MM-DD` = 1899-12-30 + the whole number of days (e.g. `46023` → `2026-01-01`).
2. **Empty rows** (no date and no type) are skipped. The sheet has ~800 rows but only a few dozen are filled.
3. **`externalRef`** = `ledger:Transactions:R<Excel row number>`, where the header is row 1 and the first transaction is `R2`. The local import uses exactly these keys, so entering again creates no duplicates.
4. **Legs by type** (table in section 5): `revenue` — `to` = (E, H); `expense` — `from` = (D, F); two-leg types — both. If a `revenue` row has only the left side (D, F) filled, or an `expense` only the right side (E, H), take the filled one. Do not enter zero amounts.
5. **The account currency wins.** If G or I differs from the account currency (e.g. `USD` on a `USDT` wallet), enter the amount as is in the account currency and note the row for the owner.
6. **Fiat rounding.** For USD, EUR and UAH accounts round amounts to 2 places: formulas like `1400.2/1.168` leave tails (`1198.80137` → `"1198.80"`). Do not round crypto.
7. **Negative amounts** in the columns are taken as absolute values: the leg sets the sign.

Sequence: `add_transactions` with `dryRun: true` → fix errors by `transactions.<i>` → the same batch without `dryRun` and with a new `idempotencyKey`. A rerun is safe: existing records come back as `duplicate`.

### 6.6 Reconciliation

After entering, call `get_balances` and compare each account's `balance` with the `Current Balance` column of the `Balances` sheet (tolerance 0.01; expect `0` for EUR because rounding removes the `0.00137` tail). Reference values for this file:

| Account            | Balance         |
| ------------------ | --------------- |
| Privat USD         | 9,522.01 USD    |
| Privat EUR         | 0 EUR           |
| Privat UAH         | 18,477.98 UAH   |
| Crypto ETH - USDT  | 1,203 USDT      |
| Crypto ETH - USDC  | 157.922092 USDC |
| Crypto TRON - USDT | 11,129.57 USDT  |

Treasury: the sum of balances in USD at the latest rates (`EUR × 1.168`, `UAH ÷ 43`) = **22,442.22 USD**.

Do not fix a mismatch yourself with adjusting transactions — describe it to the owner: account, expected, actual, suspicious rows.

## 7. PrivatBank statements

The owner hands you PrivatBank (Privat24 for business) statements, one per account (UAH, USD, EUR), and you book them into the Ledger. There is no importer in the UI: you are it. A statement is real financial data — the same handling as the xlsx in section 6.

### 7.1 Before starting

1. `get_balances`. Each account's `openingDate` is where Tally's accounting starts (A-063: `2026-09-01`); its `openingBalance` already holds everything before that day. **Enter only rows dated on or after the account's `openingDate`.** Never change `openingBalance` / `openingDate` unless the owner asks.
2. `list_transactions` for the account (`accountId`, `from` = the first statement date). Rows may already be there without a bank reference: entered by hand, or a payout recorded with **Pay** in Payroll. Match every statement row against rows **without** `externalRef` by account, date and amount. If one matches, do not add a second one: set its `externalRef` with `update_transactions` so that reruns recognise it. If it is unclear whether two rows are the same payment, ask.
3. `list_payees`, `list_clients`: you need them to link rows to people and clients (7.3).

### 7.2 One statement row → one transaction

| Statement                                     | Field                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Bank reference of the row (`Референс`)        | `externalRef` = `privat:<reference>`. No reference in the export → stop and ask the owner |
| Operation date                                | `occurredOn`                                                                              |
| Credit (money in)                             | `revenue` with `to` = (this account, amount)                                              |
| Debit (money out)                             | `expense` with `from` = (this account, amount)                                            |
| Payment purpose (`Призначення платежу`)       | `description`, verbatim                                                                   |
| Counterparty name                             | `counterparty`, verbatim                                                                  |
| Counterparty tax ID (ЄДРПОУ / ІПН) or account | finds the person or client: `personId` / `clientId` (7.3)                                 |

Amounts are absolute values with 2 decimal places, in the account currency. Exceptions to "one row, one transaction" — currency exchange, transfers and fees — are in 7.4.

### 7.3 Type, category and party

Default categories by what the row is. If the counterparty already appears in earlier transactions (`list_transactions`), keep its category; if the row fits nothing below, ask.

| Row                                                                                    | `type`        | `category`                | Party      |
| -------------------------------------------------------------------------------------- | ------------- | ------------------------- | ---------- |
| Payment from a client (SWIFT, invoice number in the purpose)                           | `revenue`     | `Client Revenue`          | `clientId` |
| Bank interest, refunds                                                                 | `revenue`     | `Interest / Other Income` | —          |
| Payment to a FOP of one of our people (contractor payout)                              | `expense`     | `Contractors`             | `personId` |
| Salary of an employee, e.g. the director («Зарплатня»)                                 | `expense`     | `Payroll`                 | `personId` |
| «ГУ ДПС», «УДКСУ», ЄСВ, ПДФО, military levy, single tax                                | `expense`     | `Taxes`                   | —          |
| Account service («Обслуговування поточних рахунків»), SWIFT and other bank commissions | `expense`     | `Bank Fees`               | —          |
| Accountant, lawyers                                                                    | `expense`     | `Legal / Accounting`      | —          |
| Sale or purchase of currency                                                           | `fx_exchange` | `FX Exchange`             | — (7.4)    |
| Between our own accounts in one currency                                               | `transfer`    | `Internal Transfer`       | — (7.4)    |

Finding the party: the counterparty tax ID is a payee's `taxId` in `list_payees`, and that payee's `personId` is the person. A payee can belong to another person than its name suggests (someone is paid through a relative's FOP) — trust `personId`, not the name. Clients are matched by name in `list_clients`. If nothing matches, leave the party empty and list the row in the report.

### 7.4 Rows that are not one transaction

- **Currency sale or purchase** shows up as two rows on two accounts: a debit on the USD (or EUR) account and a credit on the UAH account, sometimes a day apart and with different references. Book **one** `fx_exchange`: `from` = (USD account, debited amount), `to` = (UAH account, credited amount), `occurredOn` = date of the debit, `externalRef` = `privat:<debit reference>`, and put the credit reference in the description: `Exchange · credit ref <reference>`. Before booking any credit row, check that its reference is not already in such a description.
- **Between our own accounts** in one currency: likewise one `transfer` from the debit row, the credit reference in the description.
- **A bank fee for a specific payment** (SWIFT commission on a payout or an exchange, fee withheld from an incoming SWIFT): put it in `fee` of that transaction (`{ account, amount }`), not as a separate expense. If the statement shows an incoming payment as gross amount and withheld fee, book `to` = gross and `fee` = fee, so the invoice is closed by the full amount the client paid. If only the net amount is shown, book the net and mention it in the report. A monthly account-service charge is not tied to a payment — a separate `Bank Fees` expense.

Sequence: `add_transactions` with `dryRun: true` → fix `transactions.<i>` errors → the same batch without `dryRun` and with a new `idempotencyKey`. A rerun of the same statement only returns `duplicate`.

### 7.5 What a person finishes in the UI

The agent does not allocate money to documents. After booking, list for the owner:

- **Client payments** (`revenue`, `Client Revenue`) → the invoice card → «Allocate payment».
- **Payouts to people** (`Contractors` / `Payroll` with `personId`) → Payroll → «Pay» → «Existing Ledger transaction» (A-064). The picker shows unallocated `Contractors` / `Payroll` expenses in the payout currency dated from the first day of the payout month, so a payout booked under another category or before that month will not be offered — book payouts with the right category and date.

### 7.6 Reconciliation

For every account, call `get_balances` with `asOf` = the statement's last date: the closing balance of the statement must equal `balance` exactly. A person can do the same in the UI: Ledger → «Reconcile». On a mismatch do not add correcting rows: report the account, the statement balance, Tally's balance and the rows you suspect (missed, duplicated, a fee booked twice).

## 8. People and clients

### 8.1 People — `upsert_person_profile`

The Bench profile: who the person is, what they know, when they are free. Fields:

| Field                                                                      | Format                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `fullName`                                                                 | Full name; required for a new person                              |
| `displayName`, `position`, `location`, `timezone`, `contactOwner`, `notes` | Text                                                              |
| `seniority`, `stack`, `domains`                                            | String arrays: `["React", "Node"]`                                |
| `marketRateUsd`                                                            | Market rate, USD/h, decimal string                                |
| `allocation`                                                               | `full_time` or `part_time`                                        |
| `availabilityFrom`                                                         | `YYYY-MM-DD`                                                      |
| `status`                                                                   | `active`, `bench`, `inactive` (a new person defaults to `active`) |

- An existing person is matched by `id`, otherwise by `fullName` case-insensitively. If several people match, you get an error asking for the `id`.
- **Updates are partial:** only the fields sent change, the rest stays. An array (`stack` etc.) is replaced as a whole, so to add a skill send the full new list.
- Renaming needs the `id`: without it `fullName` is the lookup key and does not change.
- Check `search_people` before writing so you do not create a duplicate under another spelling. If unsure whether it is the same person, ask the owner.
- What the person is paid and which clients they work for is not entered here.

### 8.2 Clients — `upsert_clients`

| Field                             | Format                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `legalName`                       | Legal name; required for a new client                                          |
| `shortName`, `address`, `country` | Text                                                                           |
| `bankDetails`                     | The client's bank details for the invoice header, text                         |
| `contacts`                        | Array of `{ name, role?, email?, phone? }`; when sent, replaces the whole list |
| `defaultCurrency`                 | `USD`, `EUR`, … (a new client defaults to `USD`)                               |

Matching, partial updates and renaming work as for people, with `legalName` as the key. Contracts are written with `upsert_contracts` (8.8); billing rates are added by a person in the UI.

### 8.3 Crypto wallets — `upsert_wallets`, `find_wallets`

People and clients we settle with in crypto can have several wallets. They are how a crypto transaction in the Ledger is matched to its counterparty, so an address on a network belongs to exactly one owner and can never be one of our own account addresses.

| Field                    | Format                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `personId` or `clientId` | Exactly one; take the id from `search_people` / `list_clients`                                       |
| `network`                | `ETH`, `BSC`, `POLYGON`, `ARBITRUM`, `BASE`, `OPTIMISM`, `AVALANCHE`, `TRON`, `SOLANA`, `BTC`, `TON` |
| `address`                | As shown by the explorer; checked against the network format. EVM addresses are stored in lower case |
| `label`                  | Optional note, e.g. `Binance deposit`; omit to keep the stored one                                   |
| `isActive`               | `false` deactivates; wallets are never deleted so old transactions stay identifiable                 |

The same EVM address used on several EVM networks is entered once per network. Before booking a crypto transaction, call `find_wallets` with the counterparty address: `wallets[].owner` names the person or client, `ownAccounts` means it is a transfer between our own accounts.

### 8.4 Payees — `list_payees`, `upsert_payees`

A payee is the legal recipient of a payout: a Ukrainian sole trader (`fop`), a crypto wallet (`crypto`) or `other`. It is not always the same human as the person — someone can be paid through a relative's FOP.

| Field                            | Format                                                     |
| -------------------------------- | ---------------------------------------------------------- |
| `id` or `taxId`                  | Match key; without both a new payee is created             |
| `kind`                           | `fop` (default for new), `crypto`, `other`                 |
| `legalNameUa` / `legalNameEn`    | At least one; e.g. `ФОП Іваненко Іван Іванович`            |
| `taxId`                          | ІПН / ЄДРПОУ, 8–12 digits                                  |
| `edrRecord`, `edrDate`           | EDR record and its date `YYYY-MM-DD` (used in FOP acts)    |
| `addressUa`, `iban`, `bankName`  | Requisites for acts; IBAN may contain spaces               |
| `walletAddress`, `walletNetwork` | Payout wallet of a `crypto` payee (required for that kind) |
| `personId`                       | The person this payee pays; `null` unlinks                 |
| `makeDefault`                    | `true` makes it the person's default payee for new payouts |

### 8.5 Corrections — `update_transactions`

Send the transaction `id` and only what changes. Legs replace the stored ones (`{ account, amount }`, positive amount; `null` removes the leg, e.g. `fee: null`). When the type, accounts or amounts of a transaction that is already allocated to an invoice or payout change, add a `reason` — it goes to the audit log — and the allocations must still fit the new amount. Use it also to link historical rows to people or clients (`personId` / `clientId`) once you recognise them in the description.

### 8.6 Trips — `upsert_trips`, `add_trip_expenses`

A trip (6.8) has dates, a place and participants (people from `search_people`). Its expenses are what each participant spent; the company returns what a person paid and marked as reimbursable. Status is derived: before the dates `planned`, during `in_progress`, after them `awaiting_reimbursement` until everything reimbursable is returned, then `settled`.

1. `list_trips` — do not create a trip that already exists. Otherwise `upsert_trips` with `title`, `startsOn`, `endsOn`, `location`, `participantIds`.
2. `add_trip_expenses` per trip, one item per receipt or card row:
   - `spentOn`, `description` (as on the receipt), `amount` and `currency` as paid (EUR stays EUR);
   - `fxRate` only when the owner gives the real rate (e.g. the card statement's UAH amount ÷ the EUR amount); otherwise leave it out and the NBU rate of that day is used;
   - **who paid:** the participant's own card → `paidBy: "person"`, `reimbursable: true` unless the owner says the company does not return it; the company's card or account → `paidBy: "company"` with `transactionId` of the Ledger expense (category `Travel / Conf.`, see section 7) — company-paid expenses are never reimbursed;
   - the same date + amount + description already in another trip is refused: it is usually the same receipt pasted twice. Use `allowDuplicate: true` only when the owner confirms they are different.
   - `receipt` `{fileName, mimeType, contentBase64}` attaches the receipt photo or PDF to the expense (it lands in the trip's `receipts` folder); all receipts of one call together up to 3 MB, so send receipts in small batches.
3. Reimbursements (through the monthly payout, an extra FOP act or a direct payment) are done by a person in the UI: Trips → the trip.

### 8.7 Documents — `search_documents`, `get_document`, `add_documents`, `link_documents`

The registry (6.9) holds contracts, SOWs, annexes, NDAs, CVs, invoices, acts, statements, receipts and other files. A document may be linked to any number of records — `person`, `payee`, `client`, `contract`, `assignment`, `invoice`, `supplier_act`, `trip`, `transaction` — or to none.

1. **Look first.** `search_documents` with `q` (number or title) or `linkedTo` — do not upload what is already there; a newer copy of an existing document is a new version (`supersedesId`), not a second document.
2. **Find the records.** Ids come from `find_link_targets` (any type), or `search_people`, `list_clients`, `list_payees`, `list_trips`, `list_transactions`. A link to a record that does not exist is an error.
3. **Add.** `add_documents` with `type`, `title`, `number` and `docDate` as printed on the document, and either `file` `{fileName, mimeType, contentBase64}` or `url` (e.g. a Vchasno link; Tally never downloads it). Put the main record first in `links`: it picks the Drive folder (person → `people/…`, client or contract → `clients/…`, payee → `payees/…`, trip → `trips/…`). Files are limited to 3 MB per call — send several documents in separate calls, and ask the owner to upload anything larger in the UI. Run `dryRun: true` first: it shows the folder and the link labels without uploading.
4. **Read.** `get_document` with `includeContent: true` returns the file as base64 to read a PDF or a scan; `viewUrl` opens it in Drive.
5. **Correct.** `update_documents` changes only the fields sent. A real document that was cancelled gets `status: "void"` and stays in the registry. Invoice and act files that Tally generated, and their signed copies, belong to the invoice/act and are read-only here.
6. **Links.** `link_documents` attaches existing documents; `unlink_documents` detaches them — only when the owner asks, after `dryRun`.
7. **Delete.** `delete_documents` is only for files uploaded by mistake (wrong file, test uploads, duplicates) and only when the owner asks (A-072). Run `dryRun: true`, show the owner the titles, link counts and `file` of each, then repeat without it. The row and its links are removed; a newer version moves down to the nearest surviving predecessor; the file goes to the Drive trash (restorable there for 30 days) unless another document uses it (`kept_shared`). `trash_failed` means the row is gone but the file is still on Drive — tell the owner. Tally's own invoice/act files and signed copies cannot be deleted.

### 8.8 Contracts and SOWs — `upsert_contracts`, `upsert_contract_annexes`

A contract is either with a client (`kind: "client"`, `clientId`) or with a payee's FOP (`kind: "fop"`, `payeeId`) — exactly one counterparty. A SOW or annex lives inside its contract; people are assigned to a contract and, optionally, to one of its SOWs (A-072).

1. **Look first.** `list_contracts` with `clientId`/`payeeId` or `q`, then `get_contract` for SOWs and assignments. Contract and SOW PDFs are usually already in the registry: find them with `search_documents` (`type: "contract" | "sow" | "annex"`) and pass their ids in `documentIds` — never upload a file again.
2. **Contract.** `upsert_contracts` matches by `id`, else by `number` (case-insensitive) plus the `clientId`/`payeeId` sent; the number is the lookup key, so renaming needs the `id`. A new contract needs `kind`, `number` and the counterparty.

| Field             | Format                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signedOn`        | `YYYY-MM-DD` as printed on the contract                                                                                                               |
| `currency`        | Invoice currency, `USD` by default                                                                                                                    |
| `status`          | `active` or `ended`                                                                                                                                   |
| `paymentDueRule`  | `{type: "day_of_month", day}` · `{type: "net_days", days}` (calendar days) · `{type: "net_working_days", days}` (working days after the invoice date) |
| `invoiceDateRule` | `{type: "first_working_day_after_period"}` · `{type: "nth_working_day_after_period", n}`                                                              |
| `actDateRule`     | FOP acts: `last_working_day_of_period`, `nth_working_day_after_period` with `n`, or `manual`                                                          |

"15 working days after receipt of the invoice" (IdeaSoft) is `{type: "net_working_days", days: 15}`: Tally counts from the invoice date, since invoices are sent the day they are issued.

3. **SOW / annex.** `upsert_contract_annexes` with `contractId`, `kind` (`sow` or `annex`), `number` as printed, `title`, `signedOn`, `validFrom`/`validTo`, `status` (`draft`, `active`, `ended`) and `documentIds`. Set `paymentDueRule` or `invoiceDateRule` only when the SOW itself changes them — the SOW then gets an invoice of its own at period close; `null` returns to the contract's rules. Keep the returned `id`: assignments will point to it.
4. **Link later.** A document found afterwards is attached with `link_documents` and `entityType: "contract_annex"` (or `contract`); `find_link_targets` searches SOWs by number, title, contract number or client.

### 8.9 Assignments — `list_assignments`, `upsert_assignments`

An assignment is one person on one client contract (and optionally one of its SOWs), with two independent versioned terms: `billing` — what the client is charged — and `pay` — what the person gets (A-073). Internal work (CEO/CTO on our own company) is `isInternal: true` with no contract and `billing.type: "none"`.

1. **Look first.** `list_assignments` with `personId`, `contractId`, `annexId` or `activeOn`. The same person on the same contract with another rate, role or SOW is a separate assignment.
2. **Create.** `personId`, `contractId` (a client contract), `annexId` (a SOW of that contract, from `upsert_contract_annexes`), `roleTitle`, `fte` (`"0.5"`), `startsOn`, `endsOn` if known, and both `billing` and `pay`:

| Block     | Fields                                                                                                                                                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billing` | `type` `hourly` (rate per hour) · `fixed_monthly` (rate per month, `prorationPolicy` `full_month` · `by_hours` · `trunc_hourly`) · `none`; `currency` = the contract currency; `invoiceChannel` `fiat` · `crypto`                                                                            |
| `pay`     | `type` `fixed` (monthly amount, already multiplied by FTE) · `hourly` (monthly amount for the full norm H) · `hourly_rate` (`amount` per hour × the person's hours) · `included`; `payoutMethod` `fiat` · `crypto`; `releasePolicy` `on_payment_or_due` (default) · `immediate`; `graceDays` |

Without `validFrom` the first versions start in the start month — or in the first open month when that one is already closed (closed months never change, I10). 3. **Change terms.** Send `id` and `billing`/`pay` with `validFrom` = the first day of the month the new terms start. Versions are never edited: the same month with other values is an error; a repeated identical version comes back as `existing`. Person, contract and `isInternal` cannot change — end the assignment (`endsOn`) and create a new one. 4. **Then hours.** Once assignments have terms, the month's hours are entered in Periods (UI).

## 9. Report to the owner

At the end, report briefly:

- how many were created and how many `duplicate`, per tool;
- the reconciliation table;
- for statements: rows left without a party, and the payments and payouts waiting for allocation in the UI (7.5);
- rows with currency mismatches and roundings;
- everything skipped, with the reason.

## 10. Do not

- Do not invent amounts, dates or rates. Do not “fit” a balance with adjustments without the owner's explicit permission.
- Do not create accounts, categories, people or clients “just in case” — only those in the source or named by the owner.
- Do not log or store the token; do not commit the xlsx or exports from it.
