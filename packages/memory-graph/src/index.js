import {
  PROTECTED_KINDS,
  calculateSalience,
  clampRelationshipDimension,
  validateAcquaintanceEdge,
  validateMemoryRecord,
  validateRelationshipView,
} from "./contracts.js";

const RETRIEVAL_LIMIT = 12;
const WORKING_LIMIT = 64;
const WORKING_HOURS = 24;
const LONG_TERM_LIMIT = 200;
const RELATIONSHIP_DIMENSIONS = ["familiarity", "trust", "affinity", "respect", "fear", "intimacy"];

function clone(value) {
  return structuredClone(value);
}

function tokenize(value) {
  return new Set(String(value).toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
}

function overlapScore(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / new Set([...left, ...right]).size;
}

function relationshipKey(ownerActorId, otherActorId) {
  return `${ownerActorId}\u0000${otherActorId}`;
}

function acquaintanceKey(left, right) {
  return [left, right].sort().join("\u0000");
}

function defaultRelationship(ownerActorId, otherActorId) {
  return {
    ownerActorId,
    otherActorId,
    familiarity: 0,
    trust: 0,
    affinity: 0,
    respect: 0,
    fear: 0,
    intimacy: 0,
    commitments: [],
    unresolvedThreads: [],
    landmarkMemoryIds: [],
  };
}

export { calculateSalience, validateAcquaintanceEdge, validateMemoryRecord, validateRelationshipView };

export class MemoryGraph {
  constructor(snapshot) {
    this.working = [];
    this.longTerm = [];
    this.relationships = new Map();
    this.acquaintances = new Map();
    if (snapshot) this.restore(snapshot);
  }

  allMemories() {
    const records = new Map();
    for (const record of [...this.working, ...this.longTerm]) records.set(record.id, record);
    return [...records.values()];
  }

  memory(id) {
    return this.allMemories().find((record) => record.id === id) ?? null;
  }

  remember(rawRecord) {
    const result = validateMemoryRecord(rawRecord);
    if (!result.ok) throw new Error(`MemoryRecord 被拒绝：${result.reason}`);
    if (this.memory(result.value.id)) throw new Error("MemoryRecord 只能追加，不能覆盖同一 id");
    for (const parentId of result.value.consolidationParentIds) {
      if (!this.memory(parentId)) throw new Error("MemoryRecord 巩固/纠正来源不存在");
    }
    this.working.push(result.value);
    if (result.value.decayClass === "protected" || PROTECTED_KINDS.has(result.value.kind)) {
      this.longTerm.push(clone(result.value));
      this.enforceLongTermLimit();
    }
    this.trimWorking(result.value.logicalTime);
    return structuredClone(result.value);
  }

  trimWorking(logicalTime) {
    this.working = this.working
      .filter((record) => logicalTime - record.logicalTime <= WORKING_HOURS)
      .sort((left, right) => left.logicalTime - right.logicalTime || left.id.localeCompare(right.id))
      .slice(-WORKING_LIMIT);
  }

  consolidate(logicalTime) {
    this.trimWorking(logicalTime);
    const existing = new Set(this.longTerm.map((record) => record.id));
    const selected = this.working
      .filter((record) => !existing.has(record.id))
      .sort((left, right) => {
        const leftScore = (left.decayClass === "protected" ? 1_000 : 0) + left.salience * 0.6 + Math.abs(left.emotionalValence) * 0.2 + left.confidence * 0.2;
        const rightScore = (right.decayClass === "protected" ? 1_000 : 0) + right.salience * 0.6 + Math.abs(right.emotionalValence) * 0.2 + right.confidence * 0.2;
        return rightScore - leftScore || left.id.localeCompare(right.id);
      })
      .slice(0, 8);
    this.longTerm.push(...selected.map(clone));
    this.enforceLongTermLimit();
    return selected.map(clone);
  }

  enforceLongTermLimit() {
    if (this.longTerm.length <= LONG_TERM_LIMIT) return;
    const protectedRecords = this.longTerm.filter((record) => record.decayClass === "protected" || PROTECTED_KINDS.has(record.kind));
    const ordinary = this.longTerm
      .filter((record) => record.decayClass !== "protected" && !PROTECTED_KINDS.has(record.kind))
      .sort((left, right) => right.salience - left.salience || right.logicalTime - left.logicalTime || left.id.localeCompare(right.id));
    this.longTerm = [...protectedRecords, ...ordinary.slice(0, Math.max(0, LONG_TERM_LIMIT - protectedRecords.length))]
      .sort((left, right) => left.logicalTime - right.logicalTime || left.id.localeCompare(right.id));
  }

  effectiveConfidence(memoryId) {
    const record = this.memory(memoryId);
    if (!record) throw new Error("记忆不存在");
    const corrections = this.allMemories().filter((candidate) => candidate.kind === "correction" && candidate.consolidationParentIds.includes(memoryId));
    return Math.max(0, record.confidence - corrections.reduce((total, correction) => total + Math.round(correction.confidence * 0.5), 0));
  }

  forget(logicalTime) {
    this.trimWorking(logicalTime);
    const forgotten = [];
    this.longTerm = this.longTerm.filter((record) => {
      if (record.decayClass === "protected" || PROTECTED_KINDS.has(record.kind)) return true;
      const age = Math.max(0, logicalTime - record.logicalTime);
      const retention = this.effectiveConfidence(record.id) + record.salience - age * 2;
      if (retention > 0) return true;
      forgotten.push(record.id);
      return false;
    });
    return forgotten;
  }

  retrieve({ text = "", subjectIds = [], relatedActorIds = [], goalKinds = [], logicalTime }) {
    if (!Number.isInteger(logicalTime) || logicalTime < 0) throw new Error("检索 logicalTime 非法");
    const queryTokens = tokenize(text);
    const subjects = new Set(subjectIds);
    const related = new Set(relatedActorIds);
    const goals = new Set(goalKinds);
    return this.allMemories()
      .map((record) => {
        const semantic = overlapScore(queryTokens, tokenize(record.summary));
        const recency = Math.max(0, 1 - Math.max(0, logicalTime - record.logicalTime) / 200);
        const importance = record.salience / 100;
        const relationship = record.subjects.some((subject) => subjects.has(subject) || related.has(subject)) ? 1 : 0;
        const goal = goals.has(record.kind) ? 1 : 0;
        return { record, retrievalScore: 0.35 * semantic + 0.15 * recency + 0.25 * importance + 0.15 * relationship + 0.10 * goal };
      })
      .filter(({ record }) => record.kind !== "HistoricalSummary")
      .sort((left, right) => right.retrievalScore - left.retrievalScore || left.record.id.localeCompare(right.record.id))
      .slice(0, RETRIEVAL_LIMIT)
      .map(({ record, retrievalScore }) => ({ record: structuredClone(record), effectiveConfidence: this.effectiveConfidence(record.id), retrievalScore }));
  }

  observeAcquaintance({ actorIds, sourceEventId, logicalTime }) {
    if (!Array.isArray(actorIds) || actorIds.length !== 2 || actorIds.some((id) => typeof id !== "string" || !id)) throw new Error("相识角色非法");
    if (typeof sourceEventId !== "string" || !sourceEventId || !Number.isInteger(logicalTime) || logicalTime < 0) throw new Error("相识来源非法");
    const sorted = [...actorIds].sort();
    if (sorted[0] === sorted[1]) throw new Error("角色不能与自己建立相识边");
    const edgeKey = acquaintanceKey(...sorted);
    if (!this.acquaintances.has(edgeKey)) {
      this.acquaintances.set(edgeKey, { schemaVersion: 1, type: "acquaintance", actorIds: sorted, sourceEventId, logicalTime });
    }
    for (const [ownerActorId, otherActorId] of [sorted, [...sorted].reverse()]) {
      const key = relationshipKey(ownerActorId, otherActorId);
      if (!this.relationships.has(key)) this.relationships.set(key, defaultRelationship(ownerActorId, otherActorId));
      const relationship = this.relationships.get(key);
      relationship.familiarity = Math.max(relationship.familiarity, 1);
    }
    return structuredClone(this.acquaintances.get(edgeKey));
  }

  updateRelationship({ ownerActorId, otherActorId, sourceMemoryId, deltas = {}, commitmentId, unresolvedThreadId }) {
    const source = this.memory(sourceMemoryId);
    if (!source || source.ownerActorId !== ownerActorId) throw new Error("私人关系更新必须引用拥有者自己的记忆");
    const key = relationshipKey(ownerActorId, otherActorId);
    const relationship = this.relationships.get(key);
    if (!relationship) throw new Error("必须先有公共相识 Event 才能建立主观关系");
    for (const [name, delta] of Object.entries(deltas)) {
      if (!RELATIONSHIP_DIMENSIONS.includes(name) || !Number.isInteger(delta) || Math.abs(delta) > 10) throw new Error("关系变化步长非法");
      relationship[name] = clampRelationshipDimension(name, relationship[name] + delta);
    }
    if (commitmentId) {
      const commitment = this.memory(commitmentId);
      if (!commitment || commitment.ownerActorId !== ownerActorId || commitment.kind !== "commitment") throw new Error("关系承诺必须引用拥有者的承诺记忆");
      if (!relationship.commitments.includes(commitmentId)) relationship.commitments.push(commitmentId);
    }
    if (unresolvedThreadId) {
      const unresolved = this.memory(unresolvedThreadId);
      if (!unresolved || unresolved.ownerActorId !== ownerActorId) throw new Error("未解线索必须引用拥有者的记忆");
      if (!relationship.unresolvedThreads.includes(unresolvedThreadId)) relationship.unresolvedThreads.push(unresolvedThreadId);
    }
    if (!relationship.landmarkMemoryIds.includes(sourceMemoryId)) {
      relationship.landmarkMemoryIds.push(sourceMemoryId);
    }
    return structuredClone(relationship);
  }

  relationship(ownerActorId, otherActorId) {
    const value = this.relationships.get(relationshipKey(ownerActorId, otherActorId));
    return value ? structuredClone(value) : null;
  }

  publicProjection() {
    return [...this.acquaintances.values()]
      .sort((left, right) => left.sourceEventId.localeCompare(right.sourceEventId))
      .map(clone);
  }

  snapshot() {
    return {
      schemaVersion: 1,
      working: this.working.map(clone),
      longTerm: this.longTerm.map(clone),
      relationships: [...this.relationships.values()].map(clone),
      acquaintances: this.publicProjection(),
    };
  }

  restore(snapshot) {
    if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.working) || !Array.isArray(snapshot.longTerm)
      || !Array.isArray(snapshot.relationships) || !Array.isArray(snapshot.acquaintances)) throw new Error("Memory Graph 快照非法");
    const records = [...snapshot.working, ...snapshot.longTerm];
    for (const record of records) {
      const result = validateMemoryRecord(record);
      if (!result.ok) throw new Error(`Memory Graph 快照记忆非法：${result.reason}`);
    }
    const byId = new Map();
    for (const record of records) {
      const existing = byId.get(record.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(record)) throw new Error("Memory Graph 快照含冲突记忆");
      byId.set(record.id, record);
    }
    const relationshipKeys = new Set();
    for (const relationship of snapshot.relationships) {
      const result = validateRelationshipView(relationship);
      if (!result.ok) throw new Error(`Memory Graph 快照关系非法：${result.reason}`);
      const key = relationshipKey(relationship.ownerActorId, relationship.otherActorId);
      if (relationshipKeys.has(key)) throw new Error("Memory Graph 快照含重复关系");
      relationshipKeys.add(key);
      for (const memoryId of relationship.landmarkMemoryIds) if (!byId.has(memoryId)) throw new Error("Memory Graph 快照关系来源不存在");
    }
    const acquaintanceKeys = new Set();
    for (const edge of snapshot.acquaintances) {
      const result = validateAcquaintanceEdge(edge);
      if (!result.ok) throw new Error(`Memory Graph 快照相识边非法：${result.reason}`);
      const key = acquaintanceKey(...edge.actorIds);
      if (acquaintanceKeys.has(key)) throw new Error("Memory Graph 快照含重复相识边");
      acquaintanceKeys.add(key);
      const [left, right] = edge.actorIds;
      if (!relationshipKeys.has(relationshipKey(left, right)) || !relationshipKeys.has(relationshipKey(right, left))) {
        throw new Error("Memory Graph 快照相识边缺少双向私人关系视图");
      }
    }
    this.working = snapshot.working.map(clone);
    this.longTerm = snapshot.longTerm.map(clone);
    this.relationships = new Map(snapshot.relationships.map((relationship) => [relationshipKey(relationship.ownerActorId, relationship.otherActorId), structuredClone(relationship)]));
    this.acquaintances = new Map(snapshot.acquaintances.map((edge) => [acquaintanceKey(...edge.actorIds), structuredClone(edge)]));
  }
}

export class IndexedDbMemoryStore {
  constructor(name = "echo-town-memory") { this.name = name; }

  async database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("memory");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async transact(mode, operation) {
    const database = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("memory", mode);
        const request = operation(transaction.objectStore("memory"));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }

  get() { return this.transact("readonly", (store) => store.get("owner-memory-v1")); }
  set(snapshot) { return this.transact("readwrite", (store) => store.put(structuredClone(snapshot), "owner-memory-v1")); }
  clear() { return this.transact("readwrite", (store) => store.delete("owner-memory-v1")); }
}
