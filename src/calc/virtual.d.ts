/** Provided at build time by scripts/calc-validation.ts. */
declare module 'virtual:preceptor-calc-validation' {
  export const manifest: {
    version: 1;
    generatedAt: string;
    engineHash: string;
    engineTests: { passed: number; failed: number };
    calculators: Record<string, { formulaVersion: string; passed: number; failed: number }>;
  } | null;
  export const engineHash: string;
}
