# Recorded answers of the open services

Recorded once, on 21 October 2026, from the real services by
`scripts/record-connector-fixtures.ts` (run with
`NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<bundle> npx vite-node scripts/record-connector-fixtures.ts`
behind a proxy). The addresses are built by the same functions the app uses
(`urls` in `src/ai/connectors/open.ts`); the unit tests serve an answer only
for the exact address, so a changed query fails the test.

Answers are kept as received. The one exception: an openFDA label keeps the
fields the app reads (its identifiers, the `openfda` block and the sections
listed in `LABEL_SECTIONS`) and drops the rest of a long label.

No key and no personal data were sent: drug names and a literature question
about vancomycin dosing only. Texts belong to their publishers (U.S. FDA,
NLM/NCBI, EMBL-EBI, MedlinePlus) and are public; they are test data here, not
shipped in the application.
