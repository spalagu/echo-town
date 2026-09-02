const MEMORY_KEYS = new Set([
  "id", "ownerActorId", "kind", "summary", "sourceEventIds", "subjects", "logicalTime",
  "salience", "emotionalValence", "confidence", "visibility", "consolidationParentIds", "decayClass",
]);
const MEMORY_KINDS = new Set([
  "working", "event", "semantic", "relationship", "commitment", "self_narrative",
  "identity", "public_event", "relationship_landmark", "correction",
]);
const VISIBILITIES = new Set(["private", "shared", "public"]);
const DECAY_CLASSES = new Set(["ordinary", "protected"]);
const RELATIONSHIP_KEYS = new Set([
  "ownerActorId", "otherActorId", "familiarity", "trust", "affinity", "respect", "fear", "intimacy",
  "commitments", "unresolvedThreads", "landmarkMemoryIds",
]);
const ACQUAINTANCE_KEYS = new Set(["schemaVersion", "type", "actorIds", "sourceEventId", "logicalTime"]);
export const PROTECTED_KINDS = new Set(["identity", "commitment", "public_event", "relationship_landmark", "correction"]);

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return plainObject(value) && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function text(value, maximum = 160) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function integer(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function stringList(value, maximum, itemMaximum = 96) {
  return Array.isArray(value) && value.length <= maximum && value.every((item) => text(item, itemMaximum));
}

export function validateMemoryRecord(value) {
  if (!exactKeys(value, MEMORY_KEYS)) return { ok: false, reason: "memory_fields" };
  if (!text(value.id, 96) || !text(value.ownerActorId, 96)) return { ok: false, reason: "memory_identity" };
  if (!MEMORY_KINDS.has(value.kind) || value.kind === "HistoricalSummary") return { ok: false, reason: "memory_kind" };
  if (!text(value.summary, 320)) return { ok: false, reason: "memory_summary" };
  if (!stringList(value.sourceEventIds, 16) || value.sourceEventIds.length === 0) return { ok: false, reason: "memory_sources" };
  if (!stringList(value.subjects, 16)) return { ok: false, reason: "memory_subjects" };
  if (!integer(value.logicalTime, 0, Number.MAX_SAFE_INTEGER)) return { ok: false, reason: "memory_time" };
  if (!integer(value.salience, 0, 100) || !integer(value.emotionalValence, -100, 100) || !integer(value.confidence, 0, 100)) {
    return { ok: false, reason: "memory_scores" };
  }
  if (!VISIBILITIES.has(value.visibility)) return { ok: false, reason: "memory_visibility" };
  if (!stringList(value.consolidationParentIds, 16)) return { ok: false, reason: "memory_parents" };
  if (!DECAY_CLASSES.has(value.decayClass)) return { ok: false, reason: "memory_decay" };
  if (PROTECTED_KINDS.has(value.kind) && value.decayClass !== "protected") return { ok: false, reason: "protected_decay" };
  return { ok: true, value: structuredClone(value) };
}

export function calculateSalience({ novelty, emotionalIntensity, goalImpact, relationshipImpact, playerRelevance }) {
  const factors = [novelty, emotionalIntensity, goalImpact, relationshipImpact, playerRelevance];
  if (factors.some((value) => !integer(value, 0, 100))) throw new Error("重要度因子必须在 0..100");
  return Math.round(0.25 * novelty + 0.25 * emotionalIntensity + 0.20 * goalImpact + 0.20 * relationshipImpact + 0.10 * playerRelevance);
}

export function clampRelationshipDimension(name, value) {
  const nonNegative = new Set(["familiarity", "fear", "intimacy"]);
  const minimum = nonNegative.has(name) ? 0 : -100;
  return Math.max(minimum, Math.min(100, Math.round(value)));
}

export function validateRelationshipView(value) {
  if (!exactKeys(value, RELATIONSHIP_KEYS) || !text(value.ownerActorId, 96) || !text(value.otherActorId, 96)
    || value.ownerActorId === value.otherActorId) return { ok: false, reason: "relationship_identity" };
  if (!integer(value.familiarity, 0, 100) || !integer(value.trust, -100, 100) || !integer(value.affinity, -100, 100)
    || !integer(value.respect, -100, 100) || !integer(value.fear, 0, 100) || !integer(value.intimacy, 0, 100)) {
    return { ok: false, reason: "relationship_scores" };
  }
  if (!stringList(value.commitments, 32) || !stringList(value.unresolvedThreads, 32) || !stringList(value.landmarkMemoryIds, 32)) {
    return { ok: false, reason: "relationship_refs" };
  }
  return { ok: true, value: structuredClone(value) };
}

export function validateAcquaintanceEdge(value) {
  if (!exactKeys(value, ACQUAINTANCE_KEYS) || value.schemaVersion !== 1 || value.type !== "acquaintance") {
    return { ok: false, reason: "acquaintance_fields" };
  }
  if (!stringList(value.actorIds, 2) || value.actorIds.length !== 2 || value.actorIds[0] >= value.actorIds[1]) {
    return { ok: false, reason: "acquaintance_actors" };
  }
  if (!text(value.sourceEventId, 96) || !integer(value.logicalTime, 0, Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: "acquaintance_source" };
  }
  return { ok: true, value: structuredClone(value) };
}
