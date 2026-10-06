# Clients, contracts, projects: how Tally models them

A guide for an agent that enters clients, people and their project work into Tally. Technical connection and tools: `docs/mcp-agent-guide.md`. The rules behind it: spec sections 3, 5.1–5.3, 6.3–6.4; decisions A-054…A-057 in `docs/assumptions.md`. UI labels below are the English UI (the default language).

## 1. The model in one paragraph

There is **one company of ours** (ТОВ «СІНТОРА» / LLC “SYNTORA”). It has **contracts**: with **clients** (MSA / Contract) and with **FOPs** (payout recipients). The core is the **assignment**: “person × client contract” with a role, SOW/Annex, FTE and dates. Each assignment has two independent **terms versions**: what we charge the client (`billing_terms`) and what we pay the person (`pay_terms`). Every month (**period**) the assignment gets **hours** and, when needed, a **“which project” note**. From this the system produces invoices and payouts itself.

```
Company ─┬─ Client contract (MSA No. …) ── Client
         │        └─ Assignment: person, role, SOW/Annex, FTE, dates
         │              ├─ Client terms (versions from a month)
         │              ├─ Person terms (versions from a month)
         │              └─ Monthly timesheet: hours + “project” note
         └─ FOP contract (OD-…) ── Payee ← who is actually paid
```

## 2. Entities

| Entity              | What it is                                                                                                                                                                                             | How it is entered                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **Company**         | Our legal entity: EN/UA details, director, bank. One for the whole system, used by every contract                                                                                                      | Settings → Company details (owner only)                                                         |
| **Client**          | Counterparty we invoice: legal name, short name, address, country, bank details, contacts, default currency                                                                                            | MCP `upsert_clients` or UI “Clients”                                                            |
| **Client contract** | MSA / Contract with a number and date. Sets the currency, invoice date rule, payment term, template and numbering. **One invoice = one contract × month** (a SOW with its own date rules gets its own) | MCP `upsert_contracts` or UI: client card → “New contract”                                      |
| **Person**          | Specialist: position, seniority, stack, domains, market rate, availability, location, status                                                                                                           | MCP `upsert_person_profile` or UI “People”                                                      |
| **Payee**           | Who legally receives the money: a FOP (name, tax ID, IBAN) or a crypto wallet. **May differ from the person who works**: the CTO's pay goes to another person's FOP                                    | UI only, owner only: “People → Payees”                                                          |
| **FOP contract**    | Contract with a FOP payee (`OD-1002` etc.); a monthly act is issued under it                                                                                                                           | MCP `upsert_contracts` or UI: payee card → “New contract”                                       |
| **SOW / Annex**     | A SOW or annex inside a contract: number, title, dates, status, its PDF; may replace the contract's payment term or invoice date                                                                       | MCP `upsert_contract_annexes`                                                                   |
| **Assignment**      | A person on a client contract: contract, SOW/Annex, role, FTE (0 < FTE ≤ 1), start, end. Or internal (CEO/CTO on our own company) — no contract, no billing                                            | MCP `upsert_assignments` or UI: person card → “New assignment”                                  |
| **Client terms**    | Type `hourly` / `fixed_monthly` / `none`, rate, currency = the contract's, invoice channel (fiat / crypto), partial-month policy                                                                       | With the assignment; a new month = a new version (MCP `upsert_assignments` or UI “Add version”) |
| **Person terms**    | Type `fixed` / `hourly` / `hourly_rate` / `included`, amount, currency USD or UAH (crypto only USD), payout method (fiat / crypto), when it can be paid, extra days                                    | With the assignment; a new month = a new version (MCP `upsert_assignments` or UI “Add version”) |
| **Agency fee**      | When an agency placed the person: the agency's payee, USD per hour the person works, payout method. Rate 0 from a month ends it                                                                        | Assignment page → “Agency fee” (UI only)                                                        |
| **Period**          | Calendar month: hours norm, reference rate, status `open` / `closed`                                                                                                                                   | UI “Periods”                                                                                    |
| **Timesheet**       | Hours per assignment × month: billed to the client and, when different, paid to the person; + a “project” note                                                                                         | UI “Periods” → step 2 (form or CSV)                                                             |

Over MCP the agent writes **clients, people, contracts, SOWs/annexes and assignments with their terms** (and the Ledger, payees, documents). Agency fees, periods and hours are entered by a person in the UI (section 6).

## 3. The main rule: separate record or a note

| Situation                                                                                              | How to record it                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new client                                                                                           | A new **client**                                                                                                                                                                               |
| A separate legal agreement with a client (own number, date, payment terms)                             | A new **contract**                                                                                                                                                                             |
| An SOW / Annex / Statement of Work under an existing MSA                                               | **Not** a new contract: a **SOW/annex** inside it (`upsert_contract_annexes`); the assignment points to it                                                                                     |
| A person starts working for a client                                                                   | A new **assignment** on that client's contract                                                                                                                                                 |
| The same person on the same contract, but **a different rate, pay type, role or SOW/Annex**            | A separate **assignment** — each has its own terms and its own invoice line                                                                                                                    |
| The same person, the same SOW and the same terms, but **several projects** (e.g. Boosty under one SOW) | **One** assignment. The project is written every month in the **timesheet note** (“Project / note”). If the person worked on several projects that month, list them: “Mobile app, Admin panel” |
| A person on two clients in parallel                                                                    | Two assignments, one per contract, with FTE shares (e.g. 0.5 + 0.5)                                                                                                                            |
| The rate changed from some month                                                                       | A **new terms version** from the first day of that month. Old versions are never edited by agents (owners may correct a version of an open month in the UI, A-077)                             |
| A person stopped working for a client                                                                  | The assignment's “End” date. Do not delete                                                                                                                                                     |
| CEO/CTO works for our own company                                                                      | An internal assignment, no contract, no billing                                                                                                                                                |

The “project” note is internal. It does **not** appear on the client invoice — the owner's decision (A-057).

## 4. How the money works

**Client invoice** (5.1). One per contract × month (a SOW with its own payment term or invoice date gets a separate one, A-072), a line per assignment with hours > 0. H is the month's hours norm, h the hours worked:

| Client terms                                                       | Line amount                |
| ------------------------------------------------------------------ | -------------------------- |
| `hourly`                                                           | rate × h                   |
| `fixed_monthly` + “Full amount regardless of hours” (`full_month`) | rate, regardless of hours  |
| `fixed_monthly` + “Proportional to hours” (`by_hours`)             | rate / H × h               |
| `fixed_monthly` + “Whole hourly rate” (`trunc_hourly`)             | floor(rate / H) × h        |
| `none` (“Not billed”)                                              | no line (internal, unpaid) |

**Person's pay** (5.2):

| Person terms                                | Accrual                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `fixed` (“Fixed amount”)                    | the monthly amount. **Already includes FTE**: for half-time enter half, not the full amount |
| `hourly` (“Hourly from the monthly amount”) | amount / H × h                                                                              |
| `hourly_rate` (“Rate per hour”)             | amount × h — the amount is the person's rate per hour                                       |
| `included` (“Included (0)”)                 | 0 (paid inside another assignment)                                                          |

Here h is the **person's hours** of the month. They default to the hours billed to the client; in Periods step 2 a different figure can be entered for the person (A-074) — e.g. 160 billed and 172 paid. The agency fee uses the person's hours too.

All of a person's assignments in a month roll into **one payout** per method (fiat and crypto separately). The recipient is the default payee from the person card.

**Agency fee** (A-068): if an agency placed the person (e.g. RedJumpers gets 4 USD for every hour Andrii works), the assignment has agency terms. Each month the agency gets **its own payout** = rate × hours, with its own FOP act; it waits for the client exactly like the person's pay. It is not part of the person's pay and not on the invoice.

**When it can be paid** (5.3): by default “After client payment or at the deadline” (`on_payment_or_due`) — when the client has paid the invoice in full or its due date has come (then the company pays), whichever is first. “Immediately” (`immediate`) — right after the month is closed.

**A closed month** is frozen: hours, notes and terms do not change retroactively. They can change only after the owner reopens the period.

## 5. Order of entering new work

1. **Client.** `list_clients` → if missing, `upsert_clients` (`legalName` required; `shortName`, `country`, `defaultCurrency`, `contacts`, `bankDetails` for the invoice header).
2. **Client contract** — `list_contracts` → if missing, `upsert_contracts`: number, signing date, currency, payment term (`day_of_month` N, `net_days` N or `net_working_days` N), invoice date (first / Nth working day after the month), and `documentIds` of the contract PDF already in the registry.
3. **SOW / Annex** — `upsert_contract_annexes` under that contract with its PDF in `documentIds`; keep the returned `id` for the assignment.
4. **Person.** `search_people` → if missing, `upsert_person_profile` (`fullName` required + profile). Watch for other spellings of the name.
5. **Payee and FOP contract** — the owner in the UI, if the person is paid through a FOP that does not exist yet. The agent neither enters nor asks for payee details.
6. **Assignment** — `list_assignments` → if missing, `upsert_assignments`: person, contract, `annexId` of the SOW, role, FTE, start and the first `billing` (client) and `pay` (person) terms. A rate change from a later month is a new version (`validFrom`); a version is never edited.
7. **Every month** — a person in the UI: “Periods” → month → step 2. Hours and, if needed, “Project / note”. Then calculation and close.

## 6. What the agent hands to a person for UI steps

Contracts, SOWs and assignments with their terms are written by the agent itself (section 5). Left for a person in the UI, per assignment when the source has it:

```
Assignment: <person · contract · SOW>
Agency: <none | agency payee name, N USD per hour, payout fiat|crypto>
Projects under this SOW (for timesheet notes): <Mobile app, Admin panel, …>
```

If any of this is missing from the source, do not invent it. Write “to clarify” and ask the owner.

## 7. Checks before reporting

- No duplicate clients or people under another spelling (`list_clients`, `search_people`).
- Every SOW under an MSA is a SOW/annex of that contract (`upsert_contract_annexes`), not a separate contract, and its assignments carry its `annexId`.
- A person's total FTE on a date is realistic: usually ≤ 1. More only deliberately, with an explanation.
- `fixed` pay for part-time is already multiplied by FTE.
- Different projects with the same terms under one SOW are timesheet notes, not separate assignments.
