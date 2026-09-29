import { roundHalfUp, type DecimalInput } from './money';

// Amounts in words for invoices and acts (spec 7.2). Format follows the current MONEYTEXT /
// UA_MONEYTEXT output in the invoice workbook: "Eight thousand two hundred seventy-two U.S. dollars
// 00 cents" / "вісім тисяч двісті сімдесят два долари США 00 центів".

function split(amount: DecimalInput): { whole: number; cents: string } {
  const [whole = '0', cents = '00'] = roundHalfUp(amount).abs().toFixed(2).split('.');
  // Whole part stays far below 2^53 for any real invoice; integers only, never money math.
  return { whole: Number(whole), cents };
}

const EN_ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];
const EN_SCALES = ['', 'thousand', 'million', 'billion'];

function enBelowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${EN_ONES[hundreds] ?? ''} hundred`);
  if (rest >= 20) {
    const tens = EN_TENS[Math.floor(rest / 10)] ?? '';
    parts.push(rest % 10 ? `${tens}-${EN_ONES[rest % 10] ?? ''}` : tens);
  } else if (rest) {
    parts.push(EN_ONES[rest] ?? '');
  }
  return parts.join(' ');
}

export function integerToWordsEn(n: number): string {
  if (n === 0) return 'zero';
  const parts: string[] = [];
  let scale = 0;
  for (let rest = n; rest > 0; rest = Math.floor(rest / 1000), scale++) {
    const chunk = rest % 1000;
    if (chunk) parts.unshift([enBelowThousand(chunk), EN_SCALES[scale]].filter(Boolean).join(' '));
  }
  return parts.join(' ');
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const EN_CURRENCY: Record<
  string,
  { one: string; many: string; centOne: string; centMany: string }
> = {
  USD: { one: 'U.S. dollar', many: 'U.S. dollars', centOne: 'cent', centMany: 'cents' },
  EUR: { one: 'euro', many: 'euros', centOne: 'cent', centMany: 'cents' },
  UAH: { one: 'hryvnia', many: 'hryvnias', centOne: 'kopiyka', centMany: 'kopiykas' },
};

export function moneyToWordsEn(amount: DecimalInput, currency: string): string {
  const unit = EN_CURRENCY[currency];
  if (!unit) throw new Error(`No English wording for currency ${currency}`);
  const { whole, cents } = split(amount);
  const name = whole === 1 ? unit.one : unit.many;
  const centName = cents === '01' ? unit.centOne : unit.centMany;
  return `${capitalize(integerToWordsEn(whole))} ${name} ${cents} ${centName}`;
}

type Gender = 'm' | 'f';
type Forms = [one: string, few: string, many: string];

const UA_ONES: Record<Gender, string[]> = {
  m: ['', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"],
  f: ['', 'одна', 'дві', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"],
};
const UA_TEENS = [
  'десять',
  'одинадцять',
  'дванадцять',
  'тринадцять',
  'чотирнадцять',
  "п'ятнадцять",
  'шістнадцять',
  'сімнадцять',
  'вісімнадцять',
  "дев'ятнадцять",
];
const UA_TENS = [
  '',
  '',
  'двадцять',
  'тридцять',
  'сорок',
  "п'ятдесят",
  'шістдесят',
  'сімдесят',
  'вісімдесят',
  "дев'яносто",
];
const UA_HUNDREDS = [
  '',
  'сто',
  'двісті',
  'триста',
  'чотириста',
  "п'ятсот",
  'шістсот',
  'сімсот',
  'вісімсот',
  "дев'ятсот",
];

/** 1 / 2–4 / 5+ with 11–14 always taking the "many" form. */
export function uaForm(n: number, forms: Forms): string {
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

function uaBelowThousand(n: number, gender: Gender): string {
  const parts = [UA_HUNDREDS[Math.floor(n / 100)] ?? ''];
  const rest = n % 100;
  if (rest >= 10 && rest < 20) parts.push(UA_TEENS[rest - 10] ?? '');
  else parts.push(UA_TENS[Math.floor(rest / 10)] ?? '', UA_ONES[gender][rest % 10] ?? '');
  return parts.filter(Boolean).join(' ');
}

const UA_SCALES: { gender: Gender; forms: Forms }[] = [
  { gender: 'f', forms: ['тисяча', 'тисячі', 'тисяч'] },
  { gender: 'm', forms: ['мільйон', 'мільйони', 'мільйонів'] },
  { gender: 'm', forms: ['мільярд', 'мільярди', 'мільярдів'] },
];

/** Integer in Ukrainian words with the gender of the counted noun (гривня — f, долар — m). */
export function integerToWordsUa(n: number, gender: Gender): string {
  if (n === 0) return 'нуль';
  const parts: string[] = [];
  let rest = n;
  const units = rest % 1000;
  if (units) parts.push(uaBelowThousand(units, gender));
  rest = Math.floor(rest / 1000);
  for (const scale of UA_SCALES) {
    if (rest === 0) break;
    const chunk = rest % 1000;
    if (chunk)
      parts.unshift(`${uaBelowThousand(chunk, scale.gender)} ${uaForm(chunk, scale.forms)}`);
    rest = Math.floor(rest / 1000);
  }
  return parts.join(' ');
}

const UA_CURRENCY: Record<string, { gender: Gender; forms: Forms; suffix: string; cents: Forms }> =
  {
    UAH: {
      gender: 'f',
      forms: ['гривня', 'гривні', 'гривень'],
      suffix: '',
      cents: ['копійка', 'копійки', 'копійок'],
    },
    USD: {
      gender: 'm',
      forms: ['долар', 'долари', 'доларів'],
      suffix: ' США',
      cents: ['цент', 'центи', 'центів'],
    },
    EUR: {
      gender: 'm',
      forms: ['євро', 'євро', 'євро'],
      suffix: '',
      cents: ['цент', 'центи', 'центів'],
    },
  };

/** Lower-case, as used mid-sentence in acts; invoices capitalize via `capitalizeFirst`. */
export function moneyToWordsUa(amount: DecimalInput, currency: string): string {
  const unit = UA_CURRENCY[currency];
  if (!unit) throw new Error(`No Ukrainian wording for currency ${currency}`);
  const { whole, cents } = split(amount);
  const words = integerToWordsUa(whole, unit.gender);
  return `${words} ${uaForm(whole, unit.forms)}${unit.suffix} ${cents} ${uaForm(Number(cents), unit.cents)}`;
}

export function capitalizeFirst(s: string): string {
  return capitalize(s);
}
