# Tally — технічна специфікація v1

Sep 29, 2026 · @Vladyslav

## 1. Мета, принципи, ухвалені рішення

Tally (кодова назва внутрішньої back-office системи) замінює п'ять Google-таблиць Syntora.Tech одним веб-додатком з БД: фінанси (Ledger), розрахунок інвойсів клієнтам і виплат спеціалістам, генерація інвойсів та актів ФОП, пул спеціалістів (Bench) з CV, відрядження з компенсаціями та реєстр документів. Користувачі v1 — власники компанії (2 людини); спеціалісти не логіняться, але модель прав це допускає.

**Для агента-виконавця.** Цей документ — джерело правди. Якщо рішення тут суперечить «звичній практиці», діє документ. Якщо чогось бракує, бери припущення з розділу 12 і фіксуй нове припущення там само, а не вигадуй мовчки. Розділи 4–5 нормативні (MUST), розділ 6 — функціональні вимоги з критеріями приймання, розділ 11 — порядок робіт.

### Принципи (MUST)

1. **Розрахунок ≠ документ.** Розрахунки за період детерміновані й відтворювані. Випущений документ (інвойс, акт) — незмінний знімок з номером; зміна можлива лише через анулювання й перевипуск.
2. **Гроші ніколи не float.** У БД `numeric(20,8)` для сум, `numeric(18,6)` для курсів. У TS — `string` на межі з БД і `decimal.js` у розрахунках. `supabase-js` для фінансових даних не використовується.
3. **Інваріанти живуть у БД** (тригери, constraints, RLS), бізнес-розрахунки — у чистих TS-функціях, покритих тестами на реальних даних.
4. **Усе, що має дату дії, версіонується** (`valid_from`): ставки клієнту, умови оплати людині.
5. **Жодних прихованих коригувань.** Будь-яка ручна зміна суми — окремий запис `adjustment` з обов'язковою причиною. Audit log на всіх фінансових таблицях.
6. **Курс — знімок у конкретній дії** з джерелом (`bank_actual | nbu | manual`), а не глобальне значення.

### Журнал рішень

| # | Рішення | Обґрунтування |
| --- | --- | --- |
| D1 | Next.js (App Router) + TypeScript, моноліт, хостинг Vercel | 1–5 користувачів, мікросервіси зайві |
| D2 | Supabase: Postgres, Auth (Google OAuth), RLS, pg\_cron | Інваріанти й права на рівні БД; безкоштовний старт |
| D3 | ORM — Drizzle (не Prisma), `numeric` у режимі `string` | Нормально працює з pooler Supabase, описує RLS-політики в схемі |
| D4 | Файли — Google Shared Drive, шаблони — Google Docs, PDF через Docs/Drive API | Service account не має квоти в My Drive; LibreOffice не працює у Vercel Functions |
| D5 | Старт на безкоштовних тарифах (Vercel Hobby, Supabase Free) | Розробка й тестові дані. Реальні фінансові дані — лише після переходу Vercel на Pro (див. 2.3) |
| D6 | Local-first розробка: `supabase start` + `pnpm dev` | Повний стек у Docker, реальні дані можна тримати лише локально |
| D7 | Pay-when-paid: ЗП за місяць N виплачується після оплати інвойсу клієнтом; якщо клієнт прострочив — компанія платить зі своїх у дедлайн | Рішення власника, 2026-09-29 |
| D8 | Курс USD→UAH фіксується в момент дії, підставляється автоматично, завжди редагований | Реальний курс дає банк у день операції |
| D9 | Дати документів — лише робочі дні; дефолт: акт — останній робочий день місяця, інвойс — перший робочий день наступного; ручна зміна перед випуском | Рішення власника, 2026-09-29 |
| D10 | Номер документа видається в момент випуску, не в чернетці | Без дірок і дублікатів у нумерації |
| D11 | MCP-сервер `/api/mcp` для AI-агентів: OAuth 2.1 через Supabase Auth, агент читає й вносить низькоризикові дані, грошові зміни лише пропонує (розділ 13) | Вимога власника, 2026-09-29 |

## 2. Архітектура, стек, середовища

Один Next.js-додаток на Vercel ходить у Supabase Postgres через Drizzle з сервера, а документи генерує й зберігає в Google Shared Drive. Браузер ніколи не читає фінансові дані напряму з Supabase: `supabase-js` у клієнті лише для сесії.

&#91;embedded content: архітектура · 6 компонентів\]

Суцільні стрілки — виклики з Next.js; пунктир — pg\_cron сам будить додаток через `/api/cron/*`. Бекап йде повз Next.js: GitHub Actions читає БД напряму і кладе зашифрований дамп на Drive.

### 2.1 Стек

| Шар | Технологія | Примітки |
| --- | --- | --- |
| UI | Next.js App Router, React Server Components, Server Actions, Tailwind + shadcn/ui, TanStack Table | Інтерфейс двомовний: англійська за замовчуванням, українська — перемикачем (A-058, див. 12) |
| Валідація | Zod на кожній Server Action | Схеми спільні для форм і сервера |
| Домен | `packages/domain`: чисті функції розрахунків, `decimal.js` | Без доступу до БД і мережі, 100% юніт-тести |
| БД | Supabase Postgres 15+, розширення `pg_cron`, `pg_net` | Інваріанти, RLS, audit (розділ 4) |
| ORM / міграції | Drizzle ORM + drizzle-kit → SQL у `supabase/migrations` | Тригери й функції — ручні SQL-міграції |
| Auth | Supabase Auth, Google OAuth, whitelist email-ів | Ролі в таблиці `app_user`, не в JWT |
| Файли | Google Shared Drive, service account (Content manager) | `supportsAllDrives=true` у всіх викликах |
| Документи | Google Docs API (copy → replace → export PDF) | Розділ 7 |
| Фонові задачі | `pg_cron` у БД + таблиця `job` | Курс НБУ, прострочки, довга генерація |
| Тести | Vitest (домен), pgTAP або SQL-тести (тригери, RLS), Playwright (e2e) | Розділ 9 |
| Пакетний менеджер | pnpm workspaces | Версії — останні стабільні на момент ініціалізації, зафіксовані в lockfile |

### 2.2 Середовища

| Середовище | Де | Дані | Drive |
| --- | --- | --- | --- |
| local | Mac, Docker (`supabase start`), `pnpm dev` | Імпорт з xlsx, включно з реальними | Папка `_dev` або `STORAGE_DRIVER=local` |
| preview | Vercel Hobby + Supabase Free (окремий проєкт) | Лише тестові та знеособлені | Папка `_preview` |
| production | Vercel Pro + Supabase Free → Pro, https://tally.syntora.tech | Реальні | Корінь Shared Drive |

### 2.3 Обмеження тарифів, які впливають на реалізацію

- **Vercel Hobby** — лише для особистого некомерційного використання, і контент Hobby-проєктів Vercel може використовувати для тренування AI ([Terms](https://vercel.com/legal/terms)). Тому реальні дані на Hobby не завантажуються; перехід на Pro ($20/міс) — умова запуску production.
- **Supabase Free** — проєкт ставиться на паузу після 7 днів без активності, автоматичних бекапів немає ([pricing](https://supabase.com/pricing)). Звідси: щоденний `pg_cron` (курс НБУ) тримає проєкт активним, а бекап — власний `pg_dump` (розділ 10). Перехід на Pro ($25/міс) — коли в системі з'явиться рік реальних даних.
- **Vercel Functions** мають ліміт тривалості. Генерація одного документа йде синхронно; пакетна (усі акти періоду) — через таблицю `job` з обробкою по одному документу за виклик.
- **Supabase pooler** (transaction mode) — Drizzle підключається з `prepare: false`; міграції — через direct connection.

## 3. Доменна модель

Центр моделі — **assignment**: один рядок нинішньої таблиці `Current` (спеціаліст × контракт/SOW) з двома незалежними наборами умов: скільки беремо з клієнта (`billing_terms`) і скільки платимо людині (`pay_terms`). Години за період породжують рядок інвойсу та рядок ЗП, які зв'язані між собою через `funded_by`.

```mermaid
erDiagram
  PERSON ||--o{ ASSIGNMENT : "works on"
  PERSON }o--o| PAYEE : "default payee"
  COMPANY ||--o{ CONTRACT : "our side"
  CLIENT ||--o{ CONTRACT : "client contract"
  PAYEE ||--o{ CONTRACT : "FOP contract"
  CONTRACT ||--o{ ASSIGNMENT : "SOW / Annex"
  ASSIGNMENT ||--o{ BILLING_TERMS : "versions"
  ASSIGNMENT ||--o{ PAY_TERMS : "versions"
  PERIOD ||--o{ TIMESHEET : ""
  ASSIGNMENT ||--o{ TIMESHEET : "hours"
  CLIENT ||--o{ INVOICE : ""
  INVOICE ||--|{ INVOICE_LINE : ""
  TIMESHEET ||--o| INVOICE_LINE : "billed"
  PERIOD ||--o{ PAYROLL_ITEM : ""
  PAYEE ||--o{ PAYROLL_ITEM : "paid to"
  PAYROLL_ITEM ||--|{ PAYROLL_LINE : ""
  TIMESHEET ||--o| PAYROLL_LINE : "accrued"
  PAYROLL_LINE }o--o| INVOICE_LINE : "funded_by"
  PAYROLL_ITEM ||--o{ ADJUSTMENT : ""
  PAYROLL_ITEM ||--o{ SUPPLIER_ACT : ""
  ACCOUNT ||--o{ POSTING : ""
  TRANSACTION ||--|{ POSTING : ""
  TRANSACTION ||--o{ ALLOCATION : "settles"
  ALLOCATION }o--o| INVOICE : ""
  ALLOCATION }o--o| PAYROLL_ITEM : ""
  ALLOCATION }o--o| REIMBURSEMENT : ""
  TRIP ||--|{ TRIP_EXPENSE : ""
  TRIP ||--o{ REIMBURSEMENT : ""
  REIMBURSEMENT |o--o| ADJUSTMENT : "via act"
  DOCUMENT ||--o{ DOCUMENT_LINK : "any entity"
```

### Ключові сутності

| Сутність | Що це | Звідки в поточних таблицях |
| --- | --- | --- |
| `company` | Наша юрособа (ТОВ «СІНТОРА»): реквізити, директор, IBAN, адреса EN/UA | Шапки інвойсів і актів |
| `person` | Спеціаліст з пулу: позиція, сеньйорність, стек, домен, ринкова ставка, доступність, локація/TZ, контактна особа | `Bench`, колонка `Employee` |
| `payee` | Юридичний одержувач виплати: ФОП (ПІБ, ІПН, запис ЄДР, IBAN) або криптогаманець. **Не завжди та сама людина, що й `person`** | `Реестр актов`, аркуші `Акт *` |
| `client` | Клієнт/партнер: юр. назва, адреса, банківські реквізити, контакти | Шапки аркушів `SOW #*`, `Switzerland`, `IdeaSoft` |
| `contract` | Договір (MSA, Contract, договір з ФОП) з номером, датою, валютою, правилами дат і оплати, шаблоном документа та послідовністю номерів | `MSA №20-08/25`, `No 2025-28/10`, `№ OD-1001` |
| `assignment` | Спеціаліст на контракті: роль, FTE, SOW/Annex, дати, `is_internal` (CEO/CTO на власній компанії) | Рядок `Current` |
| `billing_terms` | Версія умов клієнту: `fixed_monthly / hourly / none`, ставка, валюта, `proration_policy`, канал (fiat/crypto) | Колонки H, I, L |
| `pay_terms` | Версія умов людині: `fixed / hourly / included`, сума, валюта, спосіб виплати, `release_policy` | Колонки M, N, R |
| `period` | Місяць: норма годин, статус `open / closed`, довідковий курс для звітності | `General_Data`, аркуші місяців |
| `timesheet` | Години за assignment × period | Колонка F |
| `invoice`, `invoice_line` | Інвойс клієнту та його рядки; після випуску — знімок | `SOW #*`, колонка K |
| `payroll_item`, `payroll_line` | Виплата одержувачу за період та її частини по assignments | Колонки O, P, T |
| `adjustment` | Бонус, утримання, компенсація, корекція — завжди з причиною | `+3325`, `-8779.3`, `2000 + 20` у формулах |
| `supplier_act` | Акт ФОП: номер, дата, період, сума UAH, тип `monthly / reimbursement / other` | `Реестр актов` |
| `account`, `transaction`, `posting`, `category` | Рахунки (банк/крипто), операції та їхні проводки по рахунках | `Syntora_Ledger` |
| `allocation` | Зв'язок платежу з тим, що він закриває (інвойс, виплата, компенсація) | Немає (зараз у голові) |
| `fx_rate` | Довідкові курси (НБУ та ручні) для підказок | `FX_Rates`, `Курс 1USD`, курси в поїздках |
| `trip`, `trip_expense`, `reimbursement` | Відрядження, витрати з прапорцем компенсації, фактичні компенсації | `Business_trips` |
| `document`, `document_link` | Реєстр документів і їх прив'язка до будь-якої сутності (або до жодної) | Посилання в `Based on`, `CV`, `Invoice` |
| `number_sequence`, `work_calendar_exception`, `audit_log`, `app_user`, `job` | Службові | — |

**Чому `payee` окремо від `person`.** У липні сума Владислава (CTO) 93 174.60 UAH збігається з актом `1002 - А8` ФОП Езерович Д. М. від 31.07, тобто одержувач — інша особа. `person.default_payee_id` задає дефолт, а `payroll_item.payee_id` — факт.

## 4. Схема БД і інваріанти

Нижче — нормативний скелет таблиць. Агент переносить його в Drizzle-схему без зміни семантики; додавати поля можна, прибирати — лише через запис у розділ 12. У кожній таблиці також є `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`, `created_by uuid`.

### 4.1 Enum-и

```sql
create type billing_type        as enum ('fixed_monthly','hourly','none');
create type proration_policy    as enum ('full_month','by_hours','trunc_hourly');
create type pay_type            as enum ('fixed','hourly','included');
create type release_policy      as enum ('immediate','on_payment_or_due');
create type payout_method       as enum ('fiat','crypto');
create type period_status       as enum ('open','closed');
create type invoice_status      as enum ('draft','issued','partially_paid','paid','void','written_off');
create type payroll_item_status as enum ('draft','partially_payable','payable','partially_paid','paid');
create type payroll_line_status as enum ('accrued','awaiting_client','payable','paid');
create type funding_source      as enum ('client','company');
create type act_type            as enum ('monthly','reimbursement','other');
create type doc_status          as enum ('draft','issued','void');
create type fx_source           as enum ('bank_actual','nbu','manual');
create type tx_type             as enum ('revenue','expense','transfer','fx_exchange','crypto_buy','crypto_sell','crypto_swap','adjustment');
create type account_kind        as enum ('bank','crypto','cash');
create type adjustment_kind     as enum ('bonus','deduction','trip_reimbursement','correction','other');
create type app_role            as enum ('owner','finance','viewer');
```

### 4.2 Таблиці

```sql
-- Довідники
company(name_en, name_ua, legal_code, address_en, address_ua, director_ua, director_en,
        bank_details_en text, bank_details_ua text)
person(full_name, display_name, position, seniority text[], stack text[], domains text[],
       market_rate_usd numeric(20,8), allocation text check in ('full_time','part_time'),
       availability_from date, location, timezone, contact_owner, status text check in ('active','bench','inactive'),
       default_payee_id -> payee null, notes)
payee(kind text check in ('fop','crypto','other'), legal_name_ua, legal_name_en, tax_id, edr_record, edr_date date,
      address_ua, iban, bank_name, wallet_address, wallet_network, person_id -> person null)
client(legal_name, short_name, address, country, bank_details text, contacts jsonb,
       default_currency char(3|4))
contract(kind text check in ('client','fop'), number, signed_on date, company_id -> company,
         client_id -> client null, payee_id -> payee null,          -- рівно одне з двох (I9)
         currency, payment_due_rule jsonb, invoice_date_rule jsonb, act_date_rule jsonb,
         invoice_template_file_id, act_template_file_id, number_sequence_key -> number_sequence null, status)

-- Залучення і умови (версіоновані)
assignment(person_id, contract_id null, is_internal bool, sow_ref text, role_title, fte numeric(4,2),
           starts_on date, ends_on date null)     -- check: is_internal or contract_id is not null
billing_terms(assignment_id, valid_from date, type billing_type, rate numeric(20,8), currency,
              proration_policy, invoice_channel payout_method, unique(assignment_id, valid_from))
pay_terms(assignment_id, valid_from date, type pay_type, amount numeric(20,8), currency default 'USD',
          payout_method, release_policy default 'on_payment_or_due', grace_days int default 0,
          unique(assignment_id, valid_from))

-- Періоди і години
period(month date unique /* перше число */, work_hours numeric(6,2), status period_status,
       reference_fx_usd_uah numeric(18,6) null, closed_at, closed_by)
timesheet(assignment_id, period_id, hours numeric(6,2), source text check in ('manual','import'),
          unique(assignment_id, period_id))

-- Білінг
invoice(client_id, contract_id, period_id null, number text null, status invoice_status,
        issue_date date, due_date date, currency, total numeric(20,8), paid_amount numeric(20,8) default 0,
        snapshot jsonb, gdoc_file_id, pdf_file_id, date_override_reason null, void_reason null)
invoice_line(invoice_id, timesheet_id null unique, position int, description_en, description_ua,
             quantity numeric(10,2), unit_price numeric(20,8), amount numeric(20,8))

-- Виплати
payroll_item(period_id, person_id, payee_id, status payroll_item_status,
             total_usd numeric(20,8), payout_fx_rate numeric(18,6) null, fx_source null, fx_set_by, fx_set_at,
             total_uah numeric(20,2) null, unique(period_id, person_id, payee_id))
payroll_line(payroll_item_id, assignment_id, timesheet_id unique, amount_usd numeric(20,8),
             funded_by_invoice_line_id -> invoice_line null, funding_source null, status payroll_line_status,
             payable_at timestamptz null, override_reason null)
adjustment(payroll_item_id, kind adjustment_kind, amount numeric(20,8), currency, reason text not null,
           reimbursement_id -> reimbursement null)
supplier_act(contract_id /* kind=fop */, payee_id, payroll_item_id null, type act_type, number text null,
             act_date date, period_from date, period_to date, amount_uah numeric(20,2), status doc_status,
             snapshot jsonb, gdoc_file_id, pdf_file_id, signed_url null /* Вчасно */, date_override_reason null)

-- Ledger
account(name, kind account_kind, currency, network null, opening_balance numeric(20,8), opening_date date, is_active)
category(tx_type tx_type, name, unique(tx_type, name))
transaction(occurred_on date, type tx_type, category_id, description, counterparty, external_ref /* tx hash, bank ref */)
posting(transaction_id, account_id, amount numeric(20,8) /* зі знаком */, currency, is_fee bool)
allocation(transaction_id, amount numeric(20,8), currency,
           invoice_id null, payroll_item_id null, reimbursement_id null,   -- рівно одне (I9)
           fx_rate numeric(18,6) null, fx_source null)
fx_rate(on_date date, base, quote, rate numeric(18,6), source fx_source, unique(on_date, base, quote, source))

-- Відрядження
trip(title, starts_on, ends_on, location, status text check in ('planned','in_progress','awaiting_reimbursement','settled'))
trip_participant(trip_id, person_id, unique(trip_id, person_id))
trip_expense(trip_id, person_id, spent_on date, description, amount numeric(20,8), currency,
             fx_rate numeric(18,6), fx_source, amount_usd numeric(20,8), reimbursable bool,
             paid_by text check in ('person','company'), receipt_file_id null)
reimbursement(trip_id, person_id, payee_id, amount numeric(20,8), currency,
              method text check in ('act','direct_payment'), status text check in ('planned','paid'))

-- Документи і службове
document(type text /* contract, sow, annex, invoice, act, cv, nda, statement, other */, number null, title,
         doc_date date null, url null, drive_file_id null, status, version int default 1, supersedes_id null, notes)
document_link(document_id, entity_type text check in ('person','payee','client','contract','assignment',
              'invoice','supplier_act','trip','transaction'), entity_id uuid, unique(document_id, entity_type, entity_id))
number_sequence(key text pk, template text, next_value int, year_scoped bool, current_year int null)
work_calendar_exception(on_date date pk, is_working bool, reason text)
audit_log(id bigserial, table_name, row_id uuid, action, old jsonb, new jsonb, actor uuid null, at timestamptz)
app_user(id uuid pk -> auth.users, email, role app_role, is_active bool)
job(kind, payload jsonb, status, attempts int, last_error null, run_after timestamptz)
drive_folder(path text pk, folder_id text)
```

### 4.3 Інваріанти в БД (MUST)

| # | Інваріант | Реалізація |
| --- | --- | --- |
| I1 | Випущений інвойс/акт не змінюється: `number`, дати, суми, `snapshot`, рядки заморожені; дозволені лише переходи статусу вперед і `void` | `BEFORE UPDATE/DELETE` тригери на `invoice`, `invoice_line`, `supplier_act` |
| I2 | Номер видається лише при випуску, без дублікатів | Функція `issue_number(seq_key, doc_date)`: `SELECT … FOR UPDATE` на `number_sequence`, токени шаблону `{seq} {yy} {yyyy} {contract}`, скидання лічильника для `year_scoped`. Unique-індекс на `number` для `status <> 'draft'` |
| I3 | Дата документа — робочий день | Функція `is_working_day(d)` (виняток з `work_calendar_exception`, інакше `isodow < 6`) + **тригер** на `invoice.issue_date` і `supplier_act.act_date`. Не CHECK: CHECK не може читати інші таблиці. Виняток — заповнений `date_override_reason` і роль `owner` |
| I4 | Валюта проводки = валюта рахунку | Тригер на `posting` |
| I5 | Форма транзакції: `transfer`/`fx_exchange`/`crypto_*` — рівно одна від'ємна і одна додатна не-fee проводка; `revenue` — додатна; `expense` — від'ємна; fee — завжди від'ємна | `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` на `posting` |
| I6 | Закритий період read-only: `timesheet`, `payroll_line.amount_usd`, `adjustment` | Тригери, що перевіряють `period.status`. Відкриття періоду — лише `owner`, з причиною в audit |
| I7 | Алокації: сума по інвойсу ≤ `invoice.total`; сума по транзакції ≤ її основної проводки. Після зміни — перерахунок `invoice.paid_amount`, `status` і виклик розблокування ЗП (5.3) | Тригер на `allocation` + функція `refresh_invoice_payment(invoice_id)` |
| I8 | Кожна зміна бізнес-таблиць потрапляє в `audit_log`, включно з правками через Studio (`actor = null`) | Універсальний `AFTER INSERT/UPDATE/DELETE` тригер, actor з `auth.uid()` |
| I9 | Рівно одна ціль: `allocation` (інвойс / виплата / компенсація), `contract` (клієнт / одержувач) | `CHECK (num_nonnulls(…) = 1)` |
| I10 | `billing_terms`/`pay_terms` не змінюються заднім числом у закритому періоді | Тригер: `valid_from` має бути пізніше за останній закритий період |

### 4.4 Права (RLS)

RLS увімкнений на всіх таблицях `public`. Роль береться функцією `current_app_role()` з `app_user` за `auth.uid()`.

| Дані | owner | finance | viewer |
| --- | --- | --- | --- |
| `person`, `client`, `document`, `document_link`, `trip` | читання/запис | читання/запис | читання |
| `payee`, `pay_terms`, `payroll_*`, `adjustment`, `supplier_act` | читання/запис | читання/запис | — |
| `contract`, `assignment`, `billing_terms`, `invoice*`, Ledger | читання/запис | читання/запис | — |
| Відкриття періоду, override дати, `app_user`, `work_calendar_exception` | так | — | — |
| `audit_log` | читання | читання | — |

**Пастка з Drizzle.** Якщо сервер підключається роллю `postgres`, RLS обходиться. Тому кожен запит з користувацького контексту йде через обгортку `withUser(session, tx => …)`, яка в транзакції робить `set local role authenticated` і `set local request.jwt.claims = '<claims>'`. Пряме підключення без обгортки дозволене лише для cron/job-обробників і імпорту, з `actor` у audit як `system:<job>`.

## 5. Бізнес-правила й розрахунки

Усі формули цього розділу реалізуються чистими функціями в `packages/domain` і покриваються тестами з розділу 9. Діюча версія умов для періоду — з найбільшим `valid_from` ≤ першого числа періоду. Зміна умов серед місяця у v1 не підтримується — різниця оформлюється `adjustment`.

### 5.1 Білінг (рядок інвойсу)

Позначення: h — години за період, H — `period.work_hours`, r — `billing_terms.rate`. Якщо h = 0 або тип `none`, рядок не створюється (як у нинішній формулі `IF(F=0, 0, …)`).

| Тип / політика | Сума рядка | Приклад з липня 2026 |
| --- | --- | --- |
| `hourly` | r × h | IdeaSoft: 47 × 184 = 8 648.00 |
| `fixed_monthly` + `full_month` | r | Trady: 5 500.00 незалежно від годин |
| `fixed_monthly` + `by_hours` | r / H × h | Boosty SOW: 5 500 / 184 × h |
| `fixed_monthly` + `trunc_hourly` | floor(r / H) × h | Boosty (Pavlo): floor(5 000 / 184) = 27 × h |

Округлення: сума рядка — до 2 знаків, half-up; `invoice.total` = сума рядків. В інвойсі `quantity` = h, `unit_price` = ефективна ставка (для `full_month` — місячна сума, кількість 1). Один інвойс = один контракт × період; рядки — всі assignments контракту з h > 0.

### 5.2 Нарахування ЗП

| `pay_terms.type` | `payroll_line.amount_usd` | Примітка |
| --- | --- | --- |
| `fixed` | amount | Сума вже враховує FTE (у таблиці `2300*0.5` = 1150), повторно не множити |
| `hourly` | amount / H × h | Sklyarov: 7 360 / 184 × 5 = 200.00 |
| `included` | 0 | Рядок створюється з нулем для прозорості |

`payroll_item` групує рядки за (період, person, payee). Одержувач береться з `pay_terms.payout_method` і `person.default_payee_id`; якщо у людини fiat і crypto виплати — це два різні items.

```latex
\text{total\_uah} = \operatorname{round}_2\Big(\big(\textstyle\sum \text{line}_{usd} + \sum \text{adj}_{usd}\big)\times \text{payout\_fx}\Big) + \sum \text{adj}_{uah}
```

Перевірка на реальних даних: Владислав (CTO), липень — 2 020 × 44.48 + 3 325 (adjustment UAH) = 93 174.60 = сума акту `1002 - А8`. Сума місячного акту ФОП = `total_uah` його `payroll_item`.

### 5.3 Pay-when-paid з фінансуванням компанією

ЗП за місяць N стає доступною до виплати, коли клієнт повністю оплатив інвойс, або в дедлайн — за рахунок компанії, що настане раніше. Приклад: робота в серпні, інвойс 01.09.2026 (вт), due 20.09 — це неділя, тож дедлайн виплати 21.09 (пн).

```mermaid
stateDiagram-v2
  [*] --> accrued: period closed
  accrued --> payable: no funded_by (internal / billing none)
  accrued --> awaiting_client: funded_by set, invoice not paid
  awaiting_client --> payable: invoice fully paid [funding = client]
  awaiting_client --> payable: today >= payout_deadline [funding = company]
  awaiting_client --> payable: owner override + reason [funding = company]
  payable --> paid: allocation from Ledger
  paid --> [*]
```

Правила:

1. `funded_by_invoice_line_id` ставиться автоматично: рядок ЗП і рядок інвойсу з одного `timesheet`.
2. `payout_deadline` = наступний робочий день ≥ `invoice.due_date`, плюс `pay_terms.grace_days` робочих днів (дефолт 0).
3. Часткова оплата не розблоковує рядок — він чекає повної оплати або дедлайну.
4. `funding_source` фіксується в момент переходу в `payable` і більше не змінюється. Оплата клієнта після цього закриває дебіторку, на одержувача не впливає.
5. Перерахунок статусів запускають: зміна `allocation` (I7), щоденний cron о 06:00 Europe/Kyiv, анулювання або перевипуск інвойсу (переприв'язка `funded_by` до нових рядків).
6. Статус `payroll_item`: усі рядки `payable` → `payable`; частина → `partially_payable`. Виплатити можна лише payable-частину; аванс понад це — лише owner з `override_reason`.
7. Клієнт не заплатив зовсім: інвойс → `written_off` + транзакція `expense` категорії `Bad Debt`.

```ts
// packages/domain/payroll/resolvePayability.ts — еталонна логіка
export function resolvePayability(line: PayrollLine, inv: InvoiceState | null, terms: PayTerms,
                                  today: LocalDate, cal: WorkCalendar): Payability {
  if (!inv || terms.releasePolicy === 'immediate') return { payable: true, funding: 'company' };
  if (new Decimal(inv.paidAmount).gte(inv.total)) return { payable: true, funding: 'client' };
  const deadline = cal.addWorkingDays(cal.nextWorkingDayOnOrAfter(inv.dueDate), terms.graceDays);
  if (today >= deadline) return { payable: true, funding: 'company' };
  return { payable: false, deadline };
}
```

### 5.4 Курси валют

Курс зберігається знімком у дії (`fx_rate`, `fx_source`, `fx_set_by`, `fx_set_at`) в `payroll_item`, `allocation`, `trip_expense`. Автопідстановка для виплати USD→UAH, у порядку пріоритету:

1. `bank_actual` — останній `fx_exchange` USD→UAH у Ledger за 3 календарні дні: |проводка UAH| / |проводка USD|;
2. `nbu` — курс НБУ на дату з `fx_rate` (якщо немає — запит до `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&date=YYYYMMDD&json`);
3. останній `manual`.

Поле курсу завжди редаговане; поруч — бейдж джерела та перерахована сума в UAH. Ручна зміна ставить `fx_source = manual`. Для `fx_exchange`, надходжень у не-USD і криптооперацій курс не вводиться: вводяться обидві фактичні суми з виписки, курс похідний. Похідна USD-вартість у звітах рахується за курсом НБУ на дату операції. Точність: курс — 6 знаків, UAH — 2 знаки half-up. USDT/USDC у v1 = 1 USD, як у поточному `FX_Rates`.

### 5.5 Робочі дні та дати документів

Робочий день = Пн–Пт, якщо `work_calendar_exception` не каже інакше. Список свят не хардкодиться: під воєнним станом дію ст. 73 КЗпП призупинено законом № 2136-ІХ, і свята 2026 року не є неробочими днями ([Профспілка освіти](https://pon.org.ua/info-work/12719-sviatkovi-dni-bez-vykhidnykh-iak-pracuvatymut-ukrainci-u-kvitni-travni.html)). Винятки веде owner у Settings.

Правила дат на рівні `contract` (JSON):

| Поле | Дефолт | Інші типи |
| --- | --- | --- |
| `act_date_rule` | `{"type":"last_working_day_of_period"}` | `{"type":"nth_working_day_after_period","n":3}`, `{"type":"manual"}` — дата лише вручну (Хомин, див. Q7) |
| `invoice_date_rule` | `{"type":"first_working_day_after_period"}` | `nth_working_day_after_period` |
| `payment_due_rule` | `{"type":"day_of_month","day":20}` | `{"type":"net_days","days":15}` |

Дефолти на найближчі періоди (тест-кейси для `WorkCalendar`):

| Період | Акт | Інвойс | Коментар |
| --- | --- | --- | --- |
| 2026-09 | 30.09 (ср) | 01.10 (чт) | 1 жовтня — свято, але робочий день |
| 2026-10 | 30.10 (пт) | 02.11 (пн) | 31.10 — субота, 01.11 — неділя |
| 2026-11 | 30.11 (пн) | 01.12 (вт) | — |
| 2026-12 | 31.12 (чт) | 01.01.2027 (пт) | Формально робочий; виняток у календарі зсуває на 04.01 |

Перед випуском дата підставляється за правилом і редагується; date picker блокує неробочі дні (override — див. I3). Зміна дати інвойсу перераховує `due_date` і `payout_deadline`. Якщо дата нового документа раніша за дату попереднього випущеного в тій самій послідовності, показується попередження (не блокування).

### 5.6 Нумерація

| Послідовність | Шаблон | Приклад | Наступне значення після імпорту |
| --- | --- | --- | --- |
| `invoice` (глобальна, `year_scoped`) | `{seq}/{yy}` | 24/26 | max з реальних номерів + 1 (див. 12) |
| `act:OD-1001` (Щурко) | `1001 - А{seq}` | 1001 - А12 | 13 |
| `act:OD-1002` (Езерович) | `1002 - А{seq}` | 1002 - А9 | 10 |
| `act:OD-1003` (Доліна) | `1003 - А{seq}` | 1003 - А10 | 11 |
| `act:MF281025` (Хомин) | `MF281025/{seq}` | MF281025/10 | 11 |

Історичні номери зберігаються дослівно. Для пошуку — згенерована колонка `number_key`: без пробілів і дефісів, латинська A → кирилична А (`1003  -А4` і `1003 - А4` дають один ключ). Анульований номер не звільняється.

## 6. Модулі та критерії приймання

Кожен модуль вважається готовим, коли виконані всі його критерії (AC) і він працює на імпортованих даних. Загальні вимоги до всіх екранів: таблиці з фільтрами/сортуванням/пошуком, суми з валютою, дати у форматі ДД.ММ.РРРР, кожна картка показує прив'язані документи та історію змін з `audit_log`.

### 6.1 Dashboard

- Залишки по рахунках у валюті та в USD, Treasury total.
- Дебіторка: неоплачені інвойси з днями до/після due.
- Зобов'язання перед людьми в трьох сумах: «нараховано, чекає клієнта», «можна виплатити», «кредитуємо клієнтів» (виплачено за рахунок компанії при неоплаченому інвойсі).
- Календар найближчих 30 днів: due-дати, `payout_deadline`, дефолтні дати актів і інвойсів; попередження, якщо залишку не вистачає на виплати в дедлайн за умови, що клієнт не заплатить.
- Маржа за місяць по клієнтах і людях за нарахуванням: інвойс періоду − нарахована ЗП періоду.
- Прогноз на 6 місяців: активні assignments × умови + планові витрати (заміна `Annual Finances`).

AC: цифри залишків після імпорту збігаються з таблицею з розділу 8.3; кожна сума клікабельна до списку записів, з яких вона складена.

### 6.2 People / Bench

- Список спеціалістів з фільтрами: стек (теги), сеньйорність, ставка ≤ X, доступний з дати, full/part time, локація.
- Картка: профіль, поточні та минулі assignments, дефолтний payee, історія виплат (finance+), CV з версіями, поїздки.
- Завантаження CV (PDF) у `people/{person}/cv/` зі створенням `document` типу `cv`; нова версія замінює попередню через `supersedes_id`.
- Розрахунковий статус «вільний / частково / зайнятий» = сума FTE активних невнутрішніх assignments.
- Експорт відфільтрованого списку в CSV для відправки клієнту (без фінансових полів і payee).

AC: усі 13 рядків `Bench` імпортовані; фільтр «Solidity, ≤ $50/год, доступний зараз» працює; viewer не бачить payee і виплат.

### 6.3 Clients, Contracts, Assignments

- Картка клієнта: реквізити, контракти, активні люди, інвойси, дебіторка, середня затримка оплати в днях (за останні 12 міс.).
- Контракт: правила дат і оплати, шаблон документа, послідовність номерів, файл договору.
- Assignment: форма з двома блоками «Клієнту» / «Людині»; історія версій умов; нова версія = новий рядок з `valid_from`, старий не редагується.

AC: для кожного assignment видно маржу за останній період; спроба змінити ставку заднім числом у закритому періоді відхиляється з понятним повідомленням (I10).

### 6.4 Periods (місячне закриття)

Майстер у такому порядку:

1. Відкрити період: `work_hours` підставляється як кількість робочих днів × 8 з `WorkCalendar` (липень 2026 = 184), редагована.
2. Години: таблиця всіх активних assignments з inline-редагуванням `hours`, імпорт з CSV.
3. Розрахунок: прев'ю у форматі нинішнього аркуша `Current` (людина, клієнт, години, ставка, сума інвойсу, ЗП USD, орієнтовно UAH) з підсумками, що рахуються з усіх рядків.
4. Adjustments: додати бонус / утримання / компенсацію з причиною.
5. Закрити період: створюються чернетки інвойсів і `payroll_item`/`payroll_line`, статуси рядків рахуються за 5.3.

AC: перерахунок липня 2026 дає суми з 9.2 (включно з рядком Sklyarov, який таблиця губила); після закриття години не редагуються.

### 6.5 Invoices

- Список зі статусами `draft / issued / partially_paid / paid / void / written_off`, днями прострочки, сумами оплачено/залишок.
- Діалог «Випустити»: дата за правилом (5.5), перерахований due, прев'ю PDF без номера → підтвердження → номер + знімок + PDF на Drive + `document`.
- Додаткові рядки вручну (консалтинг, фіксована послуга як у `Switzerland`) — лише в чернетці.
- Анулювання з причиною та кнопка «Перевипустити» (нова чернетка-копія).
- Зв'язування з оплатою: з картки інвойсу можна вибрати транзакцію `revenue` і створити `allocation`.

AC: випущений інвойс не змінюється ні через UI, ні через SQL (I1); два одночасні випуски не отримують один номер (I2); повна оплата переводить пов'язані рядки ЗП у `payable`.

### 6.6 Payroll та акти ФОП

- Черга виплат з групами «можна зараз», «чекає клієнта (дедлайн ДД.ММ)», «виплачено»; у кожному item — розбивка по рядках з джерелом фінансування.
- Діалог «Виплатити»: курс з автопідстановкою та бейджем джерела (5.4), сума UAH, рахунок списання → створює `transaction` (`expense`, `Payroll`/`Contractors`), `allocation` і, для fiat-ФОП, чернетку місячного акту.
- Акт: дата за `act_date_rule` (дефолт — останній робочий день періоду), сума = `total_uah`, період «з ДД.ММ.РРРР по ДД.ММ.РРРР»; випуск — як у інвойса. Після підписання — поле `signed_url` (Вчасно).
- Позачерговий акт типу `reimbursement` з ручною датою (компенсація поїздки), зв'язаний з `reimbursement`.
- Реєстр актів: фільтр за контрагентом і роком, підсумок по контрагенту (заміна `Реестр актов`), підсвітка пропущених періодів.

AC: рядок з неоплаченим інвойсом автоматично стає `payable` з `funding = company` у день `payout_deadline` (тест з фіктивною датою); сума акту збігається з `total_uah` до копійки; суботня дата акту відхиляється.

### 6.7 Ledger

- Рахунки з залишками; журнал транзакцій з фільтрами (дата, тип, категорія, рахунок, нерозподілені).
- Форми за типом: дохід, витрата, переказ, обмін (дві суми, курс показується), крипто (з хешем та мережею); комісія — опційна fee-проводка.
- Імпорт виписки ПриватБанку (CSV/XLSX) з прев'ю, дедуплікацією за `external_ref`/дата+сума і правилами автокатегоризації за підрядком опису («Головне управління ДПС» → Taxes).
- Звірка: ввести баланс з банку/гаманця на дату → показати різницю з розрахунковим.
- Довідник категорій (з `Categories` + `Bad Debt`).

AC: валюта проводки завжди збігається з рахунком (I4); обмін 1 400.20 USD → фактична сума EUR з виписки не лишає залишку типу 0.00137.

### 6.8 Trips

- Поїздка: назва, дати, місце, учасники, статус.
- Витрати: дата, опис, сума, валюта, курс (дефолт НБУ на дату, редагований), «компенсується?», хто платив (людина/компанія), фото чеку в `trips/{yyyy}/{trip}/receipts/`.
- Підсумки по кожному учаснику: витрачено, до компенсації, компенсовано, залишок (USD і UAH).
- Компенсація: спосіб `act` (створює adjustment типу `trip_reimbursement` або позачерговий акт) або `direct_payment` (транзакція + allocation). Витрати, які оплатила компанія, створюють витрату в Ledger (`Travel / Conf.`).
- Поїздка стає `settled`, коли залишок до компенсації = 0.

AC: для «Bits&Pretzels Munich» видно, що 30 384.79 UAH компенсовано актом `1003 - А8`; витрати з одного чеку не можуть належати двом поїздкам (попередження про дублікат за дата+сума+опис).

### 6.9 Documents

- Реєстр: тип, номер, назва, дата, статус, посилання/файл, прив'язки (чипи сутностей); пошук за номером (`number_key`) і назвою.
- Додати документ: файл (→ Drive у папку за типом і першою прив'язкою) або зовнішнє посилання (Вчасно, Drive); 0..n прив'язок.
- Згенеровані інвойси і акти потрапляють у реєстр автоматично.

AC: документ без прив'язок дозволений; один документ може бути прив'язаний одночасно до людини, клієнта й контракту.

### 6.10 Settings

Реквізити компанії, календар винятків, послідовності номерів (без можливості зменшити `next_value`), шаблони (ID Google Docs), категорії, користувачі та ролі, стан фонових задач (`job`). Доступ — лише owner.

## 7. Генерація документів і Google Drive

Документ генерується **виключно з `snapshot`**, записаного в момент випуску, а не з живих даних. Тому перегенерація PDF через рік дасть той самий документ (зараз `TODAY()` і посилання на `Current` це ламають).

### 7.1 Потік випуску

```mermaid
sequenceDiagram
  actor U as User
  participant A as Next.js Server Action
  participant DB as Postgres
  participant J as job worker
  participant G as Google Docs/Drive API
  U->>A: Випустити (дата, підтвердження)
  A->>DB: BEGIN; issue_number(); status=issued; snapshot; COMMIT
  A->>DB: insert job(render_document)
  A-->>U: Номер видано, PDF генерується
  J->>DB: взяти job + snapshot
  J->>G: files.copy(шаблон → цільова папка)
  J->>G: documents.batchUpdate(replaceAllText, рядки таблиці)
  J->>G: files.export(application/pdf) → files.create(PDF)
  J->>DB: gdoc_file_id, pdf_file_id, document + document_link
  Note over J,G: Помилка → retry з backoff (3 спроби);<br/>документ лишається issued, кнопка «Перегенерувати»
```

Для одного документа job можна виконати синхронно одразу після COMMIT; для пакету (усі акти періоду) — лише через чергу. Прев'ю до випуску — той самий рендер у тимчасову папку `_tmp` з водяним знаком `DRAFT` замість номера, файл видаляється через 24 год.

### 7.2 Шаблони

| Шаблон | Макет | Зараз |
| --- | --- | --- |
| `invoice_hourly` | Двомовний EN/UA; таблиця № / опис / години / ціна / сума | `IdeaSoft Annex 3`, `SOW #*` |
| `invoice_fixed` | Двомовний; таблиця № / опис / сума | `Switzerland` |
| `act_fop` | Українська; шапка сторін, статичний перелік послуг, п. 2 зі сумою прописом, п. 3–4, реквізити | `Акт Щурко` |

Тексти шапок, умов оплати та підписів переносяться з поточних аркушів дослівно. Плейсхолдери — `{{шлях}}` за структурою `snapshot`:

```text
{{doc.number}} {{doc.date}} {{doc.date_ua}} {{doc.place_en}} {{doc.place_ua}}
{{contract.number}} {{contract.date}} {{contract.title_en}}
{{company.name_en}} {{company.name_ua}} {{company.address_en}} {{company.address_ua}}
{{company.director_ua}} {{company.bank_en}} {{company.bank_ua}} {{company.legal_code}}
{{client.name}} {{client.address}} {{client.bank}}
{{payee.name_ua}} {{payee.tax_id}} {{payee.edr_record}} {{payee.edr_date}} {{payee.address_ua}} {{payee.iban}}
{{period.from}} {{period.to}} {{period.text_ua}}          -- "з 01.08.2026 року по 31.08.2026 року"
{{total.amount}} {{total.currency}} {{total.words_en}} {{total.words_ua}}
Рядок-шаблон таблиці: {{line.n}} {{line.description_en}} {{line.description_ua}} {{line.qty}} {{line.price}} {{line.amount}}
```

Рядок таблиці, що містить `{{line.*}}`, є шаблонним: генератор вставляє N−1 копій (`insertTableRow`) і заповнює комірки знизу вгору, щоб індекси не зсувалися. Невідомий плейсхолдер у шаблоні — помилка рендеру, а не порожній текст.

**Сума прописом** — власні функції в `packages/domain/words` з тестами: `moneyToWordsEn(1100, 'USD')` → «One thousand one hundred US dollars 00 cents»; `moneyToWordsUa(93174.60, 'UAH')` → «дев'яносто три тисячі сто сімдесят чотири гривні 60 копійок». Українська версія враховує рід (тисяча, гривня — жіночий; долар — чоловічий) і форми 1 / 2–4 / 5+ (включно з 11–14). Точний формат тексту береться з нинішніх формул `MONEYTEXT` / `UA_MONEYTEXT` у файлі інвойсів.

### 7.3 Структура Shared Drive

```text
Tally (Shared Drive)
├── _templates/                 invoice_hourly, invoice_fixed, act_fop (Google Docs)
├── _tmp/                       прев'ю, автоочистка 24 год
├── _dev/  _preview/            корені для непродових середовищ (та сама структура всередині)
├── clients/{client-slug}/
│   ├── contracts/
│   └── invoices/{yyyy}/         Invoice 25-26 Boosty 2026-10-01.pdf (+ Google Doc)
├── people/{person-slug}/
│   ├── cv/
│   └── docs/
├── payees/{payee-slug}/
│   ├── contracts/
│   └── acts/{yyyy}/             Act 1001-А13 2026-09-30.pdf
├── trips/{yyyy}/{trip-slug}/receipts/
├── ledger/statements/{yyyy}/
├── documents/                  документи без прив'язки
└── backups/{yyyy-mm}/          pg_dump (розділ 10)
```

Папки створюються ліниво; ID папок кешуються в таблиці `drive_folder(path, folder_id)`. Slug — латиниця, транслітерація за КМУ 2010. Файли успадковують права Shared Drive; публічні посилання не створюються. Інтерфейс `DocumentStorage` має дві реалізації: `DriveStorage` і `LocalStorage` (`STORAGE_DRIVER`); рендер у локальному режимі все одно йде через Google Docs API у папку `_dev`.

## 8. Міграція з xlsx

Імпорт — ідемпотентний скрипт `pnpm import:legacy --dir ./data/legacy [--dry-run]`, що читає 5 файлів (SheetJS), пише в БД від імені `system:import` і генерує звіт `import-report.md`: кількості, аномалії, звірку. У кожного імпортованого рядка є `legacy_ref` (файл / аркуш / рядок). Історичні документи та виплати позначаються `is_legacy = true`: на них не діють I3 (робочі дні) і вимога `snapshot`, інакше суботні акти 28.02.2026 не імпортуються.

Імена людей у файлах різні (`  Vladyslav ` з пробілом, `Wita` / `ЩУРКО ВІТАЛІЯ`, ` Pavlo Adamenko  ` / `Pavlo`), тому зв'язки задаються файлом `data/legacy/aliases.json` (ім'я в файлі → `person`, `payee`), який власник підтверджує перед першим реальним імпортом. Dry-run без повного `aliases.json` виводить список незмаплених імен.

### 8.1 Мапінг аркушів

| Джерело | Ціль | Правила |
| --- | --- | --- |
| `Syntora_Tech_Bench.xlsx` → `Bench` | `person`, `document(cv)` | Стек/домен — split по комі; «CV is being updated» → без документа; посилання (Drive, Dribbble) → `document.url`; ім'я PDF-файлу → `document.title`, файл власник додасть пізніше |
| `Calculations_for_invoices` → `January` … `July`, `Копія аркуша Current` (серпень), `Current` (вересень) | `client`, `contract`, `assignment`, `billing_terms`, `pay_terms`, `period`, `timesheet` | Назви таблиць `January_2026` … `Septemper_2026` визначають місяць. Версії умов — новий `valid_from` у місяць, де значення змінилося. `Work Hours in Month` і `Курс 1USD` → `period`. Січень–серпень — `closed`, вересень — `open` |
| Те саме, колонки O/P/T/S | `payroll_item`, `payroll_line`, `adjustment` (legacy) | Різниця між P і O × курс → `adjustment` UAH з причиною `legacy: уточнити`. `T = yes` → виплачено; `S` (посилання Вчасно/Tronscan) → `document` |
| `SOW #1–5`, `Switzerland`, `IdeaSoft Annex 3` | `client` (реквізити), `contract`, шаблони, `invoice` (legacy) | Шапки → реквізити клієнта і компанії. Номери 21/26, 22/26, 24/26 → legacy-інвойси, сума — з поля Total, розбіжність з рядками → у звіт |
| `Акт Щурко`, `Акт Езерович` | `payee`, `contract` (fop), шаблон `act_fop` | Реквізити ФОП і номер/дата договору (`OD-1001 від 04.09.2025`) |
| `Реестр_актов` → `ФОПы акты` | `supplier_act` (legacy) | 30 актів, номери дослівно; тип `reimbursement`, якщо сума збігається з підсумком поїздки, інакше `monthly` |
| `Syntora_Ledger` → `Accounts`, `Categories`, `Transactions`, `FX_Rates` | `account`, `category`, `transaction`, `posting`, `fx_rate` | Формули типу `=2000*43.05` обчислюються до числа. Fee → окрема від'ємна проводка. `Balances`, `Treasury_USD` не імпортуються — вони для звірки (8.3) |
| `Business_trips` (6 аркушів) | `trip`, `trip_participant`, `trip_expense` | Курси текстом з комою (`0,86`) → число; «чеки» з прихованих колонок — окремі `trip_expense`; `Copy of Bits&Pretzels Munich` = поїздка European Blockchain Convention Barcelona |
| `Annual Finances` | — | Не імпортується: прогноз рахує Dashboard |

### 8.2 Відомі аномалії

Імпорт не виправляє їх мовчки: кожна потрапляє в `import-report.md` з посиланням на рядок.

| # | Де | Що | Обробка |
| --- | --- | --- | --- |
| A1 | `July` K15/O15/P15, `Current` K16 | Підсумок `SUM(K2:K13)` не включає останні рядки (Sklyarov) | Підсумки не імпортуються, рахуються заново |
| A2 | `July` J3, J4 | Ставка Fix рахується як `I/F` замість `I/WorkHours` | Trady → `full_month`; інші Fix → `by_hours` |
| A3 | `Pavlo × Boosty` | `TRUNC(I/WorkHours)` | `trunc_hourly` |
| A4 | Колонки N, P | Приховані коригування `+3325`, `-8779.3`, `2000 + 20`, `1519+453+672` | `adjustment` з причиною `legacy: уточнити` |
| A5 | Рядки `Services`, `Services / Red Jumpers` | Не люди, а витрати (27 153.20 UAH) | Не assignment; у звіт для ручного рішення (див. 12) |
| A6 | Аркуші інвойсів | `TODAY()` у даті; `SOW #1` E14 = 1100 захардкоджено | Дата legacy-інвойсу — з Ledger (надходження) або порожня + попередження |
| A7 | `Акт Щурко` | Посилання на неіснуючий аркуш `November` (`#REF!`) | Береться лише статичний текст для шаблону |
| A8 | Реєстр актів | Дати 28.02.2026 (субота) у `1001 - А6`, `1003 - А3`; формат `1003  -А4` | Legacy, номери дослівно, попередження у звіті |
| A9 | Реєстр актів, Доліна | Немає акту за квітень (А4 від 31.03, А5 від 29.05) | У звіт як пропущений період |
| A10 | Ledger, 11.01.2026 | Дохід D.Energy у валюті `USD` на рахунок `Crypto ETH - USDT` | Імпорт у валюті рахунку (USDT) |
| A11 | Ledger, 16.01.2026 | Обмін USD→EUR записаний формулою `1400.2 / 1.168` → залишок 0.00137 EUR | Потрібна фактична сума EUR з виписки; до того — округлення до 1 198.80 |
| A12 | Ledger | Остання транзакція — 20.02.2026 | Дані з 21.02.2026 — імпортом банківських виписок (див. 12) |
| A13 | `FX_Rates` | Один запис від 04.02.2026, UAH = 1/43 | Імпорт як `manual`; backfill НБУ за 2026 рік через API |
| A14 | `Business_trips` | «City tax … in Paris» у Lisbon; ручне `I7+79.97` у DOU DAY; проживання Berlin позначене «No», але 34 557.80 UAH = акт `1003 - А6` | У звіт для перевірки; +79.97 → окрема витрата «без опису» |
| A15 | Різні файли | Пробіли в іменах, різні написання однієї людини | `trim` + `aliases.json` |

### 8.3 Контрольні цифри звірки

Після імпорту Ledger розрахункові залишки на 20.02.2026 мають збігтися з аркушем `Balances` (допуск 0.01, крім A11):

| Рахунок | Валюта | Відкриття | Залишок |
| --- | --- | --- | --- |
| Privat USD | USD | 3 901.78 | 9 522.01 |
| Privat EUR | EUR | 0.00 | 0.00 (після A11) |
| Privat UAH | UAH | 454 989.26 | 18 477.98 |
| Crypto ETH - USDT | USDT | 901.00 | 1 203.00 |
| Crypto ETH - USDC | USDC | 959.922092 | 157.922092 |
| Crypto TRON - USDT | USDT | 11 129.57 | 11 129.57 |
| **Treasury** | USD | — | **22 442.22** (UAH за курсом 1/43) |

## 9. Тестування

Мінімум для закриття будь-якого етапу: усі тести цього розділу, що стосуються етапу, зелені в CI. Для сценаріїв з дедлайнами в непродових середовищах є «фейковий сьогоднішній день»: `APP_TODAY=YYYY-MM-DD` (ігнорується в production). У доменному коді «сьогодні» завжди передається аргументом, а не береться з `Date.now()`.

### 9.1 Юніт-тести домену (Vitest)

- Білінг: усі 4 формули з 5.1, h = 0, округлення half-up.
- ЗП: 3 типи з 5.2, adjustments USD і UAH, групування за payee.
- `resolvePayability`: internal; повна оплата до дедлайну; часткова оплата; дедлайн у вихідний; `grace_days`.
- `WorkCalendar`: таблиця дефолтів з 5.5 (уключно з винятком 01.01.2027 → 04.01.2027); норма годин липня 2026 = 184.
- `moneyToWordsEn/Ua`: 0, 1, 2, 5, 11, 21, 1 000, 1 100, 93 174.60, 1 000 000; гривні та долари.
- `number_key`: `1003  -А4` ≡ `1003 - А4` ≡ `1003-A4` (латинська A).
- Курс: похідний з двох сум (2 000 USD → 86 100 UAH = 43.05), каскад підстановки з 5.4.

### 9.2 Еталон: липень 2026

Вхід: H = 184, курс 44.48, умови та години з аркуша `July`. Рядки з h = 0 і типом `hourly`/`included` дають 0 і тут не показані. Три суми UAH збігаються з реально випущеними актами — це підтверджує формулу 5.2.

| Спеціаліст × контракт | Години | Інвойс, USD | ЗП, USD | ЗП, UAH | Акт |
| --- | --- | --- | --- | --- | --- |
| Dolina × Syntora (CEO) | — | — | 2 020.00 | 89 849.60 | 1003 - А9 |
| Vladyslav × Syntora (CTO) | — | — | 2 020.00 | 93 174.60 (вкл. adj +3 325) | 1002 - А8 |
| Vladyslav × Trady | 184 | 5 500.00 | 5 000.00 | 222 400.00 | crypto |
| Anton × Syntora (FTE 0.5) | — | — | 1 150.00 | 51 152.00 | crypto |
| Andrii × IdeaSoft | 184 | 8 648.00 | 3 000.00 | 133 440.00 | — |
| Wita × Syntora | — | — | 2 300.00 | 102 304.00 | 1001 - А11 |
| Sklyarov × Boosty | 5 | 225.00 | 200.00 | 8 896.00 | crypto |
| **Разом** |  | **14 373.00** | **15 690.00** | **701 216.20** |  |

У таблиці було 14 148 / 15 490 / 692 320.20 — різниця рівно рядок Sklyarov (A1). Тест має перевіряти саме виправлені суми.

### 9.3 Тести БД (pgTAP або SQL у Vitest проти локального Supabase)

- Для кожного інваріанту I1–I10 — негативний тест: порушення відхиляється з очікуваним кодом помилки.
- `issue_number`: 20 паралельних викликів → 20 унікальних послідовних номерів; перехід року скидає лічильник.
- RLS: viewer не читає `payee`, `pay_terms`, `payroll_*`, Ledger; finance не відкриває період.
- Audit: прямий `UPDATE` у тесті (імітація Studio) створює запис у `audit_log`.

### 9.4 E2E-сценарії (Playwright, `APP_TODAY`)

Спільне: період серпень 2026, інвойс 01.09, due 20.09 (неділя), дедлайн виплати 21.09.

1. **Клієнт вчасно.** Оплата 17.09 → рядок `payable`, `funding = client` → виплата з курсом `bank_actual` → акт з датою 31.08 → PDF на Drive.
2. **Клієнт прострочив.** `APP_TODAY=2026-09-21`, оплати немає → рядок `payable`, `funding = company` → Dashboard «кредитуємо клієнтів» > 0.
3. **Пізня оплата.** Після сценарію 2 оплата 25.09 → інвойс `paid`, «кредитуємо» зменшується, `funding_source` рядка лишається `company`.
4. **Часткова оплата.** 50% на 18.09 → рядок до 21.09 лишається `awaiting_client`.
5. **Захист документа.** Спроба змінити суму випущеного інвойсу → помилка; анулювання + перевипуск → новий номер, старий `void`, `funded_by` переприв'язаний.

### 9.5 Тест імпорту

Dry-run на фікстурах (копії 5 файлів у `data/legacy`, не в git) відтворює 8.3 і 9.2; повторний запуск імпорту дає 0 змін; усі аномалії A1–A15 присутні в звіті.

## 10. Репозиторій, запуск, CI, бекапи

Один pnpm-монорепозиторій; увесь стек піднімається локально двома командами.

### 10.1 Структура

```text
tally/
├── apps/web/                      Next.js
│   ├── app/(auth)/login/
│   ├── app/(app)/{dashboard,people,clients,periods,invoices,payroll,ledger,trips,documents,settings}/
│   ├── app/api/cron/[name]/       ендпойнти для pg_cron (CRON_SECRET)
│   ├── app/api/mcp/               MCP-сервер (Streamable HTTP)
│   ├── app/oauth/consent/         екран згоди для MCP-клієнтів
│   └── server/
│       ├── actions/               Server Actions — адаптери над services/
│       ├── services/              бізнес-операції, єдина точка мутацій (Zod на вході)
│       ├── mcp/                   MCP tools — адаптери над services/ (розділ 13)
│       ├── db/                    drizzle client, withUser()
│       ├── google/                drive.ts, docs.ts, render.ts
│       └── jobs/                  обробники job
├── packages/
│   ├── domain/                    чисті функції + Vitest (billing, payroll, payability, calendar, fx, words, numbering)
│   └── db/                        Drizzle schema, relations, типи
├── supabase/
│   ├── config.toml
│   ├── migrations/                drizzle-kit + ручні SQL (тригери, функції, RLS, pg_cron)
│   ├── seed.sql                   company, categories, number_sequence, app_user (owner)
│   └── tests/                     pgTAP
├── scripts/import-legacy/         імпорт xlsx (розділ 8)
├── data/legacy/                   gitignored: xlsx + aliases.json
└── .github/workflows/             ci.yml, migrate.yml, backup.yml
```

### 10.2 Змінні середовища

| Змінна | Призначення |
| --- | --- |
| `DATABASE_URL` | Pooler (transaction mode) для рантайму; локально `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `DIRECT_DATABASE_URL` | Direct connection для міграцій і бекапу |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Сесія Supabase Auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Лише сервер; ніколи в клієнтському бандлі |
| `ALLOWED_EMAILS` | Whitelist для першого входу (далі — `app_user`) |
| `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` | Service account для Drive/Docs |
| `GOOGLE_DRIVE_ROOT_ID` | Корінь середовища (Shared Drive або `_dev` / `_preview`) |
| `STORAGE_DRIVER` | `drive` або `local` |
| `CRON_SECRET` | Підпис викликів з pg\_cron |
| `APP_TODAY` | Фейкова дата для тестів; ігнорується, якщо `VERCEL_ENV=production` |
| `BACKUP_AGE_PUBLIC_KEY` | Шифрування бекапів (GitHub secret) |

### 10.3 Команди

```bash
pnpm install
supabase start                  # Postgres :54322, API :54321, Studio :54323, Mailpit :54324
supabase db reset               # міграції + seed з нуля
pnpm import:legacy --dry-run    # звіт без запису
pnpm import:legacy              # імпорт у локальну БД
pnpm dev                        # http://localhost:3000
pnpm test                       # Vitest (domain)
supabase test db                # pgTAP
pnpm e2e                        # Playwright
pnpm db:generate                # drizzle-kit → supabase/migrations
```

Логін локально — magic link через Mailpit або Google OAuth з redirect на `http://127.0.0.1:54321/auth/v1/callback`.

### 10.4 Фонові задачі (pg\_cron → pg\_net → `/api/cron/<name>`)

| Задача | Розклад (Europe/Kyiv) | Що робить |
| --- | --- | --- |
| `nbu-rates` | щодня 10:00 | Курси USD, EUR НБУ → `fx_rate`; заодно тримає Supabase Free активним |
| `payability` | щодня 06:00 | Перерахунок статусів рядків ЗП за дедлайнами, статус прострочених інвойсів |
| `jobs` | щохвилини | Обробка черги `job` (рендер документів), по одній задачі за виклик |
| `tmp-cleanup` | щогодини | Видалення прев'ю з `_tmp` старше 24 год |

### 10.5 CI/CD і бекапи

- **ci.yml** (PR): lint, typecheck, `pnpm test`, `supabase start` + `db reset` + `supabase test db`, Playwright smoke.
- **migrate.yml** (push у `main`): `supabase db push` у production до деплою; міграції лише зворотно сумісні (expand → migrate → contract). Деплой — Vercel Git integration.
- **backup.yml** (щодня 02:00 UTC): `pg_dump -Fc` через `DIRECT_DATABASE_URL` → шифрування `age` → `backups/{yyyy-mm}/` на Drive. Зберігання: 30 щоденних + 12 місячних. Приватний ключ `age` зберігається офлайн у власника.
- **Відновлення:** раз на місяць — `pg_restore` останнього бекапу в локальний Supabase і перевірка залишків на Dashboard. Бекап, який ніколи не відновлювали, вважається відсутнім.

## 11. План робіт для агента

Вісім етапів, строго по черзі: наступний починається лише після виконання DoD попереднього. Ledger йде разом із Payroll (етап 3), бо розблокування ЗП залежить від алокацій платежів. Правила для агента: кожен етап — окрема серія PR з тестами; будь-яке нове припущення записується в розділ 12; реальні xlsx ніколи не комітяться.

### Етап 0 — Каркас

- [ ] Монорепозиторій за 10.1, pnpm, TS strict, ESLint, Prettier
- [ ] `supabase init`, локальний стек, Drizzle з `prepare: false`, обгортка `withUser()`
- [ ] Supabase Auth (magic link локально, Google OAuth), `app_user` + ролі, whitelist
- [ ] Layout, навігація модулів, українська локалізація форматів (дати, суми)
- [ ] `packages/domain` з `decimal.js`, утиліти грошей і дат (`LocalDate`, без timezone-пасток)
- [ ] Аудит-тригер (I8), CI (ci.yml); сервісний шар server/services як єдина точка мутацій для UI і MCP (13.1)

DoD: вхід працює локально; користувач поза whitelist не входить; CI зелений.

### Етап 1 — Довідники та документи

- [ ] Таблиці `company`, `person`, `payee`, `client`, `contract`, `assignment`, `billing_terms`, `pay_terms`, `document`, `document_link`, `drive_folder` + RLS (4.4) + I9, I10
- [ ] `DocumentStorage` (Drive + Local), ліниве створення папок (7.3)
- [ ] UI: People/Bench (6.2), Clients/Contracts/Assignments (6.3), Documents (6.9)
- [ ] Імпорт: `Bench`, реквізити клієнтів і ФОП, контракти, assignments і версії умов з місячних аркушів; `aliases.json`

DoD: AC 6.2, 6.3, 6.9; dry-run імпорту без незмаплених імен.

### Етап 2 — Періоди та інвойси

- [ ] `WorkCalendar` + `work_calendar_exception` + `is_working_day()` (5.5, I3)
- [ ] `period`, `timesheet`, розрахунок білінгу (5.1), майстер періоду (6.4) без кроку ЗП
- [ ] `invoice`, `invoice_line`, `number_sequence`, `issue_number()` (I1, I2), знімок
- [ ] Шаблони `invoice_hourly`, `invoice_fixed` у Google Docs; `moneyToWordsEn/Ua`; черга `job` і рендер (7.1)
- [ ] Імпорт: періоди та години січня–вересня, legacy-інвойси

DoD: колонка «Інвойс» еталону 9.2 сходиться; випущений інвойс має PDF у `_dev` і не редагується; AC 6.5 (крім алокацій).

### Етап 3 — Ledger-ядро, виплати, акти

- [ ] `account`, `category`, `transaction`, `posting`, `allocation` (I4, I5, I7); форми транзакцій (6.7 без імпорту виписки)
- [ ] `fx_rate`, крон `nbu-rates`, каскад курсу (5.4)
- [ ] `payroll_item`, `payroll_line`, `adjustment`, закриття періоду (I6), `resolvePayability` + крон `payability` (5.3)
- [ ] `supplier_act`, шаблон `act_fop`, UI Payroll/Acts (6.6)
- [ ] Імпорт: Ledger, реєстр актів, історія виплат

DoD: еталон 9.2 повністю; звірка 8.3; E2E-сценарії 9.4 (1–5).

### Етап 4 — Ledger повністю і Dashboard

- [ ] Імпорт виписок ПриватБанку з дедуплікацією і правилами автокатегоризації
- [ ] Звірка залишків, статус `written_off` + `Bad Debt`
- [ ] Dashboard (6.1), прогноз на 6 місяців

DoD: AC 6.1, 6.7; дані з 21.02.2026 до сьогодні імпортовані з виписок (якщо власник їх надав).

### Етап 5 — Відрядження

- [ ] `trip`, `trip_participant`, `trip_expense`, `reimbursement`; фото чеків; компенсація через акт або платіж
- [ ] Імпорт 6 аркушів `Business_trips`, зв'язок з актами `1003 - А6`, `1003 - А8`

DoD: AC 6.8.

### Етап 6 — Production

- [ ] Vercel Pro, окремий production-проєкт Supabase, Shared Drive, service account, секрети; домен tally.syntora.tech (CNAME на Vercel, Site URL і redirect URLs у Supabase Auth, authorized redirect URI у Google OAuth)
- [ ] migrate.yml, backup.yml, перше відновлення з бекапу (10.5)
- [ ] Реальний імпорт у production, звірка 8.3 та 9.2 вже там
- [ ] Перевірка RLS від імені viewer, перевірка, що `SUPABASE_SERVICE_ROLE_KEY` не потрапляє в клієнтський бандл
- [ ] Паралельний місяць: один період ведеться і в таблицях, і в системі; розбіжності — у звіт

DoD: власник закрив місяць у системі без таблиць, а бекап відновлюється.

### Етап 7 — MCP-доступ для агентів

- [ ] OAuth 2.1 server у Supabase (локально — `[auth.oauth_server]` у `config.toml`), dynamic client registration, екран `/oauth/consent`
- [ ] `/api/mcp` (Streamable HTTP, stateless), `/.well-known/oauth-protected-resource`, перевірка JWT через JWKS
- [ ] Таблиці `mcp_client_policy`, `change_request`, `mcp_idempotency`, `mcp_call_log`; `app.via` / `app.client_id` у audit
- [ ] Tools з 13.3 як адаптери над `server/services`; rate limit
- [ ] UI «Підключені агенти» і «Вхідні від агентів»

DoD: AC 13.6; підключення з Claude до production працює з профілем `read_only`, потім `assistant`. Read-tools можна викласти раніше, одразу після етапу 3, якщо власник хоче швидше.

## 12. Відкриті питання та припущення

Агент не чекає відповідей: працює з припущенням і зупиняється лише там, де питання блокує DoD етапу. Відповіді власник вписує у відповідний рядок.

| # | Питання | Припущення за замовчуванням | Блокує |
| --- | --- | --- | --- |
| Q1 | Хто логіниться в систему? | Лише двоє власників з роллю `owner`; роль `finance` — на випадок бухгалтера, `viewer` — для sales/рекрутера | — |
| Q2 | Мова інтерфейсу | Англійська за замовчуванням + українська (перемикач, A-058); документи — як у шаблонах (EN/UA для інвойсів, UA для актів) | — |
| Q3 | Останній реально випущений номер інвойсу в 2026 (у файлах видно 21/26, 22/26, 24/26) | Старт з 25/26, власник може збільшити в Settings | Етап 6 |
| Q4 | Дані Ledger з 21.02.2026 до сьогодні | Власник надасть виписки ПриватБанку (USD, EUR, UAH) та експорт транзакцій гаманців | Етап 4 |
| Q5 | Фактична сума EUR за обмін 16.01.2026 (A11) | 1 198.80 EUR | — |
| Q6 | Що таке рядки `Services` і `Services / Red Jumpers` (A5) | Витрати компанії, імпортуються в Ledger як `expense`, не як ЗП | — |
| Q7 | Хто такий ФОП Хомин Л. (акти `MF281025/*`), кого з людей він представляє і як визначається дата акту (фактично 12–23 числа наступного місяця) | Окремий підрядник без `person`; правило дати `{"type":"manual"}` | — |
| Q8 | Чому в Доліни немає акту за квітень (A9) | Звіт показує як пропущений період, нічого не створюється | — |
| Q9 | Причини legacy-коригувань (+3 325, −8 779.30, +20, 1519+453+672) | `legacy: уточнити`, власник дописує після імпорту | — |
| Q10 | Номери договорів з ФОП Езерович і Доліна | `OD-1002` і `OD-1003` за аналогією з `OD-1001`; дати — з аркуша `Акт Езерович` або заповнює власник | Етап 3 |
| Q11 | Акт датується кінцем місяця роботи, а сума в UAH відома лише в день виплати (часто в наступному місяці). Чи це ок для бухгалтера? | Так, як у рішенні D9; акт випускається в день виплати заднім числом | — |
| Q12 | Проживання Berlin позначене «No», але сума збігається з актом `1003 - А6` | Компенсовано цим актом; прапорець в таблиці — помилка | — |
| Q13 | Чи є Google Workspace з підтримкою Shared Drives | Так; якщо ні — `STORAGE_DRIVER=local` до рішення | Етап 1 (Drive) |
| Q14 | Формат нових номерів актів | Як зараз (`1001 - А13`), без нормалізації видимого формату | — |
| Q15 | USDT/USDC у звітах = 1 USD | Так, без депег-коригувань у v1 | — |
| Q16 | Через кого виплачується Andrii (IdeaSoft, fiat) — у реєстрі актів його немає | `payee` типу `other` без актів | — |

## 13. MCP-доступ для агентів

Система має віддалений MCP-сервер `/api/mcp`, через який AI-агент (Claude, Claude Code, Cowork тощо) читає дані і вносить частину записів від імені власника. Агент ніколи не випускає документи, не закриває періоди і не проводить виплати; усе, що змінює гроші, він лише пропонує, а застосовує людина в UI.

### 13.1 Архітектура

- **Сервісний шар — єдина точка мутацій (MUST, з етапу 0).** Бізнес-операції живуть у `apps/web/server/services/*` як функції `(ctx, input) → result` зі схемами Zod. Server Actions і MCP-tools — тонкі адаптери над ними. Логіка всередині Server Action заборонена — інакше MCP доведеться дублювати валідації.
- **Транспорт:** офіційний TypeScript SDK MCP, ім'я сервера — tally, адреса в production — https://tally.syntora.tech/api/mcp, Streamable HTTP у stateless-режимі (без сесій), тому працює у Vercel Functions як звичайний route handler.
- **Авторизація:** Supabase Auth у ролі OAuth 2.1 authorization server; він видає метадані на `/.well-known/oauth-authorization-server` і відповідає MCP-специфікації авторизації ([Supabase](https://supabase.com/blog/oauth2-provider)). Наш `/api/mcp` — resource server: публікує `/.well-known/oauth-protected-resource` (RFC 9728) і відповідає 401 з `WWW-Authenticate`, якщо токена немає. Dynamic client registration увімкнена, щоб клієнти реєструвалися самі ([docs](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)).
- **Екран згоди** хостить наш додаток (`/oauth/consent`), не Supabase: там власник бачить назву клієнта і обирає профіль доступу (13.3).
- **Токен = користувач.** Аксес-токени — звичайні JWT Supabase з `user_id`, `role` і `client_id` ([docs](https://supabase.com/docs/guides/auth/oauth-server)). MCP-хендлер перевіряє підпис через JWKS і викликає сервіси через `withUser()` з цими claims, тобто RLS працює так само, як для UI.
- **Ефективні права = роль користувача ∩ профіль клієнта** з таблиці `mcp_client_policy`, яка перевіряється на кожному виклику. Вимкнений клієнт втрачає доступ одразу, не чекаючи закінчення терміну токена.

```mermaid
sequenceDiagram
  participant C as MCP-клієнт (Claude)
  participant M as /api/mcp (Vercel)
  participant S as Supabase Auth
  participant U as Власник (/oauth/consent)
  participant DB as Postgres
  C->>M: tools/list без токена
  M-->>C: 401 + WWW-Authenticate (resource metadata)
  C->>S: discovery, dynamic client registration, authorize (PKCE)
  S->>U: екран згоди: клієнт + профіль доступу
  U->>DB: mcp_client_policy(client_id, profile)
  S-->>C: access token (JWT: user_id, client_id)
  C->>M: tools/call set_timesheet_hours
  M->>DB: перевірка policy → withUser(claims) → service → audit(via=mcp)
  M-->>C: результат
```

### 13.2 Три класи дій

| Клас | Що відбувається | Коли застосовується |
| --- | --- | --- |
| **read** | Повертає дані в межах RLS; чутливі поля (ІПН, IBAN, адреси гаманців) завжди маскуються | Для аналізу, звітів, підготовки входу для запису |
| **write** | Записує одразу, з audit `via = mcp` і `client_id` | Лише низькоризикові дані, які легко виправити і які ще не стали документом |
| **propose** | Створює `change_request` зі статусом `pending` і прев'ю змін; людина застосовує або відхиляє в UI «Вхідні від агентів» | Усе, що змінює гроші, умови або контрагентів |

Застосування `change_request` викликає той самий сервіс уже від імені людини, тому всі інваріанти I1–I10 діють без винятків. Перед застосуванням прев'ю перераховується: якщо дані змінилися, людина бачить diff.

### 13.3 Перелік tools v1

| Tool | Клас | Що робить |
| --- | --- | --- |
| `search_people`, `get_person` | read | Bench-фільтри з 6.2, картка людини без payee |
| `list_assignments` | read | Активні залучення з умовами на дату |
| `get_period_overview` | read | Прев'ю місяця у форматі `Current` (6.4, крок 3) |
| `list_invoices`, `get_receivables` | read | Інвойси, статуси, прострочки |
| `get_payroll_queue` | read | Черга виплат і дедлайни (суми без реквізитів) |
| `get_balances`, `list_transactions` | read | Залишки та журнал Ledger з фільтрами |
| `list_trips`, `get_trip`, `search_documents` | read | Поїздки з підсумками, реєстр документів |
| `set_timesheet_hours` | write | Години за assignment × місяць; лише відкритий період (I6) |
| `upsert_person_profile` | write | Поля Bench (стек, сеньйорність, доступність, ринкова ставка); без payee і умов |
| `create_trip`, `add_trip_expense` | write | Поїздка та витрата з чеком; курс — НБУ або переданий |
| `add_document` | write | Файл або посилання в реєстр + прив'язки (CV, NDA, SOW) |
| `propose_transactions` | propose | Одна або пакет транзакцій (розбір виписки, до 500 рядків) з дедуплікацією за `external_ref` |
| `propose_allocation` | propose | Прив'язати надходження до інвойсу (розблоковує ЗП лише після застосування) |
| `propose_adjustment` | propose | Бонус, утримання, компенсація з причиною |
| `propose_client`, `propose_contract`, `propose_terms_change` | propose | Новий клієнт/контракт, нова версія `billing_terms`/`pay_terms` |

**Не виставляються в MCP взагалі** (немає в `tools/list` за будь-якого профілю): випуск і анулювання інвойсів та актів, закриття й відкриття періоду, фіксація виплати та курсу, будь-яке видалення, реквізити payee, послідовності номерів, календар, користувачі та ролі, Settings.

**Профілі доступу**, що обираються на екрані згоди та змінюються в Settings: `read_only` (дефолт), `assistant` (read + write + propose), `custom` (галочки по групах tools).

### 13.4 Правила для кожного tool (MUST)

1. Вхідна схема — та сама Zod-схема сервісу, експортована в JSON Schema; описи полів — англійською, з одиницями та форматами (`amount` — рядок-децимал, дати ISO).
2. Кожен write/propose приймає обов'язковий `idempotency_key`; повторний виклик з тим самим ключем повертає перший результат (таблиця `mcp_idempotency`, TTL 7 днів).
3. Кожен write/propose підтримує `dry_run: true` — повертає прев'ю без запису.
4. MCP-анотації: `readOnlyHint` для read; `destructiveHint: false` і `idempotentHint: true` для write/propose.
5. Помилки бізнес-правил (закритий період, невідомий assignment) повертаються як `isError` з кодом і підказкою, щоб агент міг виправитися.
6. Вільний текст з БД у відповідях (описи транзакцій, нотатки) повертається як дані у структурованих полях, не вклеюється в текст опису tool.
7. Файли (чеки, CV, виписки) — `content_base64` до 5 MB + `mime_type`; завантаження з довільних URL сервером заборонене (SSRF).
8. Ліміти на клієнта: 120 read і 30 write/propose за хвилину; перевищення → `isError` з `retry_after`.

### 13.5 Дані та audit

```sql
mcp_client_policy(client_id text pk, user_id uuid, client_name, profile text check in ('read_only','assistant','custom'),
                  allowed_tools text[] null, is_active bool, last_used_at timestamptz)
change_request(id uuid pk, client_id, user_id, tool text, payload jsonb, preview jsonb,
               status text check in ('pending','applied','rejected','stale'), decided_by uuid null, decided_at null,
               result_ref jsonb null, reason text null)
mcp_idempotency(client_id, key text, response jsonb, created_at, primary key(client_id, key))
mcp_call_log(id bigserial, client_id, user_id, tool, args_hash, outcome, duration_ms, at)
```

`withUser()` для MCP-викликів додатково робить `set local app.via = 'mcp'` і `set local app.client_id = '<id>'`; audit-тригер (I8) пише ці значення в `audit_log`. У картці будь-якого запису видно бейдж «внесено агентом <назва клієнта>». `mcp_call_log` зберігає хеш аргументів, а не самі аргументи.

### 13.6 UI та критерії приймання

- Settings → «Підключені агенти»: список клієнтів, профіль, останнє використання, кнопка «Відкликати», журнал викликів.
- «Вхідні від агентів»: черга `change_request` з прев'ю, масове застосування для пакетів транзакцій, лічильник на Dashboard.

AC:

- Claude підключається як custom connector за URL `/api/mcp`, проходить OAuth і бачить лише tools свого профілю; те саме працює з Claude Code локально.
- Заборонені дії з 13.3 відсутні в `tools/list` у будь-якому профілі.
- `set_timesheet_hours` у закритому періоді → `isError`, у БД нічого не змінилося.
- `propose_transactions` з тим самим `idempotency_key` двічі → один `change_request`; до застосування залишки на Dashboard не змінюються.
- Після «Відкликати» наступний виклик клієнта отримує 403, навіть з чинним токеном.
- У `audit_log` для запису від агента є `via = mcp` і `client_id`; ІПН та IBAN не повертаються жодним read-tool.
- Тести: контрактні тести кожного tool через in-memory MCP-клієнт SDK; ручна перевірка через MCP Inspector.

### 13.7 Відкриті питання MCP

| # | Питання | Припущення |
| --- | --- | --- |
| Q17 | Які дані агент має вносити першими | Години, витрати поїздок з чеками, розбір банківських виписок у propose |
| Q18 | Чи доступний OAuth 2.1 server на тарифі Supabase Free | Перевірити на етапі 7; якщо ні — тимчасово personal access token у заголовку (хеш у БД, ті самі профілі) |
| Q19 | Чи потрібні агенти без людини (нічний скрипт без браузера) | Ні в v1; для них знадобиться client credentials або PAT |
