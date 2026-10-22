/** Writes docs/m9/CLINICAL-FIXTURES.md, the expert review sheet, from src/fixtures/clinical.ts. */
import { writeFileSync } from 'node:fs';
import { reviewSheet } from '../src/fixtures/clinical';

writeFileSync('docs/m9/CLINICAL-FIXTURES.md', `${reviewSheet()}\n`);
console.log('wrote docs/m9/CLINICAL-FIXTURES.md');
