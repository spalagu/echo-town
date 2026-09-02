import { PERSONA_FIXTURES } from "@echo-town/persona-core";
import {
  validateClaimRecord,
  validateExperimentIntent,
  validateMysterySeed,
  validateWorldEffectDecision,
} from "./contracts.js";
import { projectMysteryForLocalMind, validateLocalMindMysteryProjection } from "./projection.js";
import { ExperimentRuleEvaluator } from "./world-effect-gate.js";

const RESULT_KEYS = new Set([
  "schemaVersion", "mysteryId", "personaId", "seed", "interpretationId", "resolvedPathId",
  "observationOrder", "events", "claims", "experimentIntent", "effectDecision", "localMindProjection",
]);
const CLUE_EVENT_KEYS = new Set([
  "schemaVersion", "id", "eventType", "actorId", "mysteryId", "clueId", "visibilityProof", "sourceEventIds", "logicalTime", "origin",
]);
const VISIBILITY_PROOF_KEYS = new Set(["kind", "anchorId", "trust"]);
const SHARE_EVENT_KEYS = new Set([
  "schemaVersion", "id", "eventType", "actorId", "audienceActorIds", "sourceClaimId", "sourceEventIds", "logicalTime", "origin",
]);
const INTERPRETATIONS = Object.freeze([
  ["material", "这些现象也许来自某种会被环境改变的材料，而不是一个等着被揭晓的秘密。"],
  ["social", "这些痕迹或许是不同居民反复行动后叠加出来的，传闻只是把它们连在了一起。"],
  ["rhythmic", "这些现象似乎跟某种重复节律同向变化，但目前的反例仍然太少。"],
  ["relational", "物品的反应或许取决于谁与谁共同见证，而不是物品本身具有固定用途。"],
  ["skeptical", "眼前只有互相冲突的局部现象，最稳妥的解释是暂时不把它们合并成一个结论。"],
]);

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rotate(values, offset) {
  const index = offset % values.length;
  return [...values.slice(index), ...values.slice(0, index)];
}

function visibilityProof(clue, persona, seed) {
  const trust = clue.visibilityRule.kind === "relationship"
    ? stableHash(`${persona.id}:${clue.visibilityRule.anchorId}:${seed}:trust`) % 101
    : 0;
  return { kind: clue.visibilityRule.kind, anchorId: clue.visibilityRule.anchorId, trust };
}

function observationSequence(mystery, persona, seed) {
  const ordered = mystery.clueFragments
    .filter((clue) => visibilityProof(clue, persona, seed).trust >= clue.visibilityRule.minimumTrust)
    .sort((left, right) => stableHash(`${seed}:${persona.id}:${left.id}`) - stableHash(`${seed}:${persona.id}:${right.id}`));
  return rotate(ordered, stableHash(`${mystery.id}:${seed}:order`));
}

function interpretationFor(persona, mysteryId, seed, visibleClues) {
  const traitSignal = Object.values(persona.traits).reduce((sum, value, index) => sum + value * (index + 1), 0);
  const evidenceSignal = stableHash(visibleClues.map((clue) => `${clue.id}:${clue.observedPhenomenon}`).join("|"));
  const index = (stableHash(`${mysteryId}:${persona.id}:${seed}`) + traitSignal + evidenceSignal) % INTERPRETATIONS.length;
  return INTERPRETATIONS[index];
}

function experimentContext(mystery, artifact, persona, secondPersona, seed, visibleClues, events) {
  const signalPool = [...new Set(artifact.conditionRules.flatMap((rule) => rule.worldSignals))].sort();
  const signal = signalPool.length ? signalPool[stableHash(`${mystery.id}:${persona.id}:${seed}:signal`) % signalPool.length] : null;
  const includeSecondWitness = stableHash(`${persona.id}:${seed}:witness`) % 3 !== 0;
  return {
    acceptedEventIds: events.filter((event) => event.eventType === "ClueObservedProjection").map((event) => event.id),
    observedFragmentIds: visibleClues.map((clue) => clue.id),
    worldSignals: signal ? [signal] : [],
    witnessActorIds: includeSecondWitness ? [persona.id, secondPersona.id] : [persona.id],
  };
}

function claimOrThrow(value) {
  const result = validateClaimRecord(value);
  if (!result.ok) throw new Error(`ClaimRecord 被拒绝：${result.reason}`);
  return result.value;
}

export function simulateMystery(rawMystery, rawPersona, seed) {
  const mystery = validateMysterySeed(rawMystery);
  const persona = PERSONA_FIXTURES.find((item) => item.id === rawPersona?.id);
  if (!persona) throw new Error("模拟器只接受 12 个冻结人格之一");
  if (!Number.isInteger(seed) || seed < 0 || seed > 1_000_000) throw new Error("mystery seed 非法");

  const artifact = mystery.artifacts[stableHash(`${mystery.id}:${persona.id}`) % mystery.artifacts.length];
  const visibleClues = observationSequence(mystery, persona, seed);
  const observationOrder = visibleClues.map((clue) => clue.id);
  const events = visibleClues.map((clue, index) => ({
    schemaVersion: 1,
    id: clue.sourceEventId,
    eventType: "ClueObservedProjection",
    actorId: persona.id,
    mysteryId: mystery.id,
    clueId: clue.id,
    visibilityProof: visibilityProof(clue, persona, seed),
    sourceEventIds: [],
    logicalTime: index + 1,
    origin: "content-genesis-projection",
  }));
  const [interpretationId, proposition] = interpretationFor(persona, mystery.id, seed, visibleClues);
  const belief = claimOrThrow({
    schemaVersion: 1,
    id: `claim-${mystery.id}-${persona.id}-${seed}-belief`,
    ownerActorId: persona.id,
    kind: "belief",
    proposition,
    sourceIds: visibleClues.map((clue) => clue.sourceEventId),
    confidence: 35 + (stableHash(`${persona.id}:${seed}:confidence`) % 50),
    receivedFromActorId: null,
    transformationNote: null,
    logicalTime: events.length + 1,
  });
  const secondPersona = PERSONA_FIXTURES[(PERSONA_FIXTURES.indexOf(persona) + 1 + (seed % (PERSONA_FIXTURES.length - 1))) % PERSONA_FIXTURES.length];
  const shareEvent = {
    schemaVersion: 1,
    id: `event-claim-shared-${mystery.id}-${persona.id}-${secondPersona.id}-${seed}`,
    eventType: "ClaimSharedProjection",
    actorId: persona.id,
    audienceActorIds: [secondPersona.id],
    sourceClaimId: belief.id,
    sourceEventIds: [...belief.sourceIds],
    logicalTime: belief.logicalTime + 1,
    origin: "non-authoritative-simulation",
  };
  events.push(shareEvent);
  const secondLens = INTERPRETATIONS[(INTERPRETATIONS.findIndex(([id]) => id === interpretationId) + 1 + seed) % INTERPRETATIONS.length];
  const rumor = claimOrThrow({
    schemaVersion: 1,
    id: `claim-${mystery.id}-${secondPersona.id}-${seed}-rumor`,
    ownerActorId: secondPersona.id,
    kind: "rumor",
    proposition: secondLens[1],
    sourceIds: [belief.id, shareEvent.id, ...belief.sourceIds],
    confidence: Math.max(20, belief.confidence - 8 + (seed % 9)),
    receivedFromActorId: persona.id,
    transformationNote: seed % 3 === 0 ? "保留了疑问，但把关注点从物品转向了共同见证者。" : "转述时保留来源，并加入了自己的反例。",
    logicalTime: shareEvent.logicalTime + 1,
  });
  const claims = [belief, rumor];

  const projection = projectMysteryForLocalMind(mystery, observationOrder);
  const context = experimentContext(mystery, artifact, persona, secondPersona, seed, visibleClues, events);
  const action = artifact.observableActions[stableHash(`${persona.id}:${interpretationId}:${observationOrder.join(":")}:${seed}`) % artifact.observableActions.length];
  const intent = {
    schemaVersion: 1,
    id: `experiment-${mystery.id}-${persona.id}-${seed}`,
    actorId: persona.id,
    mysteryId: mystery.id,
    artifactId: artifact.itemId,
    action,
    sourceEventIds: context.acceptedEventIds,
    logicalTime: rumor.logicalTime + 1,
  };
  const effectDecision = new ExperimentRuleEvaluator(mystery, context).evaluate(intent);
  const resolvedPathId = effectDecision.effectId === null ? null : artifact.boundedEffects.find((effect) => effect.id === effectDecision.effectId)?.pathId ?? null;
  const result = {
    schemaVersion: 1,
    mysteryId: mystery.id,
    personaId: persona.id,
    seed,
    interpretationId,
    resolvedPathId,
    observationOrder,
    events,
    claims,
    experimentIntent: intent,
    effectDecision,
    localMindProjection: projection,
  };
  const validation = validateMysterySimulation(result, mystery);
  if (!validation.ok) throw new Error(`谜团模拟不变量失败：${validation.reason}`);
  return result;
}

export function validateMysterySimulation(result, rawMystery) {
  let mystery;
  try { mystery = validateMysterySeed(rawMystery); } catch { return { ok: false, reason: "mystery_contract" }; }
  if (!exactObject(result, RESULT_KEYS) || result.schemaVersion !== 1 || result.mysteryId !== mystery.id
    || !Number.isInteger(result.seed) || result.seed < 0 || result.seed > 1_000_000
    || !Array.isArray(result.events) || !Array.isArray(result.claims)
    || !Array.isArray(result.observationOrder) || new Set(result.observationOrder).size !== result.observationOrder.length) {
    return { ok: false, reason: "simulation_contract" };
  }
  const persona = PERSONA_FIXTURES.find((item) => item.id === result.personaId);
  if (!persona) return { ok: false, reason: "persona" };
  const projection = validateLocalMindMysteryProjection(result.localMindProjection);
  if (!projection.ok) return { ok: false, reason: projection.reason };
  let expectedProjection;
  try {
    expectedProjection = projectMysteryForLocalMind(mystery, result.observationOrder);
  } catch {
    return { ok: false, reason: "projection_source" };
  }
  if (JSON.stringify(projection.value) !== JSON.stringify(expectedProjection)) return { ok: false, reason: "projection_content" };
  if (projection.value.visibleClues.map((clue) => clue.id).join("|") !== result.observationOrder.join("|")) return { ok: false, reason: "projection_observation_order" };
  const clueById = new Map(mystery.clueFragments.map((clue) => [clue.id, clue]));
  const expectedClues = observationSequence(mystery, persona, result.seed);
  if (expectedClues.map((clue) => clue.id).join("|") !== result.observationOrder.join("|")) return { ok: false, reason: "observation_order" };
  const [expectedInterpretationId, expectedProposition] = interpretationFor(persona, mystery.id, result.seed, expectedClues);
  if (result.interpretationId !== expectedInterpretationId) return { ok: false, reason: "interpretation" };

  const clueEvents = result.events.filter((event) => event.eventType === "ClueObservedProjection");
  const shareEvents = result.events.filter((event) => event.eventType === "ClaimSharedProjection");
  if (clueEvents.length !== result.observationOrder.length || shareEvents.length !== 1 || result.events.length !== clueEvents.length + 1) {
    return { ok: false, reason: "event_set" };
  }
  for (const [index, event] of clueEvents.entries()) {
    const clue = clueById.get(result.observationOrder[index]);
    if (!exactObject(event, CLUE_EVENT_KEYS) || !clue || event.schemaVersion !== 1 || event.id !== clue.sourceEventId
      || event.actorId !== result.personaId || event.mysteryId !== mystery.id || event.clueId !== clue.id
      || !exactObject(event.visibilityProof, VISIBILITY_PROOF_KEYS)
      || JSON.stringify(event.visibilityProof) !== JSON.stringify(visibilityProof(clue, persona, result.seed))
      || event.visibilityProof.trust < clue.visibilityRule.minimumTrust
      || event.sourceEventIds.length !== 0 || event.logicalTime !== index + 1 || event.origin !== "content-genesis-projection") {
      return { ok: false, reason: "clue_event_contract" };
    }
  }

  if (result.claims.length !== 2) return { ok: false, reason: "claim_count" };
  const [belief, rumor] = result.claims;
  if (!validateClaimRecord(belief).ok || !validateClaimRecord(rumor).ok
    || belief.kind !== "belief" || belief.ownerActorId !== result.personaId || belief.proposition !== expectedProposition
    || belief.logicalTime !== clueEvents.length + 1
    || belief.sourceIds.join("|") !== clueEvents.map((event) => event.id).join("|")
    || rumor.kind !== "rumor" || rumor.receivedFromActorId !== belief.ownerActorId || rumor.ownerActorId === belief.ownerActorId) {
    return { ok: false, reason: "claim_topology" };
  }
  const share = shareEvents[0];
  if (!exactObject(share, SHARE_EVENT_KEYS) || share.schemaVersion !== 1 || share.actorId !== belief.ownerActorId
    || share.audienceActorIds.length !== 1 || share.audienceActorIds[0] !== rumor.ownerActorId
    || share.sourceClaimId !== belief.id || share.sourceEventIds.join("|") !== belief.sourceIds.join("|")
    || share.logicalTime !== belief.logicalTime + 1 || share.origin !== "non-authoritative-simulation"
    || rumor.logicalTime !== share.logicalTime + 1 || !rumor.sourceIds.includes(belief.id) || !rumor.sourceIds.includes(share.id)
    || belief.sourceIds.some((id) => !rumor.sourceIds.includes(id))) {
    return { ok: false, reason: "claim_shared_event_topology" };
  }

  if (!validateExperimentIntent(result.experimentIntent).ok || !validateWorldEffectDecision(result.effectDecision).ok
    || result.experimentIntent.logicalTime <= rumor.logicalTime
    || result.experimentIntent.sourceEventIds.some((id) => !clueEvents.some((event) => event.id === id))) {
    return { ok: false, reason: "experiment_topology" };
  }
  const artifact = mystery.artifacts.find((item) => item.itemId === result.experimentIntent.artifactId);
  if (!artifact) return { ok: false, reason: "experiment_artifact" };
  const context = experimentContext(mystery, artifact, persona, { id: rumor.ownerActorId }, result.seed, expectedClues, result.events);
  const expectedAction = artifact.observableActions[stableHash(`${persona.id}:${result.interpretationId}:${result.observationOrder.join(":")}:${result.seed}`) % artifact.observableActions.length];
  if (result.experimentIntent.actorId !== persona.id || result.experimentIntent.mysteryId !== mystery.id
    || result.experimentIntent.action !== expectedAction
    || result.experimentIntent.sourceEventIds.join("|") !== context.acceptedEventIds.join("|")) {
    return { ok: false, reason: "experiment_decision" };
  }
  const expectedDecision = new ExperimentRuleEvaluator(mystery, context).evaluate(result.experimentIntent);
  if (JSON.stringify(result.effectDecision) !== JSON.stringify(expectedDecision)) return { ok: false, reason: "effect_decision" };
  const expectedPath = result.effectDecision.effectId === null ? null : artifact?.boundedEffects.find((effect) => effect.id === result.effectDecision.effectId)?.pathId ?? null;
  if (result.resolvedPathId !== expectedPath) return { ok: false, reason: "resolved_path" };
  return { ok: true };
}
