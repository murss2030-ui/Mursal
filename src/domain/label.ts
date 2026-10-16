/** A bilingual label. English is the clinical and official wording; Arabic is shown in the Arabic interface. */
export interface L {
  en: string;
  ar: string;
}

export const L = (en: string, ar: string): L => ({ en, ar });
