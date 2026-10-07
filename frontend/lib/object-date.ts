// Display-only English rendering of a record's object_date. Berlin (SMB) records
// carry German datings ("1-600 n. Chr.", "Anfang 5. Jh. v. Chr."); the raw value
// stays as-is in the data and in exports. Words it doesn't know pass through
// untouched, so an unusual dating is never rewritten into something it didn't say.

const ORDINAL_SUFFIX = (n: number) => {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return "th"
  return ["th", "st", "nd", "rd"][n % 10] ?? "th"
}
const ordinal = (n: number) => `${n}${ORDINAL_SUFFIX(n)}`

const PART_WORDS: Record<string, string> = { "1": "first", "2": "second", "3": "third", "4": "fourth" }

const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  [/\bn\.\s?Chr\.?/g, "CE"],
  [/\bv\.\s?Chr\.?/g, "BCE"],
  // "1. Hälfte 6. Jh." → "first half of the 6. Jh." (century handled below)
  [/\b([1-4])\.\s?(Hälfte|Viertel|Drittel)\b/g, (_, n, part) =>
    `${PART_WORDS[n]} ${part === "Hälfte" ? "half" : part === "Viertel" ? "quarter" : "third"} of the`],
  [/\b(\d{1,2})\.\s?(?:Jh\.?|Jhs\.?|Jahrhunderts?)/g, (_, n) => `${ordinal(Number(n))} century`],
  [/\b(?:Anfang|frühes|frühe|früh)\s+/g, "early "],
  [/\bMitte\s+/g, "mid-"],
  [/\b(?:Ende|spätes|späte|spät)\s+/g, "late "],
  [/\b(?:um|ca\.)\s+/g, "c. "],
  [/\bzwischen\b/g, "between"],
  [/\bbis\b/g, "to"],
  [/\bnach\b/g, "after"],
  [/\bvor\b/g, "before"],
  [/\bund\b/g, "and"],
  [/\boder\b/g, "or"],
  // Year ranges read with an en dash: "1-600" → "1–600"
  [/(\d)\s?-\s?(\d)/g, "$1–$2"],
]

export function displayObjectDate(raw: string | null | undefined): string {
  let s = (raw ?? "").trim()
  if (!s) return ""
  for (const [re, to] of RULES) s = s.replace(re, to as any)
  return s.replace(/\s{2,}/g, " ").trim()
}
