// =============================================================================
// lib/plan/room-names.ts — English ↔ Arabic room names (rule 11). PURE.
//
// A room renamed in one language keeps the other label it had: the Jumeirah
// Parks "Hall" still read غرفة الطعام (dining room). Each concept lists the
// words that name it in English and the labels that name it in Arabic; a label
// pair is flagged only when BOTH are recognised and name different things — a
// name we do not know is never guessed at.
// =============================================================================

interface Concept {
  key: string;
  /** English words (whole words, lower case). Checked most specific first. */
  en: RegExp;
  /** Arabic labels (substring match). */
  ar: string[];
  /** Concepts whose Arabic also fits this English (a hall is also an entrance ردهة). */
  near?: string[];
}

const CONCEPTS: Concept[] = [
  { key: "master_bedroom", en: /\bmaster\s+bed(room)?\b/, ar: ["غرفة النوم الرئيسية", "النوم الرئيسية"], near: ["bedroom"] },
  { key: "maid", en: /\bmaid('?s)?\b/, ar: ["الخادمة", "الخدم"] },
  { key: "bedroom", en: /\bbed\s?room\b|\bbedroom-?\d*\b/, ar: ["غرفة نوم", "غرفة النوم"], near: ["master_bedroom"] },
  { key: "powder", en: /\b(powder|wc|toilet|guest\s+bath)\b/, ar: ["دورة مياه", "حمام ضيوف", "مرحاض", "دورة المياه"], near: ["bathroom"] },
  { key: "bathroom", en: /\b(bath|bathroom|ensuite|en-suite|shower)\b/, ar: ["حمام"], near: ["powder"] },
  { key: "closet", en: /\b(dress|dressing|closet|wardrobe|walk-?in)\b/, ar: ["غرفة ملابس", "غرفة الملابس", "خزانة", "ملابس"] },
  { key: "family", en: /\bfamily\b/, ar: ["العائلة", "الأسرة"], near: ["living"] },
  { key: "living", en: /\b(living|lounge|sitting)\b/, ar: ["المعيشة", "معيشة", "الجلوس"], near: ["family"] },
  { key: "dining", en: /\bdining\b/, ar: ["الطعام", "طعام", "السفرة"] },
  { key: "kitchen", en: /\b(kitchen|pantry)\b/, ar: ["مطبخ", "المطبخ"] },
  { key: "majlis", en: /\bmajlis\b/, ar: ["مجلس", "المجلس"] },
  { key: "laundry", en: /\b(laundry|utility)\b/, ar: ["غسيل", "الغسيل"] },
  { key: "foyer", en: /\b(foyer|entrance|entry|lobby)\b/, ar: ["مدخل", "المدخل", "ردهة"], near: ["hall"] },
  { key: "hall", en: /\bhall(way)?\b/, ar: ["صالة", "ردهة", "قاعة"], near: ["foyer"] },
  { key: "passage", en: /\b(passage|corridor)\b/, ar: ["ممر"] },
  { key: "stairs", en: /\b(stair|stairs|staircase)\b/, ar: ["درج"] },
  { key: "balcony", en: /\bbalcony\b|\bf-balcony\b/, ar: ["شرفة", "بلكونة", "بلكون"], near: ["terrace"] },
  { key: "terrace", en: /\bterrace\b/, ar: ["تراس", "سطح"], near: ["balcony"] },
  { key: "storage", en: /\b(store|storage)\b/, ar: ["مخزن", "تخزين"] },
];

const BY_KEY = new Map(CONCEPTS.map((c) => [c.key, c]));

/** The concept an English name refers to (most specific first), or null. */
export function englishConcept(name: string | null | undefined): string | null {
  const n = (name ?? "").toLowerCase();
  return n ? (CONCEPTS.find((c) => c.en.test(n))?.key ?? null) : null;
}

/** Every concept an Arabic label could refer to (longest label match wins). */
export function arabicConcept(label: string | null | undefined): string | null {
  const a = (label ?? "").trim();
  if (!a) return null;
  let best: { key: string; len: number } | null = null;
  for (const c of CONCEPTS) for (const w of c.ar) if (a.includes(w) && (!best || w.length > best.len)) best = { key: c.key, len: w.length };
  return best?.key ?? null;
}

/** English meaning of a concept, for the message. */
const MEANS: Record<string, string> = {
  master_bedroom: "master bedroom", maid: "maid's room", bedroom: "bedroom", powder: "WC", bathroom: "bathroom", closet: "dressing room",
  family: "family room", living: "living room", dining: "dining room", kitchen: "kitchen", majlis: "majlis", laundry: "laundry", foyer: "entrance",
  hall: "hall", passage: "passage", stairs: "stairs", balcony: "balcony", terrace: "terrace", storage: "store",
};

/**
 * Rule 11: when both labels are recognised and name different rooms, what the
 * Arabic one says ("dining room"); null when they agree or either is unknown.
 */
export function labelLanguageMismatch(nameEn: string | null | undefined, nameAr: string | null | undefined): string | null {
  const en = englishConcept(nameEn);
  const ar = arabicConcept(nameAr);
  if (!en || !ar || en === ar) return null;
  if (BY_KEY.get(en)?.near?.includes(ar)) return null;
  return `"${MEANS[ar] ?? ar}"`;
}
