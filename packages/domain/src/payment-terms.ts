import type { PaymentDueRule } from './date-rules';
import { integerToWordsEn, integerToWordsUa } from './words';

// "протягом двадцяти (20) днів": the count after «протягом» is in the genitive case.
const UA_GENITIVE: Record<string, string> = {
  один: 'одного',
  два: 'двох',
  три: 'трьох',
  чотири: 'чотирьох',
  "п'ять": "п'яти",
  шість: 'шести',
  сім: 'семи',
  вісім: 'восьми',
  "дев'ять": "дев'яти",
  десять: 'десяти',
  одинадцять: 'одинадцяти',
  дванадцять: 'дванадцяти',
  тринадцять: 'тринадцяти',
  чотирнадцять: 'чотирнадцяти',
  "п'ятнадцять": "п'ятнадцяти",
  шістнадцять: 'шістнадцяти',
  сімнадцять: 'сімнадцяти',
  вісімнадцять: 'вісімнадцяти',
  "дев'ятнадцять": "дев'ятнадцяти",
  двадцять: 'двадцяти',
  тридцять: 'тридцяти',
  сорок: 'сорока',
  "п'ятдесят": "п'ятдесяти",
  шістдесят: 'шістдесяти',
  сімдесят: 'сімдесяти',
  вісімдесят: 'вісімдесяти',
  "дев'яносто": "дев'яноста",
  сто: 'ста',
  двісті: 'двохсот',
  триста: 'трьохсот',
  чотириста: 'чотирьохсот',
  "п'ятсот": "п'ятисот",
  шістсот: 'шестисот',
  сімсот: 'семисот',
  вісімсот: 'восьмисот',
  "дев'ятсот": "дев'ятисот",
};

/** 1–999 in Ukrainian words, genitive case, masculine («двадцяти одного»). */
export function integerToWordsUaGenitive(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999) {
    throw new Error(`No genitive wording for ${String(n)}`);
  }
  return integerToWordsUa(n, 'm')
    .split(' ')
    .map((w) => UA_GENITIVE[w] ?? w)
    .join(' ');
}

const singular = (n: number) => n % 10 === 1 && n % 100 !== 11;

function ordinalEn(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${String(n)}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${String(n)}${suffix}`;
}

/**
 * The invoice's payment clause from the contract rule (spec 5.5), without the final full stop:
 * "The Customer shall pay all undisputed invoices within twenty (20) days from the date of their
 * receipt" / "Замовник здійснює оплату всіх неоспорюваних інвойсів протягом двадцяти (20) днів з
 * моменту їх отримання".
 */
export function paymentTermsText(rule: PaymentDueRule): { en: string; ua: string } {
  const en = 'The Customer shall pay all undisputed invoices';
  const ua = 'Замовник здійснює оплату всіх неоспорюваних інвойсів';
  if (rule.type === 'day_of_month') {
    return {
      en: `${en} no later than the ${ordinalEn(rule.day)} day of the month of their receipt, or of the following month if received after that day`,
      ua: `${ua} не пізніше ${String(rule.day)}-го числа місяця їх отримання, а якщо їх отримано після цього числа — наступного місяця`,
    };
  }
  const n = rule.days;
  const working = rule.type === 'net_working_days';
  const unitEn = `${working ? 'business ' : ''}${n === 1 ? 'day' : 'days'}`;
  const unitUa = singular(n)
    ? `${working ? 'робочого ' : ''}дня`
    : `${working ? 'робочих ' : ''}днів`;
  return {
    en: `${en} within ${integerToWordsEn(n)} (${String(n)}) ${unitEn} from the date of their receipt`,
    ua: `${ua} протягом ${integerToWordsUaGenitive(n)} (${String(n)}) ${unitUa} з моменту їх отримання`,
  };
}
