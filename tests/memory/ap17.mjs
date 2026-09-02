import assert from "node:assert/strict";
import { MemoryGraph } from "../../packages/memory-graph/src/index.js";

function memory(id, overrides = {}) {
  return {
    id,
    ownerActorId: "actor-a",
    kind: "event",
    summary: `有来源的记忆 ${id}`,
    sourceEventIds: [`event-${id}`],
    subjects: ["actor-b"],
    logicalTime: 1,
    salience: 70,
    emotionalValence: 10,
    confidence: 80,
    visibility: "private",
    consolidationParentIds: [],
    decayClass: "ordinary",
    ...overrides,
  };
}

const counts = { acquaintance: 0, commitment: 0, misunderstanding: 0, correction: 0, forgetting: 0 };
let assertions = 0;

for (let index = 0; index < 100; index += 1) {
  const graph = new MemoryGraph();
  const kind = Object.keys(counts)[Math.floor(index / 20)];
  if (kind === "acquaintance") {
    graph.observeAcquaintance({ actorIds: ["actor-a", `actor-b-${index}`], sourceEventId: `meet-${index}`, logicalTime: index });
    const payload = JSON.stringify(graph.publicProjection());
    assert.ok(payload.includes(`meet-${index}`));
    assert.equal(payload.includes("trust"), false);
    assertions += 2;
  } else if (kind === "commitment") {
    graph.remember(memory(`promise-${index}`, { kind: "commitment", decayClass: "protected" }));
    graph.consolidate(1);
    graph.forget(10_000);
    assert.ok(graph.memory(`promise-${index}`));
    assertions += 1;
  } else if (kind === "misunderstanding") {
    graph.remember(memory(`belief-${index}`, { kind: "semantic", confidence: 45 }));
    assert.equal(graph.memory(`belief-${index}`).confidence, 45);
    assert.ok(graph.memory(`belief-${index}`).sourceEventIds.length);
    assertions += 2;
  } else if (kind === "correction") {
    graph.remember(memory(`old-${index}`, { kind: "semantic", confidence: 90 }));
    graph.remember(memory(`fix-${index}`, { kind: "correction", confidence: 80, consolidationParentIds: [`old-${index}`], decayClass: "protected" }));
    assert.equal(graph.memory(`old-${index}`).confidence, 90);
    assert.equal(graph.effectiveConfidence(`old-${index}`), 50);
    assertions += 2;
  } else {
    graph.remember(memory(`detail-${index}`, { logicalTime: 0, salience: 0, confidence: 0 }));
    graph.consolidate(0);
    const forgotten = graph.forget(1_000);
    assert.ok(forgotten.includes(`detail-${index}`));
    assertions += 1;
  }
  counts[kind] += 1;
}

assert.deepEqual(counts, { acquaintance: 20, commitment: 20, misunderstanding: 20, correction: 20, forgetting: 20 });
console.log(JSON.stringify({ scenarios: 100, counts, assertions, allPassed: true }));
