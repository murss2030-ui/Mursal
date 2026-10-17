/**
 * Allergy records often name a class, not a drug: "penicillin allergy",
 * "sulfa", "NSAIDs". This table maps those words to FDA Established
 * Pharmacologic Classes (ids as published in RxClass). A word that is also an
 * ingredient name in the singular ("tetracycline", "heparin") is matched as
 * the ingredient; only its plural names the class. The table is vocabulary,
 * not clinical judgement, and is listed for review in docs/m2/M2-REPORT.md.
 */
import { normaliseName, type DrugClass, type DrugVocabulary } from '../drugs/vocabulary';

const PENICILLIN = ['N0000175497'];
const CEPHALOSPORIN = ['N0000175488'];
const PENEM = ['N0000175496'];
const MONOBACTAM = ['N0000175493'];
const SULFONAMIDE = ['N0000175503', 'N0000175504', 'N0000175511'];
const OPIOID = ['N0000175690', 'N0000175692', 'N0000175689', 'N0000175688', 'N0000191867'];

export const ALLERGY_CLASS_TERMS: Readonly<Record<string, readonly string[]>> = {
  penicillin: PENICILLIN,
  penicillins: PENICILLIN,
  cephalosporin: CEPHALOSPORIN,
  cephalosporins: CEPHALOSPORIN,
  carbapenem: PENEM,
  carbapenems: PENEM,
  'beta-lactam': [...PENICILLIN, ...CEPHALOSPORIN, ...PENEM, ...MONOBACTAM],
  'beta-lactams': [...PENICILLIN, ...CEPHALOSPORIN, ...PENEM, ...MONOBACTAM],
  'beta lactam': [...PENICILLIN, ...CEPHALOSPORIN, ...PENEM, ...MONOBACTAM],
  'beta lactams': [...PENICILLIN, ...CEPHALOSPORIN, ...PENEM, ...MONOBACTAM],
  sulfa: SULFONAMIDE,
  sulpha: SULFONAMIDE,
  sulfonamide: SULFONAMIDE,
  sulfonamides: SULFONAMIDE,
  sulphonamide: SULFONAMIDE,
  sulphonamides: SULFONAMIDE,
  nsaid: ['N0000175722'],
  nsaids: ['N0000175722'],
  'non-steroidal anti-inflammatory': ['N0000175722'],
  'nonsteroidal anti-inflammatory': ['N0000175722'],
  opioid: OPIOID,
  opioids: OPIOID,
  opiate: OPIOID,
  opiates: OPIOID,
  macrolide: ['N0000175877', 'N0000175431', 'N0000175935'],
  macrolides: ['N0000175877', 'N0000175431', 'N0000175935'],
  quinolone: ['N0000193223', 'N0000175937'],
  quinolones: ['N0000193223', 'N0000175937'],
  fluoroquinolone: ['N0000193223', 'N0000175937'],
  fluoroquinolones: ['N0000193223', 'N0000175937'],
  tetracyclines: ['N0000175938', 'N0000175505', 'N0000175882'],
  aminoglycoside: ['N0000175477'],
  aminoglycosides: ['N0000175477'],
  glycopeptide: ['N0000175491'],
  glycopeptides: ['N0000175491'],
  statin: ['N0000175589'],
  statins: ['N0000175589'],
  'ace inhibitor': ['N0000175562'],
  'ace inhibitors': ['N0000175562'],
  'angiotensin receptor blocker': ['N0000175561'],
  'angiotensin receptor blockers': ['N0000175561'],
  benzodiazepine: ['N0000175694'],
  benzodiazepines: ['N0000175694'],
  barbiturate: ['N0000175693'],
  barbiturates: ['N0000175693'],
  heparins: ['N0000175474', 'N0000175586'],
};

/** Words around the allergen that do not change what it is ("penicillin allergy", "sulfa drugs"). */
const NOISE = /\b(?:allergy|allergies|allergic|to|class|group|family|drugs?|antibiotics?|medications?|medicines?|agents?)\b/g;

export function allergenTerm(substance: string): string {
  return normaliseName(substance).replace(/\([^)]*\)/g, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
}

/** The EPC classes an allergy record names, if it names a class. */
export function classesForAllergen(substance: string, vocab: DrugVocabulary): DrugClass[] {
  const ids = ALLERGY_CLASS_TERMS[allergenTerm(substance)] ?? [];
  return ids.map((id) => vocab.classById(id)).filter((c): c is DrugClass => !!c);
}
