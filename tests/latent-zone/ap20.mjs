import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  projectLatentZoneForLocalMind,
  validateLatentZonePack,
} from "../../packages/latent-zone/src/index.js";

const pack = validateLatentZonePack(JSON.parse(
  await readFile(new URL("../../world/latent-zones/unregistered-interval.json", import.meta.url), "utf8"),
));
const projection = projectLatentZoneForLocalMind(pack);
const report = { alternatives: [], factorAffordances: 0, hiddenFields: 0, continuingEvents: 0 };
for (const alternative of pack.thresholdAlternatives) {
  const factors = [...alternative.artifactStates, ...alternative.worldPredicates, ...alternative.socialPredicates, ...alternative.actionSequence];
  assert.ok(factors.every((factor) => pack.evidenceAffordances.some((item) => item.factorValue === factor)));
  report.factorAffordances += factors.length;
  report.alternatives.push(alternative.id);
}
for (const hidden of ["zoneId", "thresholdAlternatives", "onSatisfied", "actionSequence"]) {
  assert.equal(JSON.stringify(projection).includes(hidden), false);
  report.hiddenFields += 1;
}
assert.equal(report.alternatives.length, 2);
assert.ok(pack.eventPool.every((event) => event.actionAffordances.length >= 2));
report.continuingEvents = pack.eventPool.length;
console.log(JSON.stringify(report, null, 2));
