import { gateIntentProposals, sanitizeObservation } from "./contracts.js";

function axisStep(value) {
  return Math.sign(value);
}

function placeScore(place, urgentNeed) {
  const matchesNeed = place.tags.includes(urgentNeed.kind) ? 1_000 : 0;
  return matchesNeed + urgentNeed.level * 10 - Math.abs(place.dx) - Math.abs(place.dy);
}

export function decideByRules(rawObservation) {
  const observation = sanitizeObservation(rawObservation);
  const urgentNeed = [...observation.needs].sort((left, right) => right.level - left.level)[0] ?? { kind: "wander", level: 0 };
  const target = [...observation.nearbyPlaces]
    .sort((left, right) => placeScore(right, urgentNeed) - placeScore(left, urgentNeed) || left.id.localeCompare(right.id))[0];
  const dx = target ? axisStep(target.dx) : (observation.logicalTime % 2 === 0 ? 1 : -1);
  const dy = target ? axisStep(target.dy) : (observation.logicalTime % 3 === 0 ? 1 : 0);
  const proposal = {
    schemaVersion: 1,
    intentType: "move",
    payload: dx === 0 && dy === 0 ? { dx: 1, dy: 0 } : { dx, dy },
    budget: Math.min(100, Math.max(1, 1 + Math.floor(urgentNeed.level / 20))),
    reasonCode: target ? `seek_${urgentNeed.kind}` : "keep_walking",
  };
  const gated = gateIntentProposals([proposal]);
  if (!gated.ok) throw new Error(`规则器产生非法 Intent：${gated.reason}`);
  return gated.intents;
}
