// Ukrainian → Latin transliteration per Cabinet of Ministers Resolution No. 55 (2010), spec 7.3.
const BASE: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ie',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ю: 'iu',
  я: 'ia',
  // Russian letters that occur in legacy spellings of names.
  ё: 'io',
  ы: 'y',
  э: 'e',
  ъ: '',
};

const WORD_INITIAL: Record<string, string> = { є: 'ye', ї: 'yi', й: 'y', ю: 'yu', я: 'ya' };

const APOSTROPHES = /['’ʼ`]/g;
const LETTER = /\p{L}/u;

export function transliterateUa(input: string): string {
  const text = input.toLowerCase().replace(APOSTROPHES, '');
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const prev = i > 0 ? text.charAt(i - 1) : '';
    if (ch === 'г' && prev === 'з') {
      out += 'gh';
    } else if (!LETTER.test(prev) && ch in WORD_INITIAL) {
      out += WORD_INITIAL[ch] ?? ch;
    } else {
      out += BASE[ch] ?? ch;
    }
  }
  return out;
}

/** Latin, lowercase, dash-separated slug for Drive folders and file names. */
export function slugify(input: string): string {
  return transliterateUa(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
