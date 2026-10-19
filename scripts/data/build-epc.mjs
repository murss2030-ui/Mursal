#!/usr/bin/env node
/**
 * Rebuilds the FDA Established Pharmacologic Class (EPC) data of the offline
 * vocabulary from RxClass, in two parts:
 *
 * - `epc`: each class with the ingredients FDA assigns to it DIRECTLY
 *   (RxClass trans=1). "Same class" checks (duplication, allergy
 *   cross-reactivity notes) use only these: a broad grouping node of the
 *   hierarchy ("Established Pharmacologic Classes", "Anti-infective",
 *   "Cardiovascular Agent") has no direct members and so never makes two
 *   unrelated drugs look alike;
 * - `epcGroups`: each grouping node of the hierarchy (a class with
 *   subclasses) with ALL its members, direct and through its subclasses. An
 *   allergy record that names a class ("opioid allergy") is matched against
 *   these, so a drug filed under a subclass is not missed.
 *
 * Members are the vocabulary's ingredients, including those the datasets
 * added (`extra`). Run after build-rxnorm.mjs and before build-ddinter.mjs.
 *
 * Run: NODE_USE_ENV_PROXY=1 node scripts/data/build-epc.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool, ROOT, rxnav, saveCache } from './lib-rxnav.mjs';
import { writeSubset } from './lib-datasets.mjs';

async function main() {
  const subset = JSON.parse(readFileSync(join(ROOT, 'public/data/rxnorm-subset.json'), 'utf8'));
  const known = new Set([...subset.ingredients, ...(subset.extra ?? [])].map(([r]) => r));
  const pinToIn = new Map(subset.precise.map(([r, , ins]) => [r, ins]));
  const members = (body) => {
    const ids = new Set();
    for (const m of body?.drugMemberGroup?.drugMember ?? []) {
      const { rxcui, tty } = m.minConcept;
      if (tty === 'IN' && known.has(rxcui)) ids.add(rxcui);
      if (tty === 'PIN') for (const i of pinToIn.get(rxcui) ?? []) if (known.has(i)) ids.add(i);
    }
    return [...ids].sort((a, b) => Number(a) - Number(b));
  };

  const all = (await rxnav('/rxclass/allClasses.json?classTypes=EPC')).rxclassMinConceptList?.rxclassMinConcept ?? [];
  const tree = await rxnav('/rxclass/classTree.json?classId=N0000189939');
  const groups = new Set();
  const walk = (n) => {
    if (n.rxclassTree?.length) groups.add(n.rxclassMinConceptItem.classId);
    for (const k of n.rxclassTree ?? []) walk(k);
  };
  for (const r of tree.rxclassTree ?? []) walk(r);

  const q = (id, trans) => `/rxclass/classMembers.json?classId=${encodeURIComponent(id)}&relaSource=FDASPL&rela=has_epc&ttys=IN+PIN&trans=${trans}`;
  const direct = await pool(all, 6, async (c) => [c.classId, c.className, members(await rxnav(q(c.classId, 1)))]);
  const whole = await pool(
    all.filter((c) => groups.has(c.classId)),
    6,
    async (c) => [c.classId, c.className, members(await rxnav(q(c.classId, 0)))],
  );
  saveCache();

  subset.epc = direct.filter(([, , m]) => m.length);
  subset.epcGroups = whole.filter(([, , m]) => m.length);
  writeSubset(subset, (counts) => ({ ...counts, epcClasses: subset.epc.length, epcGroups: subset.epcGroups.length }));
  process.stderr.write(`EPC: ${subset.epc.length} classes with direct members, ${subset.epcGroups.length} grouping nodes\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
