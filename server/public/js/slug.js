// A link name from what the owner typed: "كافيه زد" -> "kafyh-zd", "Cafe Z" -> "cafe-z".
// Only a suggestion; the owner can change it. Egyptian reading of the letters (ج -> g).

const AR = {
  ا: 'a', أ: 'a', إ: 'e', آ: 'a', ٱ: 'a', ب: 'b', ت: 't', ث: 's', ج: 'g', ح: 'h', خ: 'kh', د: 'd', ذ: 'z',
  ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'k',
  ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: 'a', و: 'o', ي: 'y', ى: 'a', ئ: 'e', ؤ: 'o', ء: '',
  پ: 'p', چ: 'ch', ڤ: 'v', گ: 'g',
};
const DIGITS = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9 };

// Words every café name has, as people write them in English.
const WORDS = {
  كافيه: 'cafe', كافية: 'cafe', كافي: 'cafe', كافى: 'cafe', كوفي: 'coffee', كوفى: 'coffee', قهوة: 'coffee', قهوه: 'coffee',
  مطعم: 'restaurant', مطاعم: 'restaurants', برجر: 'burger', بيرجر: 'burger', بيتزا: 'pizza', شاورما: 'shawarma',
  كشري: 'koshary', كشرى: 'koshary', جريل: 'grill', مشويات: 'grill', حلواني: 'sweets', حلوانى: 'sweets', بيكري: 'bakery', بيكرى: 'bakery',
};

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function slugify(text, max = 24) {
  const latin = String(text ?? '')
    .split(/\s+/)
    .map((w) => WORDS[w.replace(/^ال/, '')] ?? w)
    .join(' ')
    .normalize('NFKD')
    .replace(/[ً-ٰٟـ]/g, '') // harakat, tatweel
    .replace(/[؀-ۿ]/g, (ch) => (ch in DIGITS ? String(DIGITS[ch]) : AR[ch] ?? ' '))
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let out = latin.slice(0, max).replace(/-+$/g, '');
  if (out.length < 3 && out) out = `${out}-cafe`.slice(0, max);
  return out;
}

/** What the owner types into a link field: small letters, digits and single dashes only. */
export const cleanTyped = (value, max = 24) => String(value ?? '')
  .toLowerCase()
  .replace(/\s+/g, '-')
  .replace(/[^a-z0-9-]/g, '')
  .replace(/-{2,}/g, '-')
  .slice(0, max);
