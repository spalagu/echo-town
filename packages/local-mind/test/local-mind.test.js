import assert from "node:assert/strict";
import test from "node:test";
import { MindCapability, decideByRules, gateIntentProposals, sanitizeObservation } from "../src/index.js";

function observation(index = 0) {
  return {
    actorId: "echo_test",
    logicalTime: index,
    position: { x: index, y: -index },
    nearbyPlaces: [
      { id: "market", dx: 3, dy: -2, tags: ["social"] },
      { id: "home", dx: -2, dy: 1, tags: ["rest"] },
    ],
    needs: [{ kind: index % 2 === 0 ? "rest" : "social", level: 80 }],
    visibleEvents: [],
  };
}

test("规则器在 50 个固定场景产生合法且确定的 Intent", () => {
  for (let index = 0; index < 50; index += 1) {
    const first = decideByRules(observation(index));
    const second = decideByRules(observation(index));
    assert.deepEqual(first, second);
    assert.equal(gateIntentProposals(first).ok, true);
  }
});

test("Observation 白名单拒绝私人字段", () => {
  assert.throws(() => sanitizeObservation({ ...observation(), privateMemory: "AP03_CANARY" }), /未授权字段/);
});

test("Observation 只接收来源化记忆与有界关系信号", () => {
  const sanitized = sanitizeObservation({
    ...observation(),
    recalledMemories: [{
      id: "memory-1",
      kind: "event",
      sourceEventIds: ["event-1"],
      logicalTime: 1,
      effectiveConfidence: 90,
    }],
    relationshipSignals: [{
      otherActorId: "echo_neighbor",
      familiarity: 1,
      trust: 2,
      affinity: 3,
      respect: 4,
      fear: 0,
      intimacy: 0,
    }],
  });
  assert.deepEqual(sanitized.recalledMemories[0].sourceEventIds, ["event-1"]);
  assert.equal(sanitized.relationshipSignals[0].otherActorId, "echo_neighbor");
  assert.throws(() => sanitizeObservation({
    ...observation(),
    recalledMemories: [{
      id: "memory-1",
      kind: "event",
      sourceEventIds: [],
      logicalTime: 1,
      effectiveConfidence: 90,
    }],
  }), /recalledMemory/);
});

test("Intent gate 拒绝越权字段、越界移动和第四个 Intent", () => {
  const valid = decideByRules(observation())[0];
  assert.equal(gateIntentProposals([{ ...valid, writeWorldState: true }]).ok, false);
  assert.equal(gateIntentProposals([{ ...valid, payload: { dx: 2, dy: 0 } }]).ok, false);
  assert.equal(gateIntentProposals([valid, valid, valid, valid]).ok, false);
});

test("CPU 连续三次失败后降级 60 秒且只探测一次", () => {
  let now = 10_000;
  const capability = new MindCapability({ now: () => now });
  capability.requestCpu();
  capability.recordFailure("empty");
  capability.recordFailure("invalid");
  const failed = capability.recordFailure("runtime");
  assert.equal(failed.mode, "rules");
  assert.equal(failed.cooldownUntil, 70_000);
  assert.equal(capability.canProbe(), false);
  now = 70_000;
  assert.equal(capability.canProbe(), true);
  assert.equal(capability.canProbe(), false);
  capability.recordSuccess();
  assert.equal(capability.snapshot().mode, "cpu-wasm");
});
