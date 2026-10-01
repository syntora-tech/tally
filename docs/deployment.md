# Деплой: GitHub, Supabase, Vercel

Середовища — за розділом 2.2 специфікації: `preview` (Vercel Hobby + окремий Supabase Free, лише тестові дані) і `production` (Vercel Pro + Supabase, реальні дані; вмикається на Етапі 6). Реальні дані на Vercel Hobby не завантажуються (D5, 2.3).

## 1. GitHub (`syntora-tech/tally`)

**Branch protection** (Settings → Branches → `main`):

- Require a pull request before merging.
- Require status checks: `Lint, typecheck, unit tests` і `DB tests and Playwright smoke` (з `ci.yml`).

**Environments** (Settings → Environments): створити `preview` і `production`. Для `production` — Required reviewers: власники.

| Де                       | Назва                                          | Тип      | Значення                                                      |
| ------------------------ | ---------------------------------------------- | -------- | ------------------------------------------------------------- |
| Repository secrets       | `SUPABASE_ACCESS_TOKEN`                        | secret   | Personal access token: supabase.com → Account → Access Tokens |
| Environment `preview`    | `SUPABASE_PROJECT_REF`                         | variable | Reference ID preview-проєкту (Project Settings → General)     |
| Environment `preview`    | `SUPABASE_DB_PASSWORD`                         | secret   | Пароль БД preview-проєкту                                     |
| Environment `production` | `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` | —        | Те саме для production (Етап 6)                               |

**Workflows:**

- `ci.yml` — на кожен PR і push у `main`.
- `migrate.yml` — на push у `main` зі змінами в `supabase/migrations/`: спершу `preview`, потім `production`. Середовище без налаштованих змінних пропускається з notice. Ручний запуск: Actions → Migrate → Run workflow → вибрати середовище.
- `backup.yml` — Етап 6.

Міграції мають бути зворотно сумісними (expand → migrate → contract): Vercel деплоїть той самий коміт паралельно з `migrate.yml`.

## 2. Supabase: preview-проєкт

1. New project `tally-preview`, регіон Frankfurt (`eu-central-1`), зберегти пароль БД.
2. **Authentication → URL Configuration:**
   - Site URL — адреса preview-деплою Vercel (після кроку 3.4).
   - Redirect URLs: `https://*-<vercel-team-slug>.vercel.app/auth/callback` і `http://localhost:3000/auth/callback`.
3. **Authentication → Sign In / Providers → Email:** увімкнено; sign-ups не вимикати — whitelist перевіряє сам застосунок (`ALLOWED_EMAILS`, `app_user`).
4. **Пошта для magic link.** Вбудований SMTP Supabase надсилає листи лише адресам членів команди організації в Supabase і має жорсткий ліміт на годину. Варіанти: додати обох власників у команду організації або підключити власний SMTP (Authentication → Emails → SMTP Settings).
5. **Google OAuth** (коли будуть ключі): Authentication → Providers → Google; у Google Console redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`; у Vercel — `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true`.
6. Застосувати міграції: Actions → Migrate → Run workflow → `preview` (після налаштування секретів з розділу 1).

## 3. Vercel

1. Add New → Project → Import `syntora-tech/tally`.
2. **Root Directory:** `apps/web` (галочка «Include files outside the root directory» — увімкнена, потрібна для `packages/*`). Framework: Next.js; команди install/build — за замовчуванням.
3. **Settings → Build and Deployment → Node.js Version:** 24.x (також зафіксовано в `engines`).
4. **Environment Variables** — для «Production and Preview». Vercel вважає Production кожен деплой гілки `main`, тому на Hobby-проєкті його «Production» — це наше середовище `preview` (2.2): усі змінні вказують на preview-проєкт Supabase, дані лише тестові. Справжній production — окремий Vercel Pro проєкт на Етапі 6.

| Змінна                            | Значення                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `ENABLE_EXPERIMENTAL_COREPACK`    | `1` — щоб Vercel використав pnpm з поля `packageManager` (pnpm 12)                            |
| `DATABASE_URL`                    | Supabase → Connect → **Transaction pooler** (порт 6543)                                       |
| `NEXT_PUBLIC_SUPABASE_URL`        | `https://<project-ref>.supabase.co`                                                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Publishable / anon key                                                                        |
| `ALLOWED_EMAILS`                  | email-и власників через кому                                                                  |
| `CRON_SECRET`                     | випадковий рядок ≥ 32 символів (`openssl rand -hex 32`)                                       |
| `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED` | `false` до появи ключів                                                                       |
| `STORAGE_DRIVER`                  | `drive` (файлова система Vercel недовговічна; документи — з Етапу 1 після налаштування Drive) |
| `GOOGLE_TEMPLATE_*_ID`            | ID шаблонів Google Docs: `INVOICE_HOURLY`, `INVOICE_FIXED`, `ACT_FOP` (7.2)                   |

`SUPABASE_SERVICE_ROLE_KEY` поки не потрібен і ніколи не має префікса `NEXT_PUBLIC_`. `APP_TODAY` у Vercel не задається.

5. Після першого деплою вписати його URL як Site URL у Supabase (крок 2.2) і відкрити `/login`.

**Обмеження Hobby:** якщо Vercel не дозволить імпортувати приватний репозиторій організації на Hobby, це обмеження тарифу — тоді або Pro раніше, або деплой з особистого акаунта власника.

## 4. Фонові задачі (pg_cron, 10.4)

Розклад створює міграція `cron_schedules`: `tally-jobs` щохвилини (рендер документів), `tally-nbu-rates` о 07:00 UTC, `tally-payability` о 03:00 UTC. Кожна задача робить `POST <URL>/api/cron/<name>` з `Authorization: Bearer <CRON_SECRET>`. Поки в Vault немає двох секретів, виклики нічого не роблять.

Для кожного Supabase-проєкту один раз виконати в SQL Editor:

```sql
select vault.create_secret('https://<vercel-url>', 'tally_app_url');
select vault.create_secret('<той самий CRON_SECRET, що у Vercel>', 'tally_cron_secret');
```

Перевірка: `select * from cron.job_run_details order by start_time desc limit 5;` і `select * from net._http_response order by created desc limit 5;` — відповідь 200. Змінити секрет: `select vault.update_secret((select id from vault.secrets where name = 'tally_cron_secret'), '<новий>');`.

## 5. Production (Етап 6)

Vercel Pro, окремий Supabase-проєкт, домен `tally.syntora.tech` (CNAME на Vercel, Site URL і Redirect URLs у Supabase, redirect URI у Google OAuth), environment `production` у GitHub, `backup.yml`, перевірка відновлення — за чеклістом Етапу 6 у специфікації.
