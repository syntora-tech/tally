import { headers } from 'next/headers';
import { AutoRefresh } from '@/components/auto-refresh';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OWNER_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { isoDayOfWeek, type LocalDate } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
import { getCompany } from '@/server/services/company';
import { listMcpCalls, listMcpClients } from '@/server/services/mcp';
import { listCalendarExceptions, listJobs, listSequences } from '@/server/services/settings';
import { CompanyForm } from './company-form';
import { CreateMcpClientForm, RevokeMcpClientButton } from './mcp-forms';
import { CalendarExceptionForm, DeleteExceptionButton, SequenceForm } from './settings-forms';
import { getFormat, pageTitle } from '@/server/i18n';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';
import { TabsNav } from '@/components/v2/tabs-nav';
import { DialogButton } from '@/components/v2/form-dialog';
import { Panel } from '@/components/v2/panel';
import { Status } from '@/components/v2/status';
import { cn } from 'cn';

const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'] as const;

const DATE_TIME = new Intl.DateTimeFormat('uk-UA', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Kyiv',
});

export const generateMetadata = pageTitle('settings');

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireRole(OWNER_ROLES);
  const result = await getCompany.run(ctx, {});
  const company = result.isOk() ? result.value : null;
  const exceptions = (await listCalendarExceptions.run(ctx, {})).unwrapOr([]);
  const sequences = (await listSequences.run(ctx, {})).unwrapOr([]);
  const thisYear = ctx.today.slice(0, 4);
  const jobs = (await listJobs.run(ctx, {})).unwrapOr([]);
  const mcpClients = (await listMcpClients.run(ctx, {})).unwrapOr([]);
  const mcpCalls = (await listMcpCalls.run(ctx, { limit: 20 })).unwrapOr([]);
  const clientNames = new Map(mcpClients.map((c) => [c.clientId, c.clientName]));
  const h = await headers();
  const mcpUrl = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}/api/mcp`;
  const t = await getTranslations('settings');
  const fmt = await getFormat();
  const jobStatus = (s: string) =>
    (JOB_STATUSES as readonly string[]).includes(s)
      ? t(`jobStatus.${s as (typeof JOB_STATUSES)[number]}`)
      : s;

  const v2 = (await getUiPrefs()).version === 'v2';
  const SECTIONS = ['company', 'calendar', 'numbering', 'jobs', 'agents'] as const;
  const requested = (await searchParams).tab;
  const tab = SECTIONS.find((k) => k === requested) ?? 'company';
  if (v2) {
    const tc = await getTranslations('common');
    const head = (title: string) => (
      <th className="px-5 py-2.5 text-left font-normal first:pl-5">{title}</th>
    );
    const body = {
      company: (
        <Panel title={t('company')} help={t('companyDescription')} helpLabel={tc('help')}>
          <div data-form-card>
            <CompanyForm
              company={
                company && {
                  nameEn: company.nameEn,
                  nameUa: company.nameUa,
                  legalCode: company.legalCode,
                  addressEn: company.addressEn,
                  addressUa: company.addressUa,
                  directorEn: company.directorEn,
                  directorUa: company.directorUa,
                  bankDetailsEn: company.bankDetailsEn,
                  bankDetailsUa: company.bankDetailsUa,
                }
              }
            />
          </div>
        </Panel>
      ),
      calendar: (
        <Panel
          title={t('calendar')}
          help={t('calendarDescription')}
          helpLabel={tc('help')}
          flush
          action={
            <DialogButton
              variant="outline"
              title={t('v2.newException')}
              content={<CalendarExceptionForm />}
            >
              + {t('v2.newException')}
            </DialogButton>
          }
        >
          {exceptions.length === 0 ? (
            <p className="px-5 py-4 text-muted-foreground">{t('noExceptions')}</p>
          ) : (
            <table className="w-full min-w-[32rem] text-sm">
              <tbody>
                {exceptions.map((e) => (
                  <tr
                    key={e.onDate}
                    className={cn(
                      'border-t first:border-t-0',
                      !e.onDate.startsWith(thisYear) && 'text-muted-foreground',
                    )}
                  >
                    <td className="px-5 py-2.5 whitespace-nowrap tabular-nums">
                      {fmt.date(e.onDate)},{' '}
                      {t(`weekdays.${WEEKDAYS[isoDayOfWeek(e.onDate as LocalDate) - 1] ?? '1'}`)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Status tone={e.isWorking ? 'info' : 'neutral'}>
                        {e.isWorking ? t('working') : t('dayOff')}
                      </Status>
                    </td>
                    <td className="w-full px-3 py-2.5">{e.reason}</td>
                    <td className="px-5 py-1.5 text-right">
                      <DeleteExceptionButton onDate={e.onDate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ),
      numbering: (
        <Panel
          title={t('numbering')}
          help={t('numberingDescription')}
          helpLabel={tc('help')}
          flush
          action={
            <DialogButton variant="outline" title={t('newSequence')} content={<SequenceForm />}>
              + {t('newSequence')}
            </DialogButton>
          }
        >
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {head(t('v2.sequence'))}
                <th className="px-3 py-2.5 text-left font-normal">{t('v2.template')}</th>
                <th className="px-3 py-2.5 text-left font-normal">{t('v2.nextNumber')}</th>
                <th className="px-3 py-2.5 text-left font-normal">{t('v2.usedBy')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sequences.map((s) => (
                <tr key={s.key} className="border-t">
                  <td className="px-5 py-2.5 font-medium">{s.key}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{s.template}</td>
                  <td className="px-3 py-2.5 font-semibold tabular-nums">{s.nextNumber}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {[s.contracts.join(', '), s.key === 'invoice' ? t('v2.defaultInvoices') : null]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  <td className="px-5 py-1.5 text-right">
                    <DialogButton
                      variant="outline"
                      title={s.key}
                      content={
                        <SequenceForm
                          sequence={{
                            key: s.key,
                            template: s.template,
                            nextValue: s.nextValue,
                            yearScoped: s.yearScoped,
                          }}
                        />
                      }
                    >
                      {tc('edit')}
                    </DialogButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ),
      jobs: (
        <Panel title={t('jobs')} help={t('jobsDescription')} helpLabel={tc('help')} flush>
          {jobs.some((j) => j.status === 'queued' || j.status === 'running') && <AutoRefresh />}
          {jobs.length === 0 ? (
            <p className="px-5 py-4 text-muted-foreground">{t('noJobs')}</p>
          ) : (
            <table className="w-full min-w-[36rem] text-sm">
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-t first:border-t-0">
                    <td className="px-5 py-2.5 whitespace-nowrap text-muted-foreground tabular-nums">
                      {DATE_TIME.format(j.createdAt)}
                    </td>
                    <td className="px-3 py-2.5">{j.kind}</td>
                    <td className="px-3 py-2.5">
                      <Status
                        tone={
                          j.status === 'done'
                            ? 'success'
                            : j.status === 'failed'
                              ? 'danger'
                              : 'info'
                        }
                      >
                        {jobStatus(j.status)}
                        {j.attempts > 1 ? ` (${String(j.attempts)})` : ''}
                      </Status>
                    </td>
                    <td className="w-full px-5 py-2.5 text-danger-foreground">{j.lastError}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ),
      agents: (
        <div className="flex flex-col gap-5">
          <Panel
            title={t('agents')}
            help={t('agentsDescription', { url: mcpUrl })}
            helpLabel={tc('help')}
          >
            <CreateMcpClientForm mcpUrl={mcpUrl} />
            {mcpClients.length === 0 ? (
              <p className="text-muted-foreground">{t('noAgents')}</p>
            ) : (
              <ul className="-mx-5 -mb-4 flex flex-col divide-y border-t">
                {mcpClients.map((c) => (
                  <li
                    key={c.clientId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5"
                  >
                    <span
                      className={cn(
                        'font-medium',
                        !c.isActive && 'text-muted-foreground line-through',
                      )}
                    >
                      {c.clientName}
                    </span>
                    <Status>
                      {t(
                        `profile.${c.profile === 'assistant' || c.profile === 'custom' ? c.profile : 'read_only'}`,
                      )}
                    </Status>
                    <span className="font-mono text-xs text-muted-foreground">…{c.tokenHint}</span>
                    <span className="flex-1 text-xs text-muted-foreground">
                      {c.lastUsedAt
                        ? t('lastCall', { date: DATE_TIME.format(c.lastUsedAt) })
                        : t('neverUsed')}
                    </span>
                    {c.isActive ? (
                      <RevokeMcpClientButton clientId={c.clientId} />
                    ) : (
                      <Status>{t('revoked')}</Status>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {mcpCalls.length > 0 && (
            <Panel title={t('recentCalls')} flush>
              <table className="w-full min-w-[36rem] text-sm">
                <tbody>
                  {mcpCalls.map((call) => (
                    <tr key={String(call.id)} className="border-t first:border-t-0">
                      <td className="px-5 py-2 whitespace-nowrap text-muted-foreground tabular-nums">
                        {DATE_TIME.format(call.at)}
                      </td>
                      <td className="px-3 py-2">
                        {clientNames.get(call.clientId) ?? call.clientId}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{call.tool}</td>
                      <td className="px-5 py-2">
                        {call.outcome === 'ok' ? (
                          <Status tone="success">{t('callOk')}</Status>
                        ) : (
                          <Status tone="danger">{call.outcome}</Status>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      ),
    }[tab];
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('title')} help={t('footer')} />
        <TabsNav
          label={t('title')}
          active={tab}
          tabs={SECTIONS.map((k) => ({ key: k, label: t(k), href: `/settings?tab=${k}` }))}
        />
        {body}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('company')}</CardTitle>
          <CardDescription>{t('companyDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyForm
            company={
              company && {
                nameEn: company.nameEn,
                nameUa: company.nameUa,
                legalCode: company.legalCode,
                addressEn: company.addressEn,
                addressUa: company.addressUa,
                directorEn: company.directorEn,
                directorUa: company.directorUa,
                bankDetailsEn: company.bankDetailsEn,
                bankDetailsUa: company.bankDetailsUa,
              }
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('calendar')}</CardTitle>
          <CardDescription>{t('calendarDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CalendarExceptionForm />
          {exceptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noExceptions')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {exceptions.map((e) => (
                <li
                  key={e.onDate}
                  className={`flex items-center gap-3 ${e.onDate.startsWith(thisYear) ? '' : 'text-muted-foreground'}`}
                >
                  <span className="w-32 tabular-nums">
                    {fmt.date(e.onDate)},{' '}
                    {t(`weekdays.${WEEKDAYS[isoDayOfWeek(e.onDate as LocalDate) - 1] ?? '1'}`)}
                  </span>
                  <span className="w-24">{e.isWorking ? t('working') : t('dayOff')}</span>
                  <span className="flex-1">{e.reason}</span>
                  <DeleteExceptionButton onDate={e.onDate} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('numbering')}</CardTitle>
          <CardDescription>{t('numberingDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {sequences.map((s) => (
            <div key={s.key} className="flex flex-col gap-2 border-b pb-4">
              <div className="text-sm">
                <span className="font-medium">{s.key}</span>
                <span className="text-muted-foreground">
                  {' '}
                  {t('next')}
                  <span className="text-foreground">{s.nextNumber}</span>
                  {s.contracts.length > 0 && t('contracts', { list: s.contracts.join(', ') })}
                  {s.key === 'invoice' && t('defaultForInvoices')}
                </span>
              </div>
              <SequenceForm
                sequence={{
                  key: s.key,
                  template: s.template,
                  nextValue: s.nextValue,
                  yearScoped: s.yearScoped,
                }}
              />
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium">{t('newSequence')}</div>
            <SequenceForm />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('jobs')}</CardTitle>
          <CardDescription>{t('jobsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.some((j) => j.status === 'queued' || j.status === 'running') && <AutoRefresh />}
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noJobs')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap gap-x-3">
                  <span className="w-36 tabular-nums text-muted-foreground">
                    {DATE_TIME.format(j.createdAt)}
                  </span>
                  <span className="w-32">{j.kind}</span>
                  <span className="w-28">
                    {jobStatus(j.status)}
                    {j.attempts > 1 ? ` (${String(j.attempts)})` : ''}
                  </span>
                  {j.lastError && <span className="text-destructive">{j.lastError}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('agents')}</CardTitle>
          <CardDescription>{t('agentsDescription', { url: mcpUrl })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CreateMcpClientForm mcpUrl={mcpUrl} />
          {mcpClients.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noAgents')}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {mcpClients.map((c) => (
                <li key={c.clientId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    className={`w-56 font-medium ${c.isActive ? '' : 'text-muted-foreground line-through'}`}
                  >
                    {c.clientName}
                  </span>
                  <Badge variant="outline">
                    {t(
                      `profile.${c.profile === 'assistant' || c.profile === 'custom' ? c.profile : 'read_only'}`,
                    )}
                  </Badge>
                  <span className="text-muted-foreground">…{c.tokenHint}</span>
                  <span className="text-muted-foreground">
                    {c.lastUsedAt
                      ? t('lastCall', { date: DATE_TIME.format(c.lastUsedAt) })
                      : t('neverUsed')}
                  </span>
                  {c.isActive ? (
                    <RevokeMcpClientButton clientId={c.clientId} />
                  ) : (
                    <span className="text-muted-foreground">{t('revoked')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {mcpCalls.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">{t('recentCalls')}</div>
              <ul className="flex flex-col gap-1 text-sm">
                {mcpCalls.map((call) => (
                  <li key={String(call.id)} className="flex flex-wrap gap-x-3">
                    <span className="w-36 tabular-nums text-muted-foreground">
                      {DATE_TIME.format(call.at)}
                    </span>
                    <span className="w-48">{clientNames.get(call.clientId) ?? call.clientId}</span>
                    <span className="w-40">{call.tool}</span>
                    <span className={call.outcome === 'ok' ? '' : 'text-destructive'}>
                      {call.outcome === 'ok' ? t('callOk') : call.outcome}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">{t('footer')}</p>
    </div>
  );
}
