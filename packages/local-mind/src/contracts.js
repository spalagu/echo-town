const OBSERVATION_KEYS = new Set([
  "actorId",
  "logicalTime",
  "position",
  "nearbyPlaces",
  "needs",
  "visibleEvents",
]);

const INTENT_KEYS = new Set(["schemaVersion", "intentType", "payload", "budget", "reasonCode"]);
const PAYLOAD_KEYS = new Set(["dx", "dy"]);
const NEED_KEYS = new Set(["kind", "level"]);
const PLACE_KEYS = new Set(["id", "dx", "dy", "tags"]);
const EVENT_KEYS = new Set(["eventType", "actorId", "placeId", "logicalTime"]);
const NEED_KINDS = new Set(["rest", "social", "food", "safety", "curiosity", "belonging", "autonomy"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.size
    && Object.keys(value).every((key) => keys.has(key));
}

function finiteInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function safeText(value, maximum = 80) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function assertKeys(value, keys, label) {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !keys.has(key))) {
    throw new Error(`${label} 含有未授权字段`);
  }
}

export function sanitizeObservation(input) {
  assertKeys(input, OBSERVATION_KEYS, "Observation");
  if (!safeText(input.actorId, 96)) throw new Error("Observation actorId 非法");
  if (!finiteInteger(input.logicalTime, 0, Number.MAX_SAFE_INTEGER)) throw new Error("Observation logicalTime 非法");
  if (!hasExactKeys(input.position, new Set(["x", "y"]))) throw new Error("Observation position 非法");
  if (!finiteInteger(input.position.x, -100_000, 100_000) || !finiteInteger(input.position.y, -100_000, 100_000)) {
    throw new Error("Observation position 越界");
  }
  if (!Array.isArray(input.nearbyPlaces) || input.nearbyPlaces.length > 12) throw new Error("Observation nearbyPlaces 非法");
  if (!Array.isArray(input.needs) || input.needs.length > 8) throw new Error("Observation needs 非法");
  if (!Array.isArray(input.visibleEvents) || input.visibleEvents.length > 24) throw new Error("Observation visibleEvents 非法");

  const nearbyPlaces = input.nearbyPlaces.map((place) => {
    if (!hasExactKeys(place, PLACE_KEYS) || !safeText(place.id) || !finiteInteger(place.dx, -100, 100) || !finiteInteger(place.dy, -100, 100)) {
      throw new Error("Observation place 非法");
    }
    if (!Array.isArray(place.tags) || place.tags.length > 8 || place.tags.some((tag) => !safeText(tag, 32))) {
      throw new Error("Observation place tags 非法");
    }
    return { id: place.id, dx: place.dx, dy: place.dy, tags: [...place.tags] };
  });
  const needs = input.needs.map((need) => {
    if (!hasExactKeys(need, NEED_KEYS) || !NEED_KINDS.has(need.kind) || !finiteInteger(need.level, 0, 100)) {
      throw new Error("Observation need 非法");
    }
    return { kind: need.kind, level: need.level };
  });
  const visibleEvents = input.visibleEvents.map((event) => {
    if (!hasExactKeys(event, EVENT_KEYS) || !safeText(event.eventType, 48) || !safeText(event.actorId, 96)
      || !safeText(event.placeId, 80) || !finiteInteger(event.logicalTime, 0, Number.MAX_SAFE_INTEGER)) {
      throw new Error("Observation event 非法");
    }
    return { ...event };
  });
  return {
    actorId: input.actorId,
    logicalTime: input.logicalTime,
    position: { ...input.position },
    nearbyPlaces,
    needs,
    visibleEvents,
  };
}

export function validateIntentProposal(value) {
  if (!hasExactKeys(value, INTENT_KEYS)) return { ok: false, reason: "intent_fields" };
  if (value.schemaVersion !== 1) return { ok: false, reason: "schema_version" };
  if (value.intentType !== "move") return { ok: false, reason: "intent_type" };
  if (!hasExactKeys(value.payload, PAYLOAD_KEYS)) return { ok: false, reason: "payload_fields" };
  if (!finiteInteger(value.payload.dx, -1, 1) || !finiteInteger(value.payload.dy, -1, 1)) {
    return { ok: false, reason: "movement_range" };
  }
  if (value.payload.dx === 0 && value.payload.dy === 0) return { ok: false, reason: "empty_move" };
  if (!finiteInteger(value.budget, 1, 100)) return { ok: false, reason: "budget" };
  if (!safeText(value.reasonCode, 40) || !/^[a-z][a-z0-9_]*$/.test(value.reasonCode)) {
    return { ok: false, reason: "reason_code" };
  }
  return { ok: true, value: structuredClone(value) };
}

export function gateIntentProposals(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 3) {
    return { ok: false, reason: "intent_count", intents: [] };
  }
  const intents = [];
  for (const value of values) {
    const result = validateIntentProposal(value);
    if (!result.ok) return { ok: false, reason: result.reason, intents: [] };
    intents.push(result.value);
  }
  return { ok: true, intents };
}
