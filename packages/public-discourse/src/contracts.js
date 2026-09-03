const ATTRIBUTION_KEYS = new Set(["author", "source", "modified"]);
const INITIAL_KEYS = new Set(["schemaVersion", "packType", "id", "title", "license", "attribution", "places", "resources", "observations", "tensions", "actionAffordances"]);
const PLACE_KEYS = new Set(["id", "title", "tags"]);
const RESOURCE_KEYS = new Set(["id", "quantity", "replenishesPerTick", "expiresAfterTicks"]);
const OBSERVATION_KEYS = new Set(["id", "fact", "placeId", "visibility", "salience"]);
const TENSION_KEYS = new Set(["id", "resourceId", "pressure", "uncertainty"]);
const SITUATION_KEYS = new Set(["schemaVersion", "packType", "id", "title", "license", "attribution", "trigger", "observations", "resourceDeltas", "actionAffordances"]);
const TRIGGER_KEYS = new Set(["kind", "startTick", "durationTicks", "intensity"]);
const SITUATION_OBSERVATION_KEYS = new Set(["fact", "visibility", "tags"]);
const RESOURCE_DELTA_KEYS = new Set(["resourceId", "amount", "expiresAfterTicks"]);
const CLAIM_KEYS = new Set(["schemaVersion", "id", "speakerActorId", "stance", "statement", "sourceEventIds", "audienceActorIds", "parentClaimId", "refutesClaimId", "mutationDepth", "heat", "logicalTime"]);
const SUMMARY_KEYS = new Set(["schemaVersion", "id", "title", "summary", "sourceEventIds", "generatedAtTick", "readOnly"]);
const PLANNER_KEYS = new Set(["actorId", "tick", "visibleEventIds", "memoryIds", "claimIds", "resourceSignals", "situationTags"]);
const RESOURCE_SIGNAL_KEYS = new Set(["resourceId", "level", "trend"]);
const IDENTIFIER = /^[a-z][a-z0-9-]{2,63}$/u;
const ACTION = /^[a-z][a-z0-9_]{1,47}$/u;
const FORBIDDEN_KEYS = new Set([
  "castslots", "participants", "assignedactorids", "requiredcharacters", "goal", "objective",
  "plotstage", "chapter", "requiredturn", "expectedoutcome", "outcome", "ending", "authorarc",
  "consensus", "globalconsensus", "truthscore", "plannergoal", "historicalsummary", "summaryasgoal",
]);

function object(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function text(value, maximum = 240) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function integer(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function list(value, minimum, maximum, predicate) {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum && value.every(predicate);
}

function uniqueStrings(value, minimum, maximum, itemMaximum = 96) {
  return list(value, minimum, maximum, (item) => text(item, itemMaximum)) && new Set(value).size === value.length;
}

function attribution(value) {
  return object(value, ATTRIBUTION_KEYS) && text(value.author, 120) && text(value.source, 200) && typeof value.modified === "boolean";
}

function rejectStoryControl(value, coordinate = "root") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((item, index) => rejectStoryControl(item, `${coordinate}[${index}]`));
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLocaleLowerCase())) throw new Error(`${coordinate}.${key} 是禁止的剧情控制或摘要回灌字段`);
    rejectStoryControl(child, `${coordinate}.${key}`);
  }
}

export function validateInitialStatePack(value, coordinate = "InitialStatePack") {
  if (!object(value, INITIAL_KEYS) || value.schemaVersion !== 1 || value.packType !== "initial-state"
    || !IDENTIFIER.test(value.id) || !text(value.title, 80) || value.license !== "CC-BY-4.0" || !attribution(value.attribution)
    || !list(value.places, 2, 24, (place) => object(place, PLACE_KEYS) && IDENTIFIER.test(place.id)
      && text(place.title, 80) && uniqueStrings(place.tags, 1, 8, 32))
    || !list(value.resources, 1, 24, (resource) => object(resource, RESOURCE_KEYS) && IDENTIFIER.test(resource.id)
      && integer(resource.quantity, 1, 10_000) && integer(resource.replenishesPerTick, 0, 100)
      && integer(resource.expiresAfterTicks, 0, 10_000))
    || !list(value.observations, 2, 48, (observation) => object(observation, OBSERVATION_KEYS)
      && IDENTIFIER.test(observation.id) && text(observation.fact, 320) && IDENTIFIER.test(observation.placeId)
      && ["public", "local"].includes(observation.visibility) && integer(observation.salience, 1, 100))
    || !list(value.tensions, 1, 16, (tension) => object(tension, TENSION_KEYS) && IDENTIFIER.test(tension.id)
      && IDENTIFIER.test(tension.resourceId) && integer(tension.pressure, 1, 100) && integer(tension.uncertainty, 1, 100))
    || !uniqueStrings(value.actionAffordances, 4, 24, 48) || value.actionAffordances.some((action) => !ACTION.test(action))) {
    throw new Error(`${coordinate} 不符合 InitialStatePack v1`);
  }
  const placeIds = new Set(value.places.map((place) => place.id));
  const resourceIds = new Set(value.resources.map((resource) => resource.id));
  if (placeIds.size !== value.places.length || resourceIds.size !== value.resources.length
    || value.observations.some((item) => !placeIds.has(item.placeId))
    || value.tensions.some((item) => !resourceIds.has(item.resourceId))) throw new Error(`${coordinate} 引用不存在或重复`);
  rejectStoryControl(value, coordinate);
  return structuredClone(value);
}

export function validateSituationSeed(value, coordinate = "SituationSeed") {
  if (!object(value, SITUATION_KEYS) || value.schemaVersion !== 1 || value.packType !== "situation-seed"
    || !IDENTIFIER.test(value.id) || !text(value.title, 80) || value.license !== "CC-BY-4.0" || !attribution(value.attribution)
    || !object(value.trigger, TRIGGER_KEYS) || !["weather", "scarcity", "arrival", "malfunction", "signal"].includes(value.trigger.kind)
    || !integer(value.trigger.startTick, 0, 1_000_000) || !integer(value.trigger.durationTicks, 1, 10_000)
    || !integer(value.trigger.intensity, 1, 100)
    || !list(value.observations, 1, 16, (item) => object(item, SITUATION_OBSERVATION_KEYS)
      && text(item.fact, 320) && ["public", "local"].includes(item.visibility) && uniqueStrings(item.tags, 1, 6, 32))
    || !list(value.resourceDeltas, 1, 12, (item) => object(item, RESOURCE_DELTA_KEYS) && IDENTIFIER.test(item.resourceId)
      && integer(item.amount, -1_000, 1_000) && item.amount !== 0 && integer(item.expiresAfterTicks, 1, 10_000))
    || !uniqueStrings(value.actionAffordances, 3, 16, 48) || value.actionAffordances.some((action) => !ACTION.test(action))) {
    throw new Error(`${coordinate} 不符合 SituationSeed v1`);
  }
  rejectStoryControl(value, coordinate);
  return structuredClone(value);
}

export function validateDiscourseClaim(value) {
  if (!object(value, CLAIM_KEYS) || value.schemaVersion !== 1 || !text(value.id, 96) || !text(value.speakerActorId, 96)
    || !["support", "oppose", "uncertain"].includes(value.stance) || !text(value.statement, 320)
    || !uniqueStrings(value.sourceEventIds, 1, 16) || !uniqueStrings(value.audienceActorIds, 0, 32)
    || !(value.parentClaimId === null || text(value.parentClaimId, 96))
    || !(value.refutesClaimId === null || text(value.refutesClaimId, 96))
    || !integer(value.mutationDepth, 0, 16) || !integer(value.heat, 0, 100)
    || !integer(value.logicalTime, 0, Number.MAX_SAFE_INTEGER)) return { ok: false, reason: "claim_contract" };
  if (value.parentClaimId === value.id || value.refutesClaimId === value.id) return { ok: false, reason: "claim_self_reference" };
  return { ok: true, value: structuredClone(value) };
}

export function validateHistoricalSummary(value) {
  if (!object(value, SUMMARY_KEYS) || value.schemaVersion !== 1 || !text(value.id, 96) || !text(value.title, 120)
    || !text(value.summary, 1_000) || !uniqueStrings(value.sourceEventIds, 1, 512)
    || !integer(value.generatedAtTick, 0, Number.MAX_SAFE_INTEGER) || value.readOnly !== true) {
    return { ok: false, reason: "historical_summary_contract" };
  }
  return { ok: true, value: structuredClone(value) };
}

export function validatePlannerObservation(value) {
  if (!object(value, PLANNER_KEYS) || !text(value.actorId, 96) || !integer(value.tick, 0, Number.MAX_SAFE_INTEGER)
    || !uniqueStrings(value.visibleEventIds, 0, 64) || !uniqueStrings(value.memoryIds, 0, 12)
    || !uniqueStrings(value.claimIds, 0, 24) || !uniqueStrings(value.situationTags, 0, 16, 32)
    || !list(value.resourceSignals, 0, 24, (signal) => object(signal, RESOURCE_SIGNAL_KEYS)
      && IDENTIFIER.test(signal.resourceId) && integer(signal.level, 0, 10_000) && ["rising", "stable", "falling"].includes(signal.trend))) {
    return { ok: false, reason: "planner_observation_contract" };
  }
  return { ok: true, value: structuredClone(value) };
}
