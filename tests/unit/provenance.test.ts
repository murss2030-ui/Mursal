import { describe, expect, it } from 'vitest';
import { contrastRatio, PROVENANCE_VISUALS } from '../../src/domain/provenance';
import { PROVENANCE_STATES } from '../../src/domain/types';

const visuals = PROVENANCE_STATES.map((s) => PROVENANCE_VISUALS[s]);

describe('provenance states are visually distinct (Section 7, Section 20)', () => {
  it('defines all eight states', () => {
    expect(visuals).toHaveLength(8);
    for (const s of PROVENANCE_STATES) expect(PROVENANCE_VISUALS[s].state).toBe(s);
  });

  it('gives every state its own icon and its own text label — never colour alone', () => {
    expect(new Set(visuals.map((v) => v.icon)).size).toBe(8);
    expect(new Set(visuals.map((v) => v.label)).size).toBe(8);
    expect(new Set(visuals.map((v) => v.labelAr)).size).toBe(8);
    for (const v of visuals) expect(v.labelAr).toMatch(/[؀-ۿ]/);
  });

  it('gives every state a distinct border/fill/emphasis treatment, even in greyscale', () => {
    const shape = visuals.map((v) => `${v.borderStyle}|${v.borderWidth}|${v.italic}|${v.icon}`);
    expect(new Set(shape).size).toBe(8);
    const colours = visuals.map((v) => `${v.bg}|${v.borderColor}`);
    expect(new Set(colours).size).toBe(8);
  });

  it('meets WCAG AA text contrast (4.5:1) for every state', () => {
    for (const v of visuals) expect(contrastRatio(v.fg, v.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('renders unverified extractions amber and italic, and never lets them feed a calculator', () => {
    const v = PROVENANCE_VISUALS.extracted_unverified;
    expect(v.italic).toBe(true);
    expect(v.bg).toBe('#fffbeb');
    expect(v.mayFeedCalculator).toBe(false);
    expect(visuals.filter((x) => x.italic)).toHaveLength(1);
  });

  it('never styles a proposed change like an implemented one', () => {
    const proposed = PROVENANCE_VISUALS.ai_suggestion;
    const implemented = PROVENANCE_VISUALS.implemented;
    expect(proposed.icon).not.toBe(implemented.icon);
    expect(proposed.bg).not.toBe(implemented.bg);
    expect(proposed.borderStyle).not.toBe(implemented.borderStyle);
  });
});
