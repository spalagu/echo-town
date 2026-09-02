const WEIGHTS = Object.freeze({
  unfinishedRelationship: 0.25,
  mystery: 0.20,
  controversy: 0.20,
  scarcity: 0.15,
  socialChange: 0.10,
  contributionImpact: 0.10,
});
const DIMENSION_KEYS = new Set(Object.keys(WEIGHTS));
const HOOK_KEYS = new Set([
  "schemaVersion", "id", "kind", "title", "summary", "score", "dimensions", "sourceEventIds",
  "sourceClaimIds", "sourcePlanIds", "sourceInfluenceIds", "expiresAtTick", "readOnly",
  "worldWritable", "notificationCandidate",
]);
const STATE_KEYS = new Set([
  "schemaVersion", "actorId", "generatedAtTick", "hooks", "coverageGaps", "ablations", "readOnly", "worldWritable",
]);
const KINDS = new Set(["relationship", "mystery", "controversy", "scarcity", "social_change", "contribution"]);
const KIND_ORDER = ["relationship", "mystery", "controversy", "scarcity", "social_change", "contribution"];
const ABLATIONS = new Set(["relationship", "mystery", "scarcity", "contribution"]);

function clone(value) { return structuredClone(value); }
function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}
function isText(value, maximum = 320) { return typeof value === "string" && value.length > 0 && value.length <= maximum; }
function uniqueIds(value) {
  return Array.isArray(value) && value.every((item) => isText(item, 96)) && new Set(value).size === value.length;
}
function dimensions(kind, intensity = 100) {
  const value = Object.fromEntries(Object.keys(WEIGHTS).map((key) => [key, 0]));
  const key = ({
    relationship: "unfinishedRelationship", mystery: "mystery", controversy: "controversy",
    scarcity: "scarcity", social_change: "socialChange", contribution: "contributionImpact",
  })[kind];
  value[key] = Math.max(0, Math.min(100, Math.round(intensity)));
  return value;
}
function scoreDimensions(value) {
  return Math.round(Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + value[key] * weight, 0) * 1_000) / 1_000;
}
function hook(value) {
  const result = { schemaVersion: 1, ...value, readOnly: true, worldWritable: false };
  result.score = scoreDimensions(result.dimensions);
  return result;
}

export function validateEngagementState(state, sources) {
  if (!exactObject(state, STATE_KEYS) || state.schemaVersion !== 1 || !isText(state.actorId, 96)
    || !Number.isInteger(state.generatedAtTick) || state.generatedAtTick < 0
    || !Array.isArray(state.hooks) || state.hooks.length < 3 || state.hooks.length > 7
    || !Array.isArray(state.coverageGaps) || state.coverageGaps.some((item) => !["relationship", "narrative", "influence"].includes(item))
    || !Array.isArray(state.ablations) || state.ablations.some((item) => !ABLATIONS.has(item))
    || state.readOnly !== true || state.worldWritable !== false) return { ok: false, reason: "state_contract" };
  const eventIds = new Set(sources.events.map((item) => item.id));
  const claimIds = new Set(sources.claims.map((item) => item.id));
  const planIds = new Set(sources.plans.map((item) => item.id));
  const influenceIds = new Set(sources.influences.map((item) => item.id));
  const hookIds = new Set();
  for (const item of state.hooks) {
    if (!exactObject(item, HOOK_KEYS) || item.schemaVersion !== 1 || !isText(item.id, 96) || hookIds.has(item.id)
      || !KINDS.has(item.kind) || !isText(item.title, 120) || !isText(item.summary)
      || !exactObject(item.dimensions, DIMENSION_KEYS)
      || Object.values(item.dimensions).some((number) => !Number.isInteger(number) || number < 0 || number > 100)
      || item.score !== scoreDimensions(item.dimensions) || !uniqueIds(item.sourceEventIds)
      || !uniqueIds(item.sourceClaimIds) || !uniqueIds(item.sourcePlanIds) || !uniqueIds(item.sourceInfluenceIds)
      || item.sourceEventIds.some((id) => !eventIds.has(id)) || item.sourceClaimIds.some((id) => !claimIds.has(id))
      || item.sourcePlanIds.some((id) => !planIds.has(id)) || item.sourceInfluenceIds.some((id) => !influenceIds.has(id))
      || (item.sourceEventIds.length + item.sourceClaimIds.length + item.sourcePlanIds.length + item.sourceInfluenceIds.length === 0)
      || (item.expiresAtTick !== null && (!Number.isInteger(item.expiresAtTick) || item.expiresAtTick <= state.generatedAtTick))
      || item.readOnly !== true || item.worldWritable !== false || typeof item.notificationCandidate !== "boolean"
      || (item.notificationCandidate && item.expiresAtTick === null)) return { ok: false, reason: "hook_contract" };
    hookIds.add(item.id);
  }
  const kinds = new Set(state.hooks.map((item) => item.kind));
  const expectedGaps = [
    !kinds.has("relationship") && "relationship",
    !kinds.has("mystery") && !kinds.has("controversy") && "narrative",
    !kinds.has("contribution") && "influence",
  ].filter(Boolean);
  if (JSON.stringify(state.coverageGaps) !== JSON.stringify(expectedGaps)) return { ok: false, reason: "coverage_contract" };
  return { ok: true, value: clone(state) };
}

function selectHooks(candidates) {
  const selected = [];
  const take = (predicate) => {
    const candidate = candidates.find((item) => predicate(item) && !selected.includes(item));
    if (candidate) selected.push(candidate);
  };
  take((item) => item.kind === "relationship");
  take((item) => item.kind === "mystery" || item.kind === "controversy");
  take((item) => item.kind === "contribution");
  for (const kind of KIND_ORDER) {
    if (!selected.some((item) => item.kind === kind)) take((item) => item.kind === kind);
  }
  for (const candidate of candidates) if (selected.length < 7 && !selected.includes(candidate)) selected.push(candidate);
  return selected.slice(0, 7);
}

export function buildEngagementState(raw, { ablations = [] } = {}) {
  if (!raw || !isText(raw.actorId, 96) || !Number.isInteger(raw.generatedAtTick) || raw.generatedAtTick < 0
    || ![raw.events, raw.claims, raw.relationships, raw.resources, raw.plans, raw.mysteryRuns, raw.influences].every(Array.isArray)
    || !Array.isArray(ablations) || new Set(ablations).size !== ablations.length || ablations.some((item) => !ABLATIONS.has(item))) {
    throw new Error("Engagement Director 输入非法");
  }
  const eventIds = new Set(raw.events.map((item) => item.id));
  if (raw.influences.some((item) => !item || !isText(item.id, 96)
    || !["pending", "accepted_as_influence", "refused"].includes(item.status)
    || !Array.isArray(item.sourceEventIds)
    || (["accepted_as_influence", "refused"].includes(item.status)
      && (!uniqueIds(item.sourceEventIds) || item.sourceEventIds.length === 0 || item.sourceEventIds.some((id) => !eventIds.has(id)))))) {
    throw new Error("Engagement Director 影响来源非法");
  }
  const candidates = [];
  if (!ablations.includes("relationship")) {
    for (const edge of raw.relationships.filter((item) => Array.isArray(item.actorIds)
      && item.actorIds.length === 2 && item.actorIds.includes(raw.actorId) && eventIds.has(item.sourceEventId))) {
      const other = edge.actorIds.find((id) => id !== raw.actorId);
      candidates.push(hook({ id: `hook-relationship-${edge.sourceEventId}`, kind: "relationship", title: "一段关系仍在生长",
        summary: `角色与 ${other} 的相识有真实来处，后续仍取决于双方行动。`, dimensions: dimensions("relationship", 100),
        sourceEventIds: [edge.sourceEventId], sourceClaimIds: [], sourcePlanIds: [], sourceInfluenceIds: [], expiresAtTick: null, notificationCandidate: false }));
    }
  }
  if (!ablations.includes("mystery")) {
    for (const run of raw.mysteryRuns) {
      const belief = run.claims?.find((item) => item.kind === "belief");
      const sourceEvents = run.events?.filter((item) => item.logicalTime <= raw.generatedAtTick).map((item) => item.id) ?? [];
      if (!belief || sourceEvents.length === 0) continue;
      candidates.push(hook({ id: `hook-mystery-${run.mysteryId}`, kind: "mystery", title: "一种解释仍未封口",
        summary: belief.proposition, dimensions: dimensions("mystery", 100), sourceEventIds: sourceEvents,
        sourceClaimIds: [belief.id], sourcePlanIds: [], sourceInfluenceIds: [], expiresAtTick: null, notificationCandidate: false }));
    }
  }
  for (const claim of raw.claims.filter((item) => item.logicalTime <= raw.generatedAtTick && ["oppose", "uncertain"].includes(item.stance))) {
    candidates.push(hook({ id: `hook-controversy-${claim.id}`, kind: "controversy", title: "镇上的说法仍有分歧",
      summary: claim.statement, dimensions: dimensions("controversy", Math.min(100, 60 + (claim.heat ?? 0))),
      sourceEventIds: [...claim.sourceEventIds], sourceClaimIds: [claim.id], sourcePlanIds: [], sourceInfluenceIds: [], expiresAtTick: null, notificationCandidate: false }));
  }
  if (!ablations.includes("scarcity")) {
    for (const plan of raw.plans.filter((item) => item.trigger?.kind === "scarcity"
      && item.trigger.startTick <= raw.generatedAtTick && item.trigger.startTick + item.trigger.durationTicks > raw.generatedAtTick)) {
      candidates.push(hook({ id: `hook-scarcity-${plan.id}`, kind: "scarcity", title: "一个真实窗口正在变化",
        summary: `${plan.title}仍在持续；错过只会改变之后的可选路径，不会伪造已经发生的后果。`, dimensions: dimensions("scarcity", 100),
        sourceEventIds: [], sourceClaimIds: [], sourcePlanIds: [plan.id], sourceInfluenceIds: [],
        expiresAtTick: plan.trigger.startTick + plan.trigger.durationTicks, notificationCandidate: true }));
    }
  }
  const recentAction = [...raw.events].reverse().find((item) => item.actorId && item.actionAffordance && item.tick <= raw.generatedAtTick);
  if (recentAction) candidates.push(hook({ id: `hook-social-${recentAction.id}`, kind: "social_change", title: "小镇刚刚改变了一点",
    summary: recentAction.detail, dimensions: dimensions("social_change", 100), sourceEventIds: [recentAction.id], sourceClaimIds: [],
    sourcePlanIds: [], sourceInfluenceIds: [], expiresAtTick: null, notificationCandidate: false }));
  if (!ablations.includes("contribution")) {
    for (const influence of raw.influences.filter((item) => ["accepted_as_influence", "refused"].includes(item.status)
      && Array.isArray(item.sourceEventIds) && item.sourceEventIds.every((id) => eventIds.has(id)))) {
      candidates.push(hook({ id: `hook-influence-${influence.id}`, kind: "contribution", title: "你的影响已经被角色认真考虑",
        summary: influence.status === "refused" ? "角色保留了自己的选择；拒绝本身也会成为你们关系的一部分。" : "角色愿意把这份影响带进之后的自主判断，但没有承诺指定结果。",
        dimensions: dimensions("contribution", 100), sourceEventIds: [...influence.sourceEventIds], sourceClaimIds: [], sourcePlanIds: [],
        sourceInfluenceIds: [influence.id], expiresAtTick: null, notificationCandidate: false }));
    }
  }
  const filtered = candidates.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const hooks = selectHooks(filtered);
  if (hooks.length < 3) throw new Error("Engagement Director 缺少至少 3 个真实来源钩子");
  const kinds = new Set(hooks.map((item) => item.kind));
  const state = {
    schemaVersion: 1,
    actorId: raw.actorId,
    generatedAtTick: raw.generatedAtTick,
    hooks,
    coverageGaps: [
      !kinds.has("relationship") && "relationship",
      !kinds.has("mystery") && !kinds.has("controversy") && "narrative",
      !kinds.has("contribution") && "influence",
    ].filter(Boolean),
    ablations: [...ablations],
    readOnly: true,
    worldWritable: false,
  };
  const validation = validateEngagementState(state, { events: raw.events.concat(raw.mysteryRuns.flatMap((item) => item.events ?? [])),
    claims: raw.claims.concat(raw.mysteryRuns.flatMap((item) => item.claims ?? [])), plans: raw.plans, influences: raw.influences });
  if (!validation.ok) throw new Error(`EngagementState 被拒绝：${validation.reason}`);
  return validation.value;
}

export { WEIGHTS };
export { THRESHOLDS, createStudyPlan, evaluateStudy } from "./research.js";
