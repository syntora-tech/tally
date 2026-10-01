import {
  addMonths,
  endOfMonth,
  formatUaDate,
  isWeekend,
  slugify,
  startOfMonth,
  toParts,
  type LocalDate,
} from '@tally/domain';
import type { Aliases } from './aliases';
import type { Anomaly, ContractRec, PayeeRec } from './model';
import { actSequence, contractOfActNumber, type RegistryAct } from './sources/acts';

export type SequenceRec = { key: string; template: string; nextValue: number };

export type ActRec = {
  ref: string;
  contractRef: string;
  payeeKey: string;
  number: string;
  actDate: LocalDate;
  periodFrom: LocalDate;
  periodTo: LocalDate;
  amountUah: string;
};

const upper = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();

/** Monthly acts are dated at the end of the work month; early-month dates belong to the previous one (Q7). */
function workMonth(actDate: LocalDate): LocalDate {
  return toParts(actDate).day >= 25 ? startOfMonth(actDate) : addMonths(startOfMonth(actDate), -1);
}

/**
 * Acts registry (spec 8.1): legacy acts with numbers verbatim, the FOP payees and contracts behind
 * them (created when the act sheets did not describe them, e.g. Dolina OD-1003, Khomyn MF281025),
 * and act number sequences continuing after the highest imported number.
 */
export function buildRegistry(
  registry: readonly RegistryAct[],
  existing: { payees: readonly PayeeRec[]; contracts: readonly ContractRec[] },
  aliases: Aliases,
) {
  const anomalies: Anomaly[] = [];
  const payees: PayeeRec[] = [];
  const contracts: ContractRec[] = [];
  const defaultPayees: { personKey: string; payeeKey: string }[] = [];
  const acts: ActRec[] = [];
  const allPayees = () => [...existing.payees, ...payees];
  const allContracts = () => [...existing.contracts, ...contracts];

  for (const name of [...new Set(registry.map((a) => a.contractor))]) {
    const known = allPayees().find((p) => upper(p.legalNameUa).includes(upper(name)));
    if (known) continue;
    const config = aliases.actContractors[name];
    const key = `registry-${slugify(name)}`;
    payees.push({
      ref: `payee:${key}`,
      key,
      legalNameUa: `ФОП ${name}`,
      taxId: null,
      addressUa: null,
      iban: null,
      bankName: null,
      edrRecord: null,
      edrDate: null,
      personKey: config?.person ?? null,
    });
    if (config?.person) defaultPayees.push({ personKey: config.person, payeeKey: key });
    anomalies.push({
      code: 'payee_from_registry',
      ref: registry.find((a) => a.contractor === name)?.ref ?? '',
      message: `ФОП ${name} створено з реєстру актів — заповніть реквізити (ІПН, IBAN, адреса)`,
    });
  }

  for (const act of registry) {
    const payee = allPayees().find((p) => upper(p.legalNameUa).includes(upper(act.contractor)));
    const number = contractOfActNumber(act.number);
    if (!payee || !number) {
      anomalies.push({
        code: 'act_unmapped',
        ref: act.ref,
        message: `Акт ${act.number}: не вдалося визначити договір`,
      });
      continue;
    }
    let contract = allContracts().find((c) => c.kind === 'fop' && c.number === number);
    if (!contract) {
      contract = {
        ref: `contract:fop:${payee.key}:${slugify(number)}`,
        kind: 'fop',
        number,
        signedOn: null,
        clientKey: null,
        payeeKey: payee.key,
        currency: 'UAH',
        ...(number.startsWith('MF') ? { actDateRule: { type: 'manual' } } : {}),
      };
      contracts.push(contract);
      anomalies.push({
        code: 'contract_from_registry',
        ref: act.ref,
        message: `Договір ${number} створено з реєстру актів — дата договору невідома, заповніть`,
      });
    }
    if (isWeekend(act.actDate)) {
      anomalies.push({
        code: 'act_weekend_date',
        ref: act.ref,
        message: `Акт ${act.number} датовано вихідним ${formatUaDate(act.actDate)} (A8) — імпортовано як legacy`,
      });
    }
    const month = workMonth(act.actDate);
    acts.push({
      ref: act.ref,
      contractRef: contract.ref,
      payeeKey: payee.key,
      number: act.number,
      actDate: act.actDate,
      periodFrom: month,
      periodTo: endOfMonth(month),
      amountUah: act.amountUah,
    });
  }

  // A9 and possible reimbursements: gaps and repeated months per contractor.
  for (const payeeKey of new Set(acts.map((a) => a.payeeKey))) {
    const own = acts.filter((a) => a.payeeKey === payeeKey);
    const months = own.map((a) => a.periodFrom).sort();
    for (let m = months[0]; m && months.at(-1) && m < (months.at(-1) ?? m); m = addMonths(m, 1)) {
      if (!months.includes(m)) {
        anomalies.push({
          code: 'act_missing_month',
          ref: own[0]?.ref ?? '',
          message: `${payeeKey}: немає акту за ${m.slice(0, 7)} (A9)`,
        });
      }
    }
    for (const m of new Set(months.filter((x, i) => months.indexOf(x) !== i))) {
      anomalies.push({
        code: 'act_type_unclear',
        ref: own.find((a) => a.periodFrom === m)?.ref ?? '',
        message: `${payeeKey}: кілька актів за ${m.slice(0, 7)} — один із них, імовірно, компенсація (уточнити після імпорту поїздок)`,
      });
    }
  }

  const sequences: SequenceRec[] = [];
  for (const number of new Set(
    acts.map((a) => allContracts().find((c) => c.ref === a.contractRef)?.number),
  )) {
    if (!number) continue;
    const contractRef = allContracts().find((c) => c.number === number)?.ref;
    const seq = actSequence(acts.filter((a) => a.contractRef === contractRef).map((a) => a.number));
    if (seq) sequences.push({ key: `act:${number}`, ...seq });
  }

  return { payees, contracts, defaultPayees, acts, sequences, anomalies };
}
