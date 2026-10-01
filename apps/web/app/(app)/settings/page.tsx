import { headers } from 'next/headers';
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

const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'] as const;

const DATE_TIME = new Intl.DateTimeFormat('uk-UA', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Kyiv',
});

export const generateMetadata = pageTitle('settings');

export default async function SettingsPage() {
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
