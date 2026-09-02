const ATTRIBUTION_KEYS = new Set(["author", "source", "modified"]);
const MYSTERY_KEYS = new Set([
  "schemaVersion", "packType", "id", "title", "license", "attribution",
  "clueFragments", "artifacts", "actionAffordances",
]);
const CLUE_KEYS = new Set([
  "schemaVersion", "id", "sourceEventId", "observedPhenomenon", "subjects",
  "visibilityRule", "reliabilityHint",
]);
const VISIBILITY_KEYS = new Set(["kind", "anchorId", "minimumTrust"]);
const ARTIFACT_KEYS = new Set([
  "schemaVersion", "itemId", "observableActions", "conditionRules", "boundedEffects", "feedbackClass",
]);
const CONDITION_KEYS = new Set(["id", "pathId", "acceptedActions", "observedFragmentIds", "worldSignals", "minimumWitnesses"]);
const EFFECT_KEYS = new Set(["id", "pathId", "kind", "magnitude", "durationTicks"]);
const CLAIM_KEYS = new Set([
  "schemaVersion", "id", "ownerActorId", "kind", "proposition", "sourceIds",
  "confidence", "receivedFromActorId", "transformationNote", "logicalTime",
]);
const EXPERIMENT_KEYS = new Set([
  "schemaVersion", "id", "actorId", "mysteryId", "artifactId", "action",
  "sourceEventIds", "logicalTime",
]);
const WORLD_CONTEXT_KEYS = new Set(["acceptedEventIds", "observedFragmentIds", "worldSignals", "witnessActorIds"]);
const EFFECT_DECISION_KEYS = new Set([
  "schemaVersion", "mysteryId", "artifactId", "sourceEventIds", "effectId",
  "effectKind", "magnitude", "durationTicks", "feedbackClass",
]);
const IDENTIFIER = /^[a-z][a-z0-9-]{2,63}$/u;
const ACTION = /^[a-z][a-z0-9_]{1,47}$/u;
const SIGNAL = /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9-]{0,47}$/u;
const FORBIDDEN_KEYS = new Set([
  "answer", "canonicalanswer", "standardanswer", "solution", "truth", "truthscore",
  "quest", "queststep", "nextstep", "requiredorder", "keyitem", "keylabel",
  "objective", "goal", "expectedoutcome", "ending", "plotstage", "chapter",
  "assignedactorids", "requiredcharacters", "progress", "progresspercent",
]);
const AUTHORED_RESOLUTION_TEXT = /唯一(?:标准)?(?:答案|解答|真相|路径)|标准答案|正确答案|固定(?:谜底|解法|结局)|(?:谜底|答案|解法|真相).{0,8}(?:是|为|就是|就在|等于|：|:)|真正(?:原因|用途|解法)(?:是|为)|必须按(?:照)?(?:以下|这个|唯一)|(?:打开|开启).{0,12}(?:唯一|指定).{0,12}(?:物品|动作|顺序)|canonical\s*answer|standard\s*answer|correct\s*answer|only\s+(?:answer|solution|path)|(?:answer|solution)\s+is/iu;

function containsAuthoredResolution(value) {
  const normalized = value.normalize("NFKC");
  const compact = normalized.replace(/[\p{P}\p{S}\p{Cf}\s]+/gu, "");
  return AUTHORED_RESOLUTION_TEXT.test(normalized) || AUTHORED_RESOLUTION_TEXT.test(compact);
}

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function text(value, maximum = 320) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function integer(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function list(value, minimum, maximum, predicate) {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum && value.every(predicate);
}

function uniqueStrings(value, minimum, maximum, maximumLength = 96, pattern) {
  return list(value, minimum, maximum, (item) => text(item, maximumLength) && (!pattern || pattern.test(item)))
    && new Set(value).size === value.length;
}

function attribution(value) {
  return exactObject(value, ATTRIBUTION_KEYS) && text(value.author, 120) && text(value.source, 200)
    && typeof value.modified === "boolean";
}

function rejectAuthoredResolution(value, coordinate = "root") {
  if (typeof value === "string") {
    if (containsAuthoredResolution(value)) throw new Error(`${coordinate} 含面向角色的谜底或唯一解法文本`);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((item, index) => rejectAuthoredResolution(item, `${coordinate}[${index}]`));
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLocaleLowerCase())) throw new Error(`${coordinate}.${key} 是禁止的谜底、任务或剧情控制字段`);
    rejectAuthoredResolution(child, `${coordinate}.${key}`);
  }
}

export function validateClueFragment(value, coordinate = "ClueFragment") {
  if (!exactObject(value, CLUE_KEYS) || value.schemaVersion !== 1 || !IDENTIFIER.test(value.id)
    || !text(value.sourceEventId, 96) || !text(value.observedPhenomenon, 360)
    || !uniqueStrings(value.subjects, 1, 12)
    || !exactObject(value.visibilityRule, VISIBILITY_KEYS)
    || !["public", "place", "relationship", "encounter"].includes(value.visibilityRule.kind)
    || !text(value.visibilityRule.anchorId, 96) || !integer(value.visibilityRule.minimumTrust, 0, 100)
    || !["unknown", "contested", "corroborated"].includes(value.reliabilityHint)) {
    throw new Error(`${coordinate} 不符合 ClueFragment v1`);
  }
  rejectAuthoredResolution(value, coordinate);
  return structuredClone(value);
}

export function validateArtifactAffordance(value, coordinate = "ArtifactAffordance") {
  if (!exactObject(value, ARTIFACT_KEYS) || value.schemaVersion !== 1 || !IDENTIFIER.test(value.itemId)
    || !uniqueStrings(value.observableActions, 2, 12, 48, ACTION)
    || !list(value.conditionRules, 2, 8, (rule) => exactObject(rule, CONDITION_KEYS)
      && IDENTIFIER.test(rule.id) && IDENTIFIER.test(rule.pathId)
      && uniqueStrings(rule.acceptedActions, 1, 8, 48, ACTION)
      && uniqueStrings(rule.observedFragmentIds, 1, 12)
      && uniqueStrings(rule.worldSignals, 0, 8, 80, SIGNAL)
      && integer(rule.minimumWitnesses, 1, 12))
    || !list(value.boundedEffects, 2, 8, (effect) => exactObject(effect, EFFECT_KEYS)
      && IDENTIFIER.test(effect.id) && IDENTIFIER.test(effect.pathId)
      && ["observation_pulse", "artifact_resonance", "resource_pulse"].includes(effect.kind)
      && integer(effect.magnitude, 1, 100) && integer(effect.durationTicks, 1, 240))
    || !["faint", "ambiguous", "resonant"].includes(value.feedbackClass)) {
    throw new Error(`${coordinate} 不符合 ArtifactAffordance v1`);
  }
  const pathIds = new Set(value.conditionRules.map((rule) => rule.pathId));
  const acceptedActions = value.conditionRules.flatMap((rule) => rule.acceptedActions);
  if (pathIds.size < 2 || value.conditionRules.some((rule) => rule.acceptedActions.some((action) => !value.observableActions.includes(action)))) {
    throw new Error(`${coordinate} 必须提供至少两条可观察、不同的合法路径`);
  }
  if (new Set(acceptedActions).size !== acceptedActions.length) throw new Error(`${coordinate} 的路径动作不得重叠，以免同一实验命中多个效果`);
  if (new Set(value.boundedEffects.map((effect) => effect.id)).size !== value.boundedEffects.length
    || value.boundedEffects.some((effect) => !pathIds.has(effect.pathId))
    || [...pathIds].some((pathId) => value.boundedEffects.filter((effect) => effect.pathId === pathId).length !== 1)) {
    throw new Error(`${coordinate} 的效果与条件路径引用不闭合`);
  }
  rejectAuthoredResolution(value, coordinate);
  return structuredClone(value);
}

export function validateMysterySeed(value, coordinate = "MysterySeed") {
  if (!exactObject(value, MYSTERY_KEYS) || value.schemaVersion !== 1 || value.packType !== "mystery-seed"
    || !IDENTIFIER.test(value.id) || !text(value.title, 80) || value.license !== "CC-BY-4.0"
    || !attribution(value.attribution)
    || !list(value.clueFragments, 3, 16, (clue, index) => {
      try { validateClueFragment(clue, `${coordinate}.clueFragments[${index}]`); return true; } catch { return false; }
    })
    || !list(value.artifacts, 1, 6, (artifact, index) => {
      try { validateArtifactAffordance(artifact, `${coordinate}.artifacts[${index}]`); return true; } catch { return false; }
    })
    || !uniqueStrings(value.actionAffordances, 5, 24, 48, ACTION)) {
    throw new Error(`${coordinate} 不符合 MysterySeed v1`);
  }
  const clueIds = new Set(value.clueFragments.map((clue) => clue.id));
  const artifactIds = new Set(value.artifacts.map((artifact) => artifact.itemId));
  if (clueIds.size !== value.clueFragments.length || artifactIds.size !== value.artifacts.length
    || value.artifacts.some((artifact) => artifact.conditionRules.some((rule) => rule.observedFragmentIds.some((id) => !clueIds.has(id))))) {
    throw new Error(`${coordinate} 含重复或悬挂的线索/物品引用`);
  }
  const paths = new Set(value.artifacts.flatMap((artifact) => artifact.conditionRules.map((rule) => `${artifact.itemId}:${rule.pathId}`)));
  if (paths.size < 2) throw new Error(`${coordinate} 至少需要两条合法推进路径`);
  rejectAuthoredResolution(value, coordinate);
  const aggregateText = collectStrings(value).join("");
  if (containsAuthoredResolution(aggregateText)) throw new Error(`${coordinate} 跨字段拼接后形成谜底或唯一解法文本`);
  return structuredClone(value);
}

function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

export function validateClaimRecord(value, coordinate = "ClaimRecord") {
  if (!exactObject(value, CLAIM_KEYS) || value.schemaVersion !== 1 || !text(value.id, 96)
    || !text(value.ownerActorId, 96) || !["belief", "rumor"].includes(value.kind)
    || !text(value.proposition, 360) || !uniqueStrings(value.sourceIds, 1, 24)
    || !integer(value.confidence, 1, 99)
    || !(value.receivedFromActorId === null || text(value.receivedFromActorId, 96))
    || !(value.transformationNote === null || text(value.transformationNote, 240))
    || !integer(value.logicalTime, 0, Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: "claim_record_contract" };
  }
  if (value.kind === "belief" && value.receivedFromActorId !== null) return { ok: false, reason: "belief_has_sender" };
  if (value.kind === "rumor" && value.receivedFromActorId === null) return { ok: false, reason: "rumor_missing_sender" };
  return { ok: true, value: structuredClone(value) };
}

export function validateExperimentIntent(value) {
  if (!exactObject(value, EXPERIMENT_KEYS) || value.schemaVersion !== 1 || !text(value.id, 96)
    || !text(value.actorId, 96) || !IDENTIFIER.test(value.mysteryId) || !IDENTIFIER.test(value.artifactId)
    || !ACTION.test(value.action) || !uniqueStrings(value.sourceEventIds, 1, 24)
    || !integer(value.logicalTime, 0, Number.MAX_SAFE_INTEGER)) return { ok: false, reason: "experiment_intent_contract" };
  return { ok: true, value: structuredClone(value) };
}

export function validateWorldContext(value) {
  if (!exactObject(value, WORLD_CONTEXT_KEYS) || !uniqueStrings(value.acceptedEventIds, 1, 128)
    || !uniqueStrings(value.observedFragmentIds, 1, 24)
    || !uniqueStrings(value.worldSignals, 0, 24, 80, SIGNAL)
    || !uniqueStrings(value.witnessActorIds, 1, 24)) return { ok: false, reason: "world_context_contract" };
  return { ok: true, value: structuredClone(value) };
}

export function validateWorldEffectDecision(value) {
  if (!exactObject(value, EFFECT_DECISION_KEYS) || value.schemaVersion !== 1
    || !IDENTIFIER.test(value.mysteryId) || !IDENTIFIER.test(value.artifactId)
    || !uniqueStrings(value.sourceEventIds, 1, 24)
    || !(value.effectId === null || IDENTIFIER.test(value.effectId))
    || !(value.effectKind === null || ["observation_pulse", "artifact_resonance", "resource_pulse"].includes(value.effectKind))
    || !(value.magnitude === null || integer(value.magnitude, 1, 100))
    || !(value.durationTicks === null || integer(value.durationTicks, 1, 240))
    || !["faint", "ambiguous", "resonant"].includes(value.feedbackClass)) return { ok: false, reason: "world_effect_decision_contract" };
  const bounded = [value.effectKind, value.magnitude, value.durationTicks];
  if (value.effectId === null ? bounded.some((item) => item !== null) : bounded.some((item) => item === null)) {
    return { ok: false, reason: "world_effect_decision_mismatch" };
  }
  return { ok: true, value: structuredClone(value) };
}

export const MYSTERY_HIDDEN_KEYS = Object.freeze([
  "conditionRules", "boundedEffects", "observedFragmentIds", "worldSignals", "minimumWitnesses", "pathId", "effectId", "effectKind", "magnitude", "durationTicks",
]);
