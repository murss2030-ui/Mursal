/**
 * Build status, used by the UI to state honestly what this build contains.
 *
 * RELEASE_GATE_MET must stay false until every condition in Section 23
 * ("Release gate") is satisfied: written authorisation from the department
 * head, a paid API key configured, M1–M6 accepted, and the clinical fixture
 * library run with no missed critical problem. While it is false, the app
 * requires a synthetic-data attestation for every case it creates.
 */
export const APP_VERSION = '0.1.0';
export const CURRENT_MILESTONE = 'M1' as const;
export const RELEASE_GATE_MET = false;

export type Milestone = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8' | 'M9';
