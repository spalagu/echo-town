import assert from "node:assert/strict";
import test from "node:test";
import {
  CapabilityController,
  describeCapabilityState,
  FAULT_FIXTURES,
  PublicNodeRetry,
  validateCapabilityState,
} from "../src/index.js";

test("12 个固定故障全部进入声明的显式降级状态", () => {
  assert.equal(FAULT_FIXTURES.length, 12);
  for (const fault of FAULT_FIXTURES) {
    const controller = new CapabilityController();
    const result = controller.injectFault(fault.code, 1);
    assert.equal(result.state[fault.capability], fault.status);
    assert.equal(result.details[fault.capability].fallback, fault.fallback);
    assert.notEqual(result.details[fault.capability].reason, "ready");
    assert.match(describeCapabilityState(result), /(降级|不可用)/);
  }
});

test("恢复需要连续两次确认，避免单次探测导致状态抖动", () => {
  const controller = new CapabilityController();
  controller.injectFault("model_corrupt", 1);
  assert.equal(controller.reportRecovery("localMind", 2).state.localMind, "degraded");
  assert.equal(controller.reportRecovery("localMind", 3).state.localMind, "ready");
});

test("公共节点严格按 5/15/45 秒退避，随后停止自动重试", () => {
  const retry = new PublicNodeRetry(["relay-a", "relay-b", "relay-c"]);
  assert.deepEqual([retry.failCurrent(1_000).retryDelayMs, retry.failCurrent(6_000).retryDelayMs, retry.failCurrent(21_000).retryDelayMs], [5_000, 15_000, 45_000]);
  const exhausted = retry.failCurrent(66_000);
  assert.equal(exhausted.exhausted, true);
  assert.equal(exhausted.retryDelayMs, 0);
  assert.equal(exhausted.nextRetryAt, 0);
  assert.equal(retry.reportSuccess().failureCount, 0);
});

test("CapabilityState exact-key gate 拒绝静默或未知状态", () => {
  assert.throws(() => validateCapabilityState({ schemaVersion: 1, render: "ready", localMind: "ready", network: "ready", persistence: "ready", silent: true }), /非法/);
  assert.throws(() => validateCapabilityState({ schemaVersion: 1, render: "ready", localMind: "healthy", network: "ready", persistence: "ready" }), /非法/);
});
