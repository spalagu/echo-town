import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { MemoryGraph, calculateSalience, validateMemoryRecord } from "../src/index.js";

function record(index, overrides = {}) {
  return {
    id: `memory-${index}`,
    ownerActorId: "actor-a",
    kind: "event",
    summary: `actor-a observed event ${index} near actor-b`,
    sourceEventIds: [`event-${index}`],
    subjects: ["actor-b"],
    logicalTime: index,
    salience: calculateSalience({ novelty: 50, emotionalIntensity: index % 100, goalImpact: 40, relationshipImpact: 70, playerRelevance: 20 }),
    emotionalValence: (index % 101) - 50,
    confidence: 80,
    visibility: "private",
    consolidationParentIds: [],
    decayClass: "ordinary",
    ...overrides,
  };
}

test("100 个记忆场景均保留来源、置信度、可见性并完成巩固", () => {
  const graph = new MemoryGraph();
  for (let index = 0; index < 100; index += 1) {
    const value = record(index);
    assert.equal(validateMemoryRecord(value).ok, true);
    graph.remember(value);
    if ((index + 1) % 8 === 0) graph.consolidate(index);
  }
  graph.consolidate(100);
  for (const memory of graph.allMemories()) {
    assert.ok(memory.sourceEventIds.length > 0);
    assert.ok(memory.confidence >= 0 && memory.confidence <= 100);
    assert.ok(["private", "shared", "public"].includes(memory.visibility));
  }
  assert.ok(graph.snapshot().working.length <= 64);
  assert.ok(graph.snapshot().longTerm.length <= 200);
});

test("公共相识与两侧私人关系保持非对称", () => {
  const graph = new MemoryGraph();
  graph.observeAcquaintance({ actorIds: ["actor-a", "actor-b"], sourceEventId: "meet-1", logicalTime: 1 });
  graph.remember(record(1, { id: "a-view", sourceEventIds: ["meet-1"], kind: "relationship", summary: "actor-a trusts actor-b", subjects: ["actor-b"] }));
  graph.remember(record(2, { id: "b-view", ownerActorId: "actor-b", sourceEventIds: ["meet-1"], kind: "relationship", summary: "actor-b fears actor-a", subjects: ["actor-a"] }));
  graph.updateRelationship({ ownerActorId: "actor-a", otherActorId: "actor-b", sourceMemoryId: "a-view", deltas: { trust: 8, affinity: 3 }, landmark: true });
  graph.updateRelationship({ ownerActorId: "actor-b", otherActorId: "actor-a", sourceMemoryId: "b-view", deltas: { trust: -4, fear: 7 }, landmark: true });
  assert.equal(graph.publicProjection().length, 1);
  assert.equal(graph.relationship("actor-a", "actor-b").trust, 8);
  assert.equal(graph.relationship("actor-b", "actor-a").trust, -4);
  assert.equal(JSON.stringify(graph.publicProjection()).includes("trust"), false);
});

test("纠正追加而不覆盖旧记忆，关键记忆不普通遗忘", () => {
  const graph = new MemoryGraph();
  graph.remember(record(1, { id: "old-belief", kind: "semantic", summary: "the bell rang twice", confidence: 90 }));
  graph.remember(record(2, { id: "correction", kind: "correction", summary: "new evidence says the bell rang once", confidence: 80, consolidationParentIds: ["old-belief"], decayClass: "protected" }));
  graph.remember(record(3, { id: "promise", kind: "commitment", summary: "actor-a promised actor-b", decayClass: "protected" }));
  graph.consolidate(3);
  assert.equal(graph.memory("old-belief").summary, "the bell rang twice");
  assert.equal(graph.effectiveConfidence("old-belief"), 50);
  graph.forget(10_000);
  assert.ok(graph.memory("promise"));
  assert.ok(graph.memory("correction"));
});

test("检索采用冻结权重、最多 12 条且 200 条规模满足预算", () => {
  const graph = new MemoryGraph();
  for (let index = 0; index < 200; index += 1) {
    graph.remember(record(index));
    if ((index + 1) % 8 === 0) graph.consolidate(index);
  }
  const elapsed = [];
  for (let index = 0; index < 1_000; index += 1) {
    const started = performance.now();
    const values = graph.retrieve({ text: `event ${index % 200}`, subjectIds: ["actor-b"], relatedActorIds: ["actor-b"], goalKinds: ["event"], logicalTime: 200 });
    elapsed.push(performance.now() - started);
    assert.ok(values.length <= 12);
    assert.ok(values.every((value) => value.record.sourceEventIds.length > 0));
  }
  elapsed.sort((left, right) => left - right);
  const p95 = elapsed[Math.floor(elapsed.length * 0.95)];
  assert.ok(p95 < 25, `检索 P95 ${p95.toFixed(3)}ms 超过宽松回归预算`);
  console.log(JSON.stringify({ records: graph.allMemories().length, queries: 1_000, p95Ms: p95, serializedBytes: JSON.stringify(graph.snapshot()).length }));
});

test("三类 mutation：无来源、覆盖同 id、私人字段外发均判红", () => {
  const graph = new MemoryGraph();
  assert.equal(validateMemoryRecord(record(1, { sourceEventIds: [] })).ok, false);
  graph.remember(record(1));
  assert.throws(() => graph.remember(record(1, { summary: "overwrite" })), /不能覆盖/);
  graph.observeAcquaintance({ actorIds: ["actor-a", "actor-b"], sourceEventId: "meet-1", logicalTime: 1 });
  const publicPayload = JSON.stringify(graph.publicProjection());
  assert.equal(publicPayload.includes("private"), false);
  assert.equal(publicPayload.includes("AP17_PRIVATE_CANARY"), false);
  const snapshot = graph.snapshot();
  snapshot.acquaintances[0].privateCanary = "AP17_PRIVATE_CANARY";
  assert.throws(() => new MemoryGraph(snapshot), /快照相识边非法/);
});
