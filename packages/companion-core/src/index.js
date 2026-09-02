import {
  DILEMMA_FIXTURES,
  personaFactorPaths,
  rankIntentCandidates,
  validatePersonaProfile,
} from "@echo-town/persona-core";

const BEHAVIOR_KEYS = new Set([
  "schemaVersion", "id", "type", "actorId", "sourceActorId", "logicalDay", "summary",
  "sourceEventIds", "sourceMemoryIds", "sourceClaimIds", "personaProfileId",
  "decisionStrategyId", "decisionUtility", "decisionFactors",
]);
const HEART_KEYS = new Set([
  "schemaVersion", "id", "role", "text", "logicalDay", "private", "worldFact",
  "networkEligible", "sourceBehaviorIds",
]);
const INFLUENCE_KEYS = new Set([
  "schemaVersion", "id", "kind", "text", "logicalDay", "status", "private", "worldFact",
  "networkEligible", "decisionStrategyId", "decisionFactors", "sourceBehaviorIds", "sourceMemoryIds",
  "sourceRelationshipEventIds", "goalReference",
]);
const SNAPSHOT_KEYS = new Set(["schemaVersion", "ownerActorId", "sourceActorId", "heartEntries", "influences"]);
const FACTOR_KEYS = new Set(["path", "value", "contribution"]);
const GOAL_KEYS = new Set(["path", "value"]);
const INFLUENCE_KINDS = new Set(["letter", "wish", "gift"]);
const INFLUENCE_STATUSES = new Set(["pending", "accepted_as_influence", "refused"]);
const MAX_UNRESOLVED_INFLUENCES = 3;

function clone(value) {
  return structuredClone(value);
}

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function isText(value, maximum = 320) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function uniqueTextIds(value, { allowEmpty = true } = {}) {
  return Array.isArray(value) && (allowEmpty || value.length > 0)
    && value.every((item) => isText(item, 96)) && new Set(value).size === value.length;
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function factorValueMatchesProfile(profile, factor) {
  if (factor.path === "playerSuggestion") return factor.value === "可拒绝建议";
  if (factor.path === "dilemma.contextWeight") return Number.isInteger(factor.value) && factor.value >= -60 && factor.value <= 60;
  const [section, key] = factor.path.split(".");
  return (key === undefined ? profile[section] : profile[section]?.[key]) === factor.value;
}

function validateFactors(value, profile, expectedUtility, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return false;
  const paths = personaFactorPaths(profile);
  if (value.some((factor) => !exactObject(factor, FACTOR_KEYS) || !paths.has(factor.path)
    || !isText(String(factor.value), 160) || !Number.isFinite(factor.contribution)
    || !factorValueMatchesProfile(profile, factor))) return false;
  return expectedUtility === null || round(value.reduce((sum, factor) => sum + factor.contribution, 0)) === expectedUtility;
}

function validateBehavior(value, context) {
  if (!exactObject(value, BEHAVIOR_KEYS) || value.schemaVersion !== 1 || !isText(value.id, 96)
    || !["action", "statement"].includes(value.type) || value.actorId !== context.ownerActorId
    || value.sourceActorId !== context.sourceActorId || !Number.isInteger(value.logicalDay)
    || value.logicalDay < 0 || value.logicalDay > 30 || !isText(value.summary)
    || !uniqueTextIds(value.sourceEventIds, { allowEmpty: false }) || !uniqueTextIds(value.sourceMemoryIds)
    || !uniqueTextIds(value.sourceClaimIds) || value.personaProfileId !== context.profile.id
    || !isText(value.decisionStrategyId, 64) || !Number.isFinite(value.decisionUtility)
    || !validateFactors(value.decisionFactors, context.profile, value.decisionUtility)) return false;
  if (value.sourceEventIds.some((id) => !context.eventsById.has(id))
    || value.sourceMemoryIds.some((id) => !context.memoriesById.has(id))
    || value.sourceClaimIds.some((id) => !context.claimsById.has(id))) return false;
  const primaryEvent = context.eventsById.get(value.sourceEventIds[0]);
  if (!primaryEvent || primaryEvent.actorId !== context.sourceActorId || primaryEvent.tick !== value.logicalDay) return false;
  if (value.type === "action") return primaryEvent.actionAffordance && value.sourceClaimIds.every((id) => context.claimsById.get(id).logicalTime <= value.logicalDay);
  const ownClaim = value.sourceClaimIds.map((id) => context.claimsById.get(id))
    .find((claim) => claim?.speakerActorId === context.sourceActorId && claim.logicalTime === value.logicalDay);
  return Boolean(ownClaim) && ownClaim.sourceEventIds.includes(primaryEvent.id);
}

function validateHeartEntry(value, behaviorIds) {
  return exactObject(value, HEART_KEYS) && value.schemaVersion === 1 && isText(value.id, 96)
    && ["user", "companion"].includes(value.role) && isText(value.text, 500)
    && Number.isInteger(value.logicalDay) && value.logicalDay >= 0 && value.logicalDay <= 1_000_000
    && value.private === true && value.worldFact === false && value.networkEligible === false
    && uniqueTextIds(value.sourceBehaviorIds) && value.sourceBehaviorIds.every((id) => behaviorIds.has(id));
}

function validateInfluence(value, profile, behaviorIds, memoryIds, relationshipEventIds) {
  return exactObject(value, INFLUENCE_KEYS) && value.schemaVersion === 1 && isText(value.id, 96)
    && INFLUENCE_KINDS.has(value.kind) && isText(value.text, 500)
    && Number.isInteger(value.logicalDay) && value.logicalDay >= 0 && value.logicalDay <= 1_000_000
    && INFLUENCE_STATUSES.has(value.status) && value.private === true && value.worldFact === false
    && value.networkEligible === false && (value.status === "pending"
      ? value.decisionStrategyId === null && validateFactors(value.decisionFactors, profile, null, { allowEmpty: true }) && value.decisionFactors.length === 0
      : isText(value.decisionStrategyId, 64) && validateFactors(value.decisionFactors, profile, null))
    && uniqueTextIds(value.sourceBehaviorIds) && value.sourceBehaviorIds.every((id) => behaviorIds.has(id))
    && uniqueTextIds(value.sourceMemoryIds) && value.sourceMemoryIds.every((id) => memoryIds.has(id))
    && uniqueTextIds(value.sourceRelationshipEventIds) && value.sourceRelationshipEventIds.every((id) => relationshipEventIds.has(id))
    && (value.status === "pending" ? value.goalReference === null
      : exactObject(value.goalReference, GOAL_KEYS) && value.goalReference.path === "desire"
        && value.goalReference.value === profile.desire);
}

function sourceMemoriesForAction(action, memories) {
  return memories.filter((memory) => memory.ownerActorId === action.actorId
    && (memory.sourceEventIds?.includes(action.id) || action.memoryInputIds?.includes(memory.id)))
    .map((memory) => memory.id);
}

export class CompanionSession {
  constructor({ ownerActorId, sourceActorId, personaProfile, events, claims, memories, acquaintances, snapshot }) {
    this.profile = validatePersonaProfile(personaProfile);
    if (!isText(ownerActorId, 96) || !isText(sourceActorId, 96)) throw new Error("CompanionSession 角色标识非法");
    if (![events, claims, memories, acquaintances].every(Array.isArray)) throw new Error("CompanionSession 来源集合非法");
    this.ownerActorId = ownerActorId;
    this.sourceActorId = sourceActorId;
    this.eventsById = new Map(events.map((item) => [item.id, item]));
    this.claimsById = new Map(claims.map((item) => [item.id, item]));
    this.memoriesById = new Map(memories.map((item) => [item.id, item]));
    if (this.eventsById.size !== events.length || this.claimsById.size !== claims.length || this.memoriesById.size !== memories.length) {
      throw new Error("CompanionSession 来源标识重复");
    }
    const relationshipEdges = acquaintances.filter((edge) => Array.isArray(edge.actorIds)
      && edge.actorIds.includes(this.sourceActorId) && isText(edge.sourceEventId, 96)
      && Number.isInteger(edge.logicalTime) && edge.logicalTime >= 0 && edge.logicalTime <= 30
      && this.eventsById.has(edge.sourceEventId));
    this.relationshipSourceEventIds = new Set(relationshipEdges.map((edge) => edge.sourceEventId));
    this.behaviorRecords = this.deriveBehaviors(events, claims, memories);
    this.behaviorIds = new Set(this.behaviorRecords.map((item) => item.id));
    this.heartEntries = [];
    this.influences = [];
    if (snapshot) this.restore(snapshot);
  }

  deriveBehaviors(events, claims, memories) {
    const actions = events
      .filter((event) => event.actorId === this.sourceActorId && typeof event.actionAffordance === "string" && event.tick <= 30)
      .sort((left, right) => left.tick - right.tick || left.sequence - right.sequence)
      .slice(0, 10);
    const statements = claims
      .filter((claim) => claim.speakerActorId === this.sourceActorId && claim.logicalTime <= 30)
      .sort((left, right) => left.logicalTime - right.logicalTime || left.id.localeCompare(right.id))
      .slice(0, 10);
    if (actions.length !== 10 || statements.length !== 10) throw new Error("CompanionSession 需要 30 日内 10 个行动与 10 个表达来源");
    const actionBehaviors = actions.map((action) => ({
      schemaVersion: 1,
      id: `behavior-${action.id}`,
      type: "action",
      actorId: this.ownerActorId,
      sourceActorId: this.sourceActorId,
      logicalDay: action.tick,
      summary: action.detail,
      sourceEventIds: [action.id],
      sourceMemoryIds: sourceMemoriesForAction(action, memories),
      sourceClaimIds: (action.claimInputIds ?? []).filter((id) => this.claimsById.has(id)),
      personaProfileId: this.profile.id,
      decisionStrategyId: action.decisionStrategyId,
      decisionUtility: action.decisionUtility,
      decisionFactors: clone(action.decisionFactors),
    }));
    const statementBehaviors = statements.map((claim) => {
      const action = claim.sourceEventIds.map((id) => this.eventsById.get(id))
        .find((event) => event?.actorId === this.sourceActorId && event.actionAffordance);
      if (!action) throw new Error(`CompanionSession 表达 ${claim.id} 缺少真实行动来源`);
      return {
        schemaVersion: 1,
        id: `behavior-${claim.id}`,
        type: "statement",
        actorId: this.ownerActorId,
        sourceActorId: this.sourceActorId,
        logicalDay: claim.logicalTime,
        summary: claim.statement,
        sourceEventIds: [action.id],
        sourceMemoryIds: sourceMemoriesForAction(action, memories),
        sourceClaimIds: [claim.id],
        personaProfileId: this.profile.id,
        decisionStrategyId: action.decisionStrategyId,
        decisionUtility: action.decisionUtility,
        decisionFactors: clone(action.decisionFactors),
      };
    });
    const context = {
      ownerActorId: this.ownerActorId,
      sourceActorId: this.sourceActorId,
      profile: this.profile,
      eventsById: this.eventsById,
      memoriesById: this.memoriesById,
      claimsById: this.claimsById,
    };
    const result = [...actionBehaviors, ...statementBehaviors]
      .sort((left, right) => left.logicalDay - right.logicalDay || left.type.localeCompare(right.type) || left.id.localeCompare(right.id));
    if (result.length !== 20 || result.some((item) => !validateBehavior(item, context))) {
      throw new Error("CompanionSession 行为因果链非法");
    }
    return result;
  }

  behaviors() {
    return this.behaviorRecords.map(clone);
  }

  explainBehavior(behaviorId) {
    const behavior = this.behaviorRecords.find((item) => item.id === behaviorId);
    if (!behavior) throw new Error("行为不存在");
    return {
      schemaVersion: 1,
      behavior: clone(behavior),
      events: behavior.sourceEventIds.map((id) => clone(this.eventsById.get(id))),
      memories: behavior.sourceMemoryIds.map((id) => clone(this.memoriesById.get(id))),
      claims: behavior.sourceClaimIds.map((id) => clone(this.claimsById.get(id))),
      reason: {
        personaProfileId: behavior.personaProfileId,
        strategyId: behavior.decisionStrategyId,
        utility: behavior.decisionUtility,
        factors: clone(behavior.decisionFactors),
      },
      inferred: false,
    };
  }

  memoryAlbum() {
    const sourceEventIds = new Set(this.behaviorRecords.flatMap((item) => item.sourceEventIds));
    return [...this.memoriesById.values()]
      .filter((memory) => memory.ownerActorId === this.sourceActorId
        && memory.sourceEventIds?.some((id) => sourceEventIds.has(id)))
      .sort((left, right) => left.logicalTime - right.logicalTime || left.id.localeCompare(right.id))
      .map((memory) => ({ ...clone(memory), ownerActorId: this.ownerActorId }));
  }

  returnSummary(fromDay, toDay) {
    if (!Number.isInteger(fromDay) || !Number.isInteger(toDay) || fromDay < 0 || toDay <= fromDay || toDay > 30) {
      throw new Error("离开与返回的逻辑日范围非法");
    }
    const selected = this.behaviorRecords.filter((item) => item.logicalDay > fromDay && item.logicalDay <= toDay);
    return {
      schemaVersion: 1,
      fromDay,
      toDay,
      title: `${fromDay}～${toDay} 日之间，${selected.length} 条生活回声`,
      highlights: selected.slice(-5).map((item) => ({ behaviorId: item.id, logicalDay: item.logicalDay, summary: item.summary })),
      sourceBehaviorIds: selected.map((item) => item.id),
      sourceEventIds: [...new Set(selected.flatMap((item) => item.sourceEventIds))],
      readOnly: true,
      plannerEligible: false,
    };
  }

  sendHeartMessage(input) {
    if (!exactObject(input, new Set(["text", "logicalDay"])) || !isText(input.text, 500)
      || !Number.isInteger(input.logicalDay) || input.logicalDay < 0 || input.logicalDay > 1_000_000) {
      throw new Error("心室消息非法");
    }
    const latest = [...this.behaviorRecords].reverse().find((item) => item.logicalDay <= Math.min(30, input.logicalDay)) ?? this.behaviorRecords[0];
    const userEntry = {
      schemaVersion: 1, id: `heart-user-${this.heartEntries.length + 1}`, role: "user", text: input.text.trim(),
      logicalDay: input.logicalDay, private: true, worldFact: false, networkEligible: false, sourceBehaviorIds: [],
    };
    const companionEntry = {
      schemaVersion: 1, id: `heart-companion-${this.heartEntries.length + 2}`, role: "companion",
      text: `${this.profile.speechStyle}。我会把你的话当作陪伴，不把它写成世界已经发生的事实。${latest ? `我最近仍记得：${latest.summary}` : ""}`,
      logicalDay: input.logicalDay, private: true, worldFact: false, networkEligible: false,
      sourceBehaviorIds: latest ? [latest.id] : [],
    };
    this.heartEntries.push(userEntry, companionEntry);
    return { user: clone(userEntry), companion: clone(companionEntry) };
  }

  submitInfluence(input) {
    if (!exactObject(input, new Set(["kind", "text", "logicalDay"])) || !INFLUENCE_KINDS.has(input.kind)
      || !isText(input.text, 500) || !Number.isInteger(input.logicalDay) || input.logicalDay < 0 || input.logicalDay > 1_000_000) {
      throw new Error("陪伴影响输入非法");
    }
    if (this.influences.filter((item) => item.status === "pending").length >= MAX_UNRESOLVED_INFLUENCES) {
      throw new Error("最多保留 3 个尚未回应的愿望、信件或礼物");
    }
    const influence = {
      schemaVersion: 1,
      id: `influence-${this.influences.length + 1}`,
      kind: input.kind,
      text: input.text.trim(),
      logicalDay: input.logicalDay,
      status: "pending",
      private: true,
      worldFact: false,
      networkEligible: false,
      decisionStrategyId: null,
      decisionFactors: [],
      sourceBehaviorIds: [],
      sourceMemoryIds: [],
      sourceRelationshipEventIds: [],
      goalReference: null,
    };
    this.influences.push(influence);
    return clone(influence);
  }

  considerInfluence(influenceId) {
    const influence = this.influences.find((item) => item.id === influenceId);
    if (!influence || influence.status !== "pending") throw new Error("待回应的陪伴影响不存在");
    const latest = [...this.behaviorRecords].reverse().find((item) => item.logicalDay <= Math.min(30, influence.logicalDay));
    const sourceMemoryIds = latest?.sourceMemoryIds ?? [];
    const sourceRelationshipEventIds = [...this.relationshipSourceEventIds];
    const goalReference = { path: "desire", value: this.profile.desire };
    const contextSignal = Math.min(12, sourceMemoryIds.length * 2)
      + Math.min(10, sourceRelationshipEventIds.length * 2)
      + (latest?.decisionFactors.some((factor) => factor.path === "desire") ? 6 : 2)
      + ({ letter: 1, wish: 0, gift: 2 })[influence.kind];
    const dilemma = clone(DILEMMA_FIXTURES.find((item) => item.id === "player_request"));
    const suggestion = dilemma.options.find((item) => item.id === dilemma.playerSuggestionId);
    suggestion.contextWeight = clamp(suggestion.contextWeight + contextSignal, -60, 60);
    const candidate = rankIntentCandidates(this.profile, dilemma).candidates[0];
    influence.status = candidate.acceptedPlayerSuggestion ? "accepted_as_influence" : "refused";
    influence.decisionStrategyId = candidate.strategyId;
    influence.decisionFactors = clone(candidate.factors);
    influence.sourceBehaviorIds = latest ? [latest.id] : [];
    influence.sourceMemoryIds = [...sourceMemoryIds];
    influence.sourceRelationshipEventIds = sourceRelationshipEventIds;
    influence.goalReference = goalReference;
    return clone(influence);
  }

  heartRoom() {
    return this.heartEntries.map(clone);
  }

  influenceLog() {
    return this.influences.map(clone);
  }

  publicProjection() {
    return { schemaVersion: 1, activities: [] };
  }

  snapshot() {
    return {
      schemaVersion: 1,
      ownerActorId: this.ownerActorId,
      sourceActorId: this.sourceActorId,
      heartEntries: this.heartEntries.map(clone),
      influences: this.influences.map(clone),
    };
  }

  restore(snapshot) {
    if (!exactObject(snapshot, SNAPSHOT_KEYS) || snapshot.schemaVersion !== 1
      || snapshot.ownerActorId !== this.ownerActorId || snapshot.sourceActorId !== this.sourceActorId
      || !Array.isArray(snapshot.heartEntries) || !Array.isArray(snapshot.influences)
      || snapshot.heartEntries.some((item) => !validateHeartEntry(item, this.behaviorIds))
      || snapshot.influences.some((item) => !validateInfluence(item, this.profile, this.behaviorIds,
        this.memoriesById, this.relationshipSourceEventIds))
      || new Set(snapshot.heartEntries.map((item) => item.id)).size !== snapshot.heartEntries.length
      || new Set(snapshot.influences.map((item) => item.id)).size !== snapshot.influences.length
      || snapshot.influences.filter((item) => item.status === "pending").length > MAX_UNRESOLVED_INFLUENCES) {
      throw new Error("CompanionSession 私人快照非法");
    }
    this.heartEntries = snapshot.heartEntries.map(clone);
    this.influences = snapshot.influences.map(clone);
  }
}

export class IndexedDbCompanionStore {
  constructor(name = "echo-town-companion") {
    this.name = name;
  }

  async database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("companion");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async transact(mode, operation) {
    const database = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("companion", mode);
        const request = operation(transaction.objectStore("companion"));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }

  get() { return this.transact("readonly", (store) => store.get("private-companion-v1")); }
  set(snapshot) { return this.transact("readwrite", (store) => store.put(clone(snapshot), "private-companion-v1")); }
  clear() { return this.transact("readwrite", (store) => store.delete("private-companion-v1")); }
}

export { MAX_UNRESOLVED_INFLUENCES };
