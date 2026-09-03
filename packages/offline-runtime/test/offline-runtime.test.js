import assert from "node:assert/strict";
import test from "node:test";
import { OfflineActivityQueue, validatePendingActivity } from "../src/index.js";

function activity(index = 0) {
  return {
    schemaVersion: 1,
    id: `offline-${index}`,
    actorId: "echo-test",
    kind: "mergeable_local",
    sourceEventIds: [`source-${index}`],
    logicalTime: index,
    publicProjection: { eventType: "ObservedPlace", placeId: "old-clocktower" },
  };
}

test("离线活动保留可重同步的最小公开投影", () => {
  const queue = new OfflineActivityQueue();
  queue.record(activity(1));
  const prepared = queue.prepareResync();
  assert.equal(prepared.activities.length, 1);
  assert.equal(prepared.containsPrivatePayload, false);
  assert.deepEqual(new OfflineActivityQueue(queue.snapshot()).snapshot(), queue.snapshot());
});

test("确认后只删除已同步活动", () => {
  const queue = new OfflineActivityQueue([activity(1), activity(2)]);
  queue.acknowledge(["offline-1"]);
  assert.deepEqual(queue.snapshot().map((item) => item.id), ["offline-2"]);
});

test("exact-key gate 拒绝私人载荷和重复活动", () => {
  assert.throws(() => validatePendingActivity({ ...activity(), privateMemory: "AP11_PRIVATE" }), /非法/);
  const queue = new OfflineActivityQueue([activity()]);
  assert.throws(() => queue.record(activity()), /重复/);
});
