import { useTranslations } from 'next-intl';

type Option = { value: string; label: string };
// Any translator scoped to `enums` (client hook or server `getTranslations`).
type EnumTranslator = { raw: (key: never) => unknown };

export const toOptions = (labels: Record<string, string>): Option[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

/** Enum labels of the current language, keyed by the stored value (messages `enums.*`). */
export function labelsFrom(t: EnumTranslator) {
  const map = (key: string) => t.raw(key as never) as Record<string, string>;
  return {
    DOCUMENT_TYPE_LABELS: map('documentType'),
    DOC_STATUS_LABELS: map('docStatus'),
    AUDIT_ACTION_LABELS: map('auditAction'),
    ALLOCATION_LABELS: map('allocation'),
    PERSON_STATUS_LABELS: map('personStatus'),
    BENCH_LABELS: map('bench'),
    PAYEE_KIND_LABELS: map('payeeKind'),
    CONTRACT_STATUS_LABELS: map('contractStatus'),
    CONTRACT_KIND_LABELS: map('contractKind'),
    PAYMENT_DUE_TYPES: toOptions(map('paymentDueType')),
    INVOICE_DATE_TYPES: toOptions(map('invoiceDateType')),
    ACT_DATE_TYPES: toOptions(map('actDateType')),
    BILLING_TYPE_LABELS: map('billingType'),
    PRORATION_LABELS: map('proration'),
    PAY_TYPE_LABELS: map('payType'),
    PAYOUT_METHOD_LABELS: map('payoutMethod'),
    RELEASE_POLICY_LABELS: map('releasePolicy'),
    INVOICE_STATUS_LABELS: map('invoiceStatus'),
    TX_TYPE_LABELS: map('txType'),
    ACCOUNT_KIND_LABELS: map('accountKind'),
    FX_SOURCE_LABELS: map('fxSource'),
    ADJUSTMENT_KIND_LABELS: map('adjustmentKind'),
  };
}

export type Labels = ReturnType<typeof labelsFrom>;

/** For client and non-async server components; async ones use `getLabels()`. */
export function useLabels(): Labels {
  return labelsFrom(useTranslations('enums'));
}
