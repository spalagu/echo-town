import assert from "node:assert/strict";
import { CapabilityController, FAULT_FIXTURES, PublicNodeRetry } from "../../packages/capability-state/src/index.js";

const outcomes = [];
for (const fault of FAULT_FIXTURES) {
  const controller = new CapabilityController();
  const injected = controller.injectFault(fault.code, outcomes.length + 1);
  assert.equal(injected.state[fault.capability], fault.status);
  assert.equal(injected.details[fault.capability].fallback, fault.fallback);
  assert.equal(injected.transitions.length, 1);
  const firstProbe = controller.reportRecovery(fault.capability, 100);
  assert.equal(firstProbe.state[fault.capability], fault.status);
  const recovered = controller.reportRecovery(fault.capability, 101);
  assert.equal(recovered.state[fault.capability], "ready");
  outcomes.push({ code: fault.code, capability: fault.capability, status: fault.status, fallback: fault.fallback });
}

const retry = new PublicNodeRetry(["community-a", "community-b", "community-c"]);
const retrySchedule = [retry.failCurrent(0), retry.failCurrent(5_000), retry.failCurrent(20_000), retry.failCurrent(65_000)];
assert.deepEqual(retrySchedule.map((item) => item.retryDelayMs), [5_000, 15_000, 45_000, 0]);
assert.equal(retrySchedule[3].exhausted, true);

console.log(JSON.stringify({ faults: outcomes.length, outcomes, retryDelaysMs: [5_000, 15_000, 45_000], retriesStopAfterSchedule: true, recoveryConfirmations: 2 }, null, 2));
