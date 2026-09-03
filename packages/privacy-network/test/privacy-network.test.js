import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_WIRE_FIELD_PATHS,
  PrivacyNetworkGate,
  createPublicActivityEnvelope,
  enumerateWireFieldPaths,
} from "../src/index.js";

const CANARY = "AP10_PRIVATE_CANARY_7f3b";

function input(overrides = {}) {
  return {
    worldId: "echo-town-local",
    zoneId: "center",
    senderActorId: "actor-ap10",
    messageId: "message-ap10",
    logicalTime: 10,
    activity: {
      schemaVersion: 1,
      id: "activity-ap10",
      actorId: "actor-ap10",
      kind: "mergeable_local",
      sourceEventIds: ["event-ap10"],
      logicalTime: 10,
      publicProjection: { eventType: "ObservedPlace", placeId: "old-clocktower" },
    },
    privateContext: {
      privateMemory: CANARY,
      rawPrompt: `不要出站 ${CANARY}`,
      modelReasoning: `内部推理 ${CANARY}`,
      browserFingerprint: `稳定指纹 ${CANARY}`,
    },
    ...overrides,
  };
}

test("公开活动协议字段全集严格等于允许集合且私人 canary 不出站", () => {
  const envelope = createPublicActivityEnvelope(input());
  assert.deepEqual(enumerateWireFieldPaths(envelope), PUBLIC_WIRE_FIELD_PATHS);
  assert.equal(JSON.stringify(envelope).includes(CANARY), false);
});

test("活动、公开投影与允许字段值中的私人数据 mutation 全部判红", () => {
  assert.throws(() => createPublicActivityEnvelope(input({
    activity: { ...input().activity, privateMemory: CANARY },
  })), /PendingActivity 非法/);
  assert.throws(() => createPublicActivityEnvelope(input({
    activity: { ...input().activity, publicProjection: { ...input().activity.publicProjection, rawPrompt: CANARY } },
  })), /PendingActivity 非法/);
  assert.throws(() => createPublicActivityEnvelope(input({
    activity: { ...input().activity, publicProjection: { eventType: "ObservedPlace", placeId: CANARY } },
  })), /私人上下文/);
});

test("HTTP transport 固定无凭证、无 referrer、无缓存并发送唯一协议载荷", async () => {
  const calls = [];
  const gate = new PrivacyNetworkGate({
    endpoint: "/__echo-town-sync",
    baseUrl: "https://example.test/town/",
    fetchImpl: async (...args) => {
      calls.push(args);
      return { ok: true, status: 202 };
    },
  });
  const result = await gate.sendPublicActivity(input());
  assert.equal(result.status, 202);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://example.test/__echo-town-sync");
  assert.deepEqual(calls[0][1].credentials, "omit");
  assert.deepEqual(calls[0][1].referrerPolicy, "no-referrer");
  assert.deepEqual(calls[0][1].cache, "no-store");
  assert.deepEqual(JSON.parse(calls[0][1].body), result.envelope);
});
