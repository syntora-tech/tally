import { sum, toDecimal } from '@tally/domain';
import type { Result } from 'neverthrow';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { DialogButton, OpenedDialog, RowMenu, type MenuEntry } from '@/components/v2/form-dialog';
import { HelpTip } from '@/components/v2/help-tip';
import { MonthStepper } from '@/components/v2/month-stepper';
import { PageHeader } from '@/components/v2/page-header';
import { ExpandableRow } from '@/components/v2/expandable-row';
import { Status, type Tone } from '@/components/v2/status';
import { Steps } from '@/components/v2/steps';
import { TabsNav } from '@/components/v2/tabs-nav';
import { getFormat, getLabels } from '@/server/i18n';
import type { listPayroll, PayrollGroup } from '@/server/services/payroll';
import type { listPlannedPayments } from '@/server/services/planned/payments';
import { PaymentActions } from '../ledger/planned/planned-forms';
import { DraftContractorInvoiceButton } from './contractor-invoices/contractor-invoice-forms';
import {
  AdjustClosedForm,
  ChangeMethodForm,
  MergeActsButton,
  OverrideForm,
  PayDialog,
  RateForm,
  RemoveLineForm,
  SplitActForm,
  type PayDialogProps,
} from './payroll-forms';

type OkOf<T> = T extends Result<infer V, unknown> ? V : never;
export type PayrollRow = OkOf<Awaited<ReturnType<typeof listPayroll.run>>>[number];
type Act = PayrollRow['acts'][number];
type Planned = OkOf<Awaited<ReturnType<typeof listPlannedPayments.run>>>[number];
type ContractorInvoice = {
  id: string;
  payrollItemId: string | null;
  number: string | null;
  amount: string;
  currency: string;
  status: string;
  signedAt: unknown;
};
type Activity = { id: string; kind: 'line' | 'adjustment'; label: string };
type Account = { id: string; currency: string; label: string };

export type PayrollV2Props = {
  items: PayrollRow[];
  months: { id: string; month: string }[];
  periodId: string;
  tab: string | undefined;
  /** `?pay=<item>&tx=<transaction>` from a Ledger row: that payout's dialog opens on load. */
  linkPay: { itemId: string; transactionId: string } | null;
  isOwner: boolean;
  today: string;
  contractorInvoices: ContractorInvoice[];
  accountRows: Account[];
  suggestion: { rate: string; source: string } | null;
  billable: (i: PayrollRow) => boolean;
  documentOf: (i: PayrollRow) => PayDialogProps['document'];
  nextStep: (i: PayrollRow) => 'issue' | 'sign' | 'pay';
  candidatesFor: (i: PayrollRow) => PayDialogProps['candidates'];
  activitiesIn: (i: PayrollRow, a: Act) => Activity[];
  splitsByAmount: (i: PayrollRow, a: Act) => boolean;
  payAccounts: (fiat: boolean) => { id: string; label: string }[];
  salaryGroups: { key: string; personName: string | null; month: string; rows: Planned[] }[];
  chargesOf: (id: string) => Planned[];
  salaryCandidates: (currency: string) => { id: string; label: string }[];
};

const GROUPS: PayrollGroup[] = ['ready', 'waiting', 'paid'];
const LINE_TONES: Record<string, Tone> = {
  accrued: 'neutral',
  awaiting_client: 'warning',
  payable: 'info',
  paid: 'success',
};
const STEP_INDEX = { issue: 0, sign: 1, pay: 2 } as const;

const initials = (name: string) =>
  name
    .replace(/^ФОП\s+/u, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export async function PayrollV2(p: PayrollV2Props) {
  const [t, tp, tci, tc, fmt, labels] = await Promise.all([
    getTranslations('payroll'),
    getTranslations('payDialog'),
    getTranslations('contractorInvoice'),
    getTranslations('common'),
    getFormat(),
    getLabels(),
  ]);
  const { ADJUSTMENT_KIND_LABELS, FX_SOURCE_LABELS, PAYOUT_METHOD_LABELS } = labels;
  const { items } = p;
  const query = (period: string, tab?: string) =>
    `/payroll?period=${period || 'all'}${tab ? `&tab=${tab}` : ''}`;

  // Acts paid on their own while the rest of their payout is still open (A-085).
  const paidParts = items
    .filter((i) => i.group !== 'paid')
    .flatMap((i) => i.acts.filter((a) => a.rateLocked && !a.isRest).map((a) => ({ i, a })));
  const counts: Record<PayrollGroup, number> = {
    ready: items.filter((i) => i.group === 'ready').length,
    waiting: items.filter((i) => i.group === 'waiting').length,
    paid: items.filter((i) => i.group === 'paid').length + paidParts.length,
  };
  const linked = p.linkPay ? items.find((i) => i.item.id === p.linkPay?.itemId) : undefined;
  const tab: PayrollGroup =
    GROUPS.find((g) => g === p.tab) ??
    GROUPS.find((g) => g !== 'paid' && g === linked?.group) ??
    GROUPS.find((g) => counts[g] > 0) ??
    'ready';
  const rows = items.filter((i) => i.group === tab);

  const amountOf = (i: PayrollRow) => {
    const fiat = i.item.payoutMethod === 'fiat';
    const main = fiat ? i.item.totalUah : i.item.totalUsd;
    return { main, currency: fiat ? 'UAH' : 'USD' };
  };
  const totals = new Map<string, string[]>();
  for (const i of rows) {
    const { main, currency } = amountOf(i);
    if (main === null) continue;
    totals.set(currency, [...(totals.get(currency) ?? []), main]);
  }
  const totalText = [...totals.entries()]
    .map(([currency, amounts]) => fmt.amount(sum(amounts).toFixed(2), currency))
    .join(' · ');

  const nameOf = (i: PayrollRow) =>
    i.item.kind === 'agency'
      ? t('agencyTitle', { payee: i.payeeName ?? '' })
      : (i.personName ?? t('noPayee'));
  const actLabel = (a: Act) =>
    a.number ??
    (a.periodFrom && a.periodTo
      ? `${fmt.date(a.periodFrom)}–${fmt.date(a.periodTo)}`
      : tp('draftAct'));
  const actState = (i: PayrollRow, a: Act): { tone: Tone; label: string } =>
    i.group === 'paid' || (a.rateLocked && !a.isRest)
      ? { tone: 'success', label: t('v2.actStatus.paid') }
      : a.status === 'draft'
        ? { tone: 'neutral', label: t('v2.actStatus.draft') }
        : a.signed
          ? { tone: 'info', label: t('v2.actStatus.signed') }
          : { tone: 'warning', label: t('v2.actStatus.unsigned') };

  const payDialog = (i: PayrollRow, defaultTransactionId?: string) => {
    const fiat = i.item.payoutMethod === 'fiat';
    return (
      <PayDialog
        itemId={i.item.id}
        fiat={fiat}
        today={p.today}
        lines={i.lines.map((l) => ({ amount: l.amount, currency: l.currency }))}
        adjustments={i.adjustments.map((a) => ({ amount: a.amount, currency: a.currency }))}
        currentRate={i.item.payoutFxRate}
        currentSource={i.item.fxSource}
        suggestion={p.suggestion}
        remaining={i.remaining}
        isOwner={p.isOwner}
        candidates={p.candidatesFor(i)}
        defaultTransactionId={defaultTransactionId}
        fee={i.payeeFee}
        hasAct={i.acts.length > 0}
        payableActs={i.acts
          .filter((a) => !a.isRest && !a.rateLocked)
          .map((a) => ({
            id: a.id,
            amount: a.amountUah,
            label: `${a.number ?? tp('draftAct')} · ${fmt.amount(a.amountUah, 'UAH')}`,
          }))}
        feeAccounts={p.accountRows}
        document={p.documentOf(i)}
        accounts={p.payAccounts(fiat)}
      />
    );
  };

  const primaryAction = (i: PayrollRow) => {
    if (i.group === 'paid') return null;
    const step = p.nextStep(i);
    const doc = p.documentOf(i);
    const ci = p.contractorInvoices.find((x) => x.payrollItemId === i.item.id);
    if (step === 'pay' || !doc) {
      return (
        <DialogButton
          title={`${tp('pay')}: ${nameOf(i)}`}
          content={payDialog(i)}
          variant={i.group === 'ready' ? 'default' : 'outline'}
          className="min-w-32"
          testId="pay"
        >
          {t('v2.cta.pay')}
        </DialogButton>
      );
    }
    if (doc.kind === 'invoice') {
      if (!ci) return <DraftContractorInvoiceButton payrollItemId={i.item.id} />;
      return (
        <Button
          size="sm"
          variant="outline"
          className="min-w-32"
          render={<Link href={`/payroll/contractor-invoices/${ci.id}`} />}
        >
          {step === 'issue' ? t('v2.cta.issueInvoice') : t('v2.cta.signInvoice')}
        </Button>
      );
    }
    const open = i.acts.filter((a) => !a.rateLocked);
    const target =
      step === 'issue'
        ? (open.find((a) => a.status === 'draft') ?? i.acts.at(-1))
        : open.find((a) => a.status === 'issued' && !a.signed);
    if (!target) return null;
    return (
      <Button
        size="sm"
        variant="outline"
        className="min-w-32"
        render={<Link href={`/acts/${target.id}`} />}
      >
        {step === 'issue' ? t('v2.cta.issueAct') : t('v2.cta.signAct')}
      </Button>
    );
  };

  const menuOf = (i: PayrollRow): MenuEntry[] => {
    const fiat = i.item.payoutMethod === 'fiat';
    const unpaid = toDecimal(i.item.paidAmount).isZero();
    const allDraft = i.acts.every((a) => a.status === 'draft');
    const step = i.group === 'paid' ? null : p.nextStep(i);
    const ci = p.contractorInvoices.find((x) => x.payrollItemId === i.item.id);
    const draftActs = [...i.acts]
      .filter((a) => a.status === 'draft' && !a.rateLocked)
      .sort((a, b) => Number(b.isRest) - Number(a.isRest));
    return [
      step !== null &&
        step !== 'pay' &&
        p.documentOf(i) !== null && {
          label: t('v2.payNow'),
          dialog: { title: `${tp('pay')}: ${nameOf(i)}`, content: payDialog(i) },
        },
      p.isOwner &&
        i.group !== 'paid' &&
        unpaid &&
        i.lines.every((l) => l.currency === 'USD') &&
        i.adjustments.length === 0 &&
        allDraft && {
          label: t('v2.changeMethod'),
          dialog: {
            title: t('changeMethodLabel'),
            content: <ChangeMethodForm itemId={i.item.id} current={i.item.payoutMethod} />,
          },
        },
      ...i.acts.flatMap((a, n): MenuEntry[] => {
        const next = i.acts[n + 1];
        const splittable =
          a.status === 'draft' &&
          !a.rateLocked &&
          a.periodFrom !== null &&
          a.periodTo !== null &&
          (a.periodFrom < a.periodTo || !next) &&
          (p.activitiesIn(i, a).length > 1 || p.splitsByAmount(i, a));
        return [
          splittable &&
            a.periodFrom &&
            a.periodTo && {
              label: t('v2.splitAct', { act: actLabel(a) }),
              dialog: {
                title: tp('splitAct'),
                description: tp('splitHint'),
                content: (
                  <SplitActForm
                    actId={a.id}
                    periodFrom={a.periodFrom}
                    periodTo={a.periodTo}
                    activities={p.activitiesIn(i, a)}
                    byAmount={p.splitsByAmount(i, a)}
                    extendable={!next}
                  />
                ),
              },
            },
          next &&
            a.status === 'draft' &&
            next.status === 'draft' && {
              label: t('v2.mergeActs', { first: actLabel(a), second: actLabel(next) }),
              dialog: {
                title: tp('merge'),
                description: t('v2.mergeHint'),
                content: <MergeActsButton firstId={a.id} secondId={next.id} />,
              },
            },
        ];
      }),
      p.isOwner &&
        i.item.kind === 'person' &&
        i.periodStatus === 'closed' &&
        unpaid &&
        allDraft && {
          label: t('v2.adjust'),
          dialog: {
            title: t('adjustClosed'),
            content: (
              <AdjustClosedForm
                itemId={i.item.id}
                fiat={fiat}
                acts={draftActs.map((a) => ({
                  id: a.id,
                  label: `${a.periodFrom && a.periodTo ? `${fmt.date(a.periodFrom)}–${fmt.date(a.periodTo)}` : tp('draftAct')} · ${fmt.amount(a.amountUah, 'UAH')}`,
                }))}
              />
            ),
          },
        },
      'separator',
      ...i.acts.map((a) => ({
        label: t('v2.openAct', { act: actLabel(a) }),
        href: `/acts/${a.id}`,
      })),
      ci && { label: t('v2.openInvoice'), href: `/payroll/contractor-invoices/${ci.id}` },
      i.item.payeeId && { label: t('v2.openPayee'), href: `/people/payees/${i.item.payeeId}` },
    ];
  };

  const lineMenu = (i: PayrollRow, l: PayrollRow['lines'][number]): MenuEntry[] => [
    p.isOwner &&
      l.status === 'awaiting_client' && {
        label: t('v2.release'),
        dialog: {
          title: tp('releaseReason'),
          description: t('v2.releaseHint'),
          content: <OverrideForm lineId={l.id} />,
        },
      },
    p.isOwner &&
      toDecimal(i.item.paidAmount).isZero() &&
      i.acts.every((a) => a.status === 'draft') && {
        label: t('v2.removeLine'),
        destructive: true,
        dialog: { title: t('removeLine'), content: <RemoveLineForm lineId={l.id} /> },
      },
  ];

  const details = (i: PayrollRow) => {
    const fiat = i.item.payoutMethod === 'fiat';
    const ci = p.billable(i)
      ? p.contractorInvoices.find((x) => x.payrollItemId === i.item.id)
      : undefined;
    const rateEditable =
      fiat &&
      !toDecimal(i.item.totalUsd).isZero() &&
      i.actStatus !== 'issued' &&
      i.group !== 'paid' &&
      toDecimal(i.item.paidAmount).lte(
        sum(i.acts.filter((a) => a.amountUsd !== null).map((a) => a.amountUah)),
      );
    return (
      <div className="flex flex-col gap-4 pt-2 text-sm">
        {(i.acts.length > 0 || ci) && (
          <section className="flex flex-col gap-1.5">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('v2.documents')}
            </h3>
            <ul className="flex flex-col gap-1.5" data-testid="payout-acts">
              {i.acts.map((a) => {
                const s = actState(i, a);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link href={`/acts/${a.id}`} className="font-medium text-link hover:underline">
                      {a.number ?? tp('draftAct')}
                    </Link>
                    {a.periodFrom && a.periodTo && (
                      <span className="text-muted-foreground">
                        {fmt.date(a.periodFrom)}–{fmt.date(a.periodTo)}
                      </span>
                    )}
                    <span className="tabular-nums">{fmt.amount(a.amountUah, 'UAH')}</span>
                    {a.amountUsd !== null && (
                      <span className="text-muted-foreground">
                        {tp('partOf', {
                          usd: fmt.amount(a.amountUsd, 'USD'),
                          rate: a.fxRate ?? '—',
                        })}
                      </span>
                    )}
                    <Status tone={s.tone}>{s.label}</Status>
                  </li>
                );
              })}
              {ci && (
                <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    href={`/payroll/contractor-invoices/${ci.id}`}
                    className="font-medium text-link hover:underline"
                  >
                    {ci.number ?? tci('titleDraft')}
                  </Link>
                  <span className="tabular-nums">{fmt.amount(ci.amount, ci.currency)}</span>
                  <Status
                    tone={
                      ci.status === 'draft'
                        ? 'neutral'
                        : ci.status === 'issued' && ci.signedAt
                          ? 'info'
                          : 'warning'
                    }
                  >
                    {ci.status === 'draft'
                      ? t('v2.actStatus.draft')
                      : ci.signedAt
                        ? t('v2.actStatus.signed')
                        : t('v2.actStatus.unsigned')}
                  </Status>
                </li>
              )}
            </ul>
          </section>
        )}
        {fiat && !toDecimal(i.item.totalUsd).isZero() && (
          <section className="flex flex-wrap items-center gap-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('v2.rate')}
            </h3>
            {rateEditable ? (
              <RateForm itemId={i.item.id} rate={i.item.payoutFxRate} source={i.item.fxSource} />
            ) : (
              <span>
                {i.item.payoutFxRate ?? t('noRate')}
                {i.item.fxSource && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {FX_SOURCE_LABELS[i.item.fxSource]}
                  </span>
                )}
              </span>
            )}
          </section>
        )}
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('v2.lines')}
          </h3>
          <ul className="flex flex-col divide-y rounded-md border bg-card">
            {i.lines.map((l) => (
              <li
                key={l.id}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[1fr_auto_auto_auto]"
              >
                <div className="min-w-0">
                  <div className="truncate">
                    {l.agencyFee && `${l.personName} · `}
                    {l.clientName ?? tc('internal')}
                    {l.roleTitle && <span className="text-muted-foreground"> · {l.roleTitle}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      l.invoiceNumber &&
                        t('invoice', { number: l.invoiceNumber }).replace(/^ · /, ''),
                      l.status === 'awaiting_client' &&
                        l.deadline &&
                        t('until', { date: fmt.date(l.deadline) }).trim(),
                      l.fundingSource &&
                        `${t('v2.fundedBy')}: ${l.fundingSource === 'client' ? t('fundingClient') : t('fundingCompany')}`,
                      l.overrideReason && t('released', { reason: l.overrideReason }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <Status tone={LINE_TONES[l.status] ?? 'neutral'} className="justify-self-end">
                  {t(`lineStatus.${l.status as 'accrued'}`)}
                </Status>
                <span className="text-right font-medium tabular-nums">
                  {fmt.amount(l.amount, l.currency)}
                </span>
                <span className="justify-self-end">
                  <RowMenu label={t('v2.lineActions')} entries={lineMenu(i, l)} />
                </span>
              </li>
            ))}
            {i.adjustments.map((a) => (
              <li
                key={a.id}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 px-3 py-2 sm:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
                  <div>{ADJUSTMENT_KIND_LABELS[a.kind]}</div>
                  <div className="text-xs text-muted-foreground">{a.reason}</div>
                </div>
                <span className="text-right font-medium tabular-nums">
                  {fmt.amount(a.amount, a.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  };

  const row = (i: PayrollRow) => {
    const fiat = i.item.payoutMethod === 'fiat';
    const doc = p.documentOf(i);
    const step = i.group === 'paid' ? 3 : STEP_INDEX[p.nextStep(i)];
    const name = nameOf(i);
    const { main, currency } = amountOf(i);
    const partlyPaid =
      i.remaining !== null &&
      i.group !== 'paid' &&
      main !== null &&
      !toDecimal(i.remaining).eq(main);
    const sub = partlyPaid
      ? t('remaining', { amount: fmt.amount(i.remaining ?? '0', currency) })
      : fiat && !toDecimal(i.item.totalUsd).isZero()
        ? `≈ ${fmt.amount(i.item.totalUsd, 'USD')}`
        : null;
    const meta = [
      PAYOUT_METHOD_LABELS[i.item.payoutMethod] ?? i.item.payoutMethod,
      i.item.kind === 'agency' ? null : (i.payeeName ?? t('noPayee')),
      p.periodId ? null : fmt.month(i.month),
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <ExpandableRow
        key={i.item.id}
        testId="payroll-row"
        label={t('v2.details', { name })}
        summary={
          <span className="grid min-w-0 flex-1 grid-cols-[2.25rem_1fr] items-center gap-x-3 gap-y-2 md:grid-cols-[2.25rem_minmax(0,1fr)_auto_10rem]">
            <span className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">
              {initials(i.personName ?? i.payeeName ?? '?')}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {meta}
                {i.group === 'waiting' &&
                  i.nextDeadline &&
                  t('deadline', { date: fmt.date(i.nextDeadline) })}
              </span>
            </span>
            <span className="col-start-2 overflow-x-auto md:col-start-auto">
              {doc && i.group !== 'paid' ? (
                <Steps
                  compact
                  label={t('v2.stepsLabel')}
                  current={step}
                  steps={[t('v2.steps.document'), t('v2.steps.signature'), t('v2.steps.payment')]}
                />
              ) : i.group === 'paid' ? (
                <Status tone="success">{t('groups.paid')}</Status>
              ) : null}
            </span>
            <span className="col-start-2 md:col-start-auto md:text-right">
              <span className="block font-semibold tabular-nums" data-testid="payout-amount">
                {main === null ? t('noRate') : fmt.amount(main, currency)}
              </span>
              {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
            </span>
          </span>
        }
        actions={
          <>
            {primaryAction(i)}
            <RowMenu label={tc('actions')} entries={menuOf(i)} />
          </>
        }
      >
        {details(i)}
      </ExpandableRow>
    );
  };

  const monthOptions = p.months.map((m) => ({
    key: m.id,
    label: fmt.month(m.month),
    href: query(m.id),
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} help={t('v2.help')}>
        <MonthStepper
          options={monthOptions}
          extra={[{ key: 'all', label: tc('allMonths'), href: query('') }]}
          current={p.periodId || 'all'}
          labels={{ previous: tc('previous'), next: tc('next'), choose: tc('chooseMonth') }}
        />
        <Button size="sm" variant="outline" render={<Link href="/acts" />}>
          {t('actsRegistry')}
        </Button>
      </PageHeader>

      {p.salaryGroups.length > 0 && (
        <section className="flex flex-col gap-2" aria-label={t('salaryTitle')}>
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-lg font-semibold">{t('salaryTitle')}</h2>
            <HelpTip label={tc('help')}>{t('v2.salaryHelp')}</HelpTip>
            <Link href="/ledger/planned" className="ml-auto text-sm text-link hover:underline">
              {t('salaryPlanned')}
            </Link>
          </div>
          <div className="rounded-lg border bg-card">
            {p.salaryGroups.map((g) => (
              <div key={g.key} data-testid="salary-payout" className="border-b last:border-b-0">
                <div className="px-3 pt-3 text-sm font-medium">
                  {g.personName} · {fmt.month(g.month)}
                </div>
                <ul className="divide-y">
                  {g.rows.map(({ payment: pay, transactions, overdue }) => (
                    <li
                      key={pay.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-sm"
                    >
                      <span className="min-w-40 flex-1">
                        {pay.name}
                        <span
                          className={`block text-xs ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}
                        >
                          {t('salaryDue')} {fmt.date(pay.dueOn)}
                          {p
                            .chargesOf(pay.id)
                            .map(
                              (c) =>
                                ` · ${c.payment.name}: ${fmt.amount(c.payment.amount, c.payment.currency)}${c.payment.status === 'paid' ? ` (${t('salaryPaid')})` : ''}`,
                            )}
                        </span>
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="block font-semibold">
                          {fmt.amount(pay.amount, pay.currency)}
                        </span>
                        {pay.gross && (
                          <span className="block text-xs text-muted-foreground">
                            {t('salaryGross', { amount: fmt.amount(pay.gross, pay.currency) })}
                          </span>
                        )}
                      </span>
                      <span className="flex min-w-32 justify-end">
                        {pay.status === 'due' ? (
                          <PaymentActions
                            id={pay.id}
                            isInstalment
                            amount={pay.amount}
                            gross={pay.gross}
                            currency={pay.currency}
                            fee={
                              pay.feeAmount
                                ? {
                                    amount: pay.feeAmount,
                                    currency: pay.feeCurrency ?? pay.currency,
                                  }
                                : null
                            }
                            today={p.today}
                            accounts={p.accountRows}
                            candidates={p.salaryCandidates(pay.currency)}
                          />
                        ) : pay.status === 'paid' ? (
                          <Status tone="success">
                            {t('salaryPaid')}
                            {transactions.map((x) => ` · ${fmt.date(x.occurredOn)}`).join('')}
                          </Status>
                        ) : (
                          <Status>{t('salarySkipped')}</Status>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {linked && linked.group !== 'paid' && p.linkPay && (
        <OpenedDialog
          title={`${tp('pay')}: ${nameOf(linked)}`}
          content={payDialog(linked, p.linkPay.transactionId)}
          closeHref={query(p.periodId, tab)}
        />
      )}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <TabsNav
              label={t('v2.tabsLabel')}
              active={tab}
              tabs={GROUPS.map((g) => ({
                key: g,
                label: t(`v2.tabs.${g}`),
                href: query(p.periodId, g),
                count: counts[g],
              }))}
            />
            {totalText && (
              <span className="text-sm text-muted-foreground" data-testid="payroll-total">
                {t('v2.total', { amount: totalText })}
              </span>
            )}
          </div>
          {rows.length === 0 && (tab !== 'paid' || paidParts.length === 0) ? (
            <div className="rounded-lg border border-dashed px-6 py-10 text-center text-muted-foreground">
              {t(`v2.empty.${tab}`)}
            </div>
          ) : (
            <div className="rounded-lg border bg-card">
              {rows.map(row)}
              {tab === 'paid' &&
                paidParts.map(({ i, a }) => (
                  <div
                    key={a.id}
                    data-testid="paid-part"
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-3 pl-10 text-sm last:border-b-0"
                  >
                    <span className="font-medium">{nameOf(i)}</span>
                    <Link href={`/acts/${a.id}`} className="text-link hover:underline">
                      {actLabel(a)}
                    </Link>
                    <span className="tabular-nums">{fmt.amount(a.amountUah, 'UAH')}</span>
                    <Status tone="success">{t('v2.actStatus.paid')}</Status>
                    {i.remaining !== null && (
                      <span className="text-muted-foreground">
                        {t('paidPartRest', { amount: fmt.amount(i.remaining, i.currency) })}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
