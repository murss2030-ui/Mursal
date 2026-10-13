/**
 * The intended use statement, verbatim from Section 5 of the specification.
 * Shown on first run (acknowledgement required), in the About screen, and on
 * every exported file. Do not edit the wording; it is the regulatory basis of
 * the project.
 */
export const INTENDED_USE_STATEMENT = `PRECEPTOR is an educational tool for supervised clinical pharmacy trainees,
used to structure, document and reflect on a pharmacotherapy workup.

It is not intended for diagnosis, treatment, or patient-care decisions.

Outputs must not be entered into a medical record, or communicated to the
care team, without independent verification by a licensed pharmacist or
preceptor. All calculations, interactions and recommendations must be
independently confirmed before any clinical action.`;

/** Bumped whenever the statement changes, so a new acknowledgement is required. */
export const INTENDED_USE_VERSION = 'v4.0';
