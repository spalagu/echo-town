import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createHistoricalSummary,
  PublicDiscourse,
  simulateSociety,
  validateDiscourseClaim,
  validateInitialStatePack,
  validatePlannerObservation,
  validateSimulationResult,
  validateSituationSeed,
} from "../src/index.js";

const root = path.resolve(".");
const initialStates = await loadJsonFiles("world/society/initial-states", ["river-shortage", "market-debt", "clinic-renovation"]);
const situations = await loadJsonFiles("world/society/situation-seeds", ["ash-rain", "broken-cart", "late-traveler", "medicine-delay", "distant-bell"]);

test("3 个 InitialStatePack 与 5 个 SituationSeed 只含开端、规则和可行动作", () => {
  assert.equal(initialStates.length, 3);
  assert.equal(situations.length, 5);
  initialStates.forEach((pack) => assert.equal(validateInitialStatePack(pack).id, pack.id));
  situations.forEach((seed) => assert.equal(validateSituationSeed(seed).id, seed.id));
  for (const forbidden of ["castSlots", "participants", "goal", "plotStage", "expectedOutcome", "ending"]) {
    assert.throws(() => validateInitialStatePack({ ...initialStates[0], [forbidden]: "作者控制" }));
  }
});

test("Public Discourse 保留 Event 来源、受众、转述和反驳，heat 不产生真值", () => {
  const discourse = new PublicDiscourse(["event-a", "event-b"]);
  const first = discourse.publish(claim({ id: "claim-a", sourceEventIds: ["event-a"] }));
  const second = discourse.publish(claim({ id: "claim-b", sourceEventIds: ["event-b"], stance: "oppose", parentClaimId: first.id, refutesClaimId: first.id }));
  assert.equal(second.mutationDepth, 1);
  assert.ok(second.heat > first.heat);
  assert.equal(Object.hasOwn(second, "truth"), false);
  assert.equal(Object.hasOwn(second, "consensus"), false);
  assert.throws(() => discourse.publish({ ...claim({ id: "bad-source", sourceEventIds: ["missing"] }) }), /不存在/u);
  assert.throws(() => discourse.publish({ ...claim({ id: "bad-heat" }), heat: 100 }), /只能由来源图计算/u);
  assert.throws(() => discourse.publish(claim({
    id: "invisible-parent",
    speakerActorId: "actor-three",
    sourceEventIds: ["event-b"],
    parentClaimId: first.id,
  })), /不可见/u);
  assert.equal(validateDiscourseClaim({ ...second, consensus: true }).ok, false);
});

test("HistoricalSummary 只读且 PlannerObservation exact-key gate 拒绝回灌", () => {
  const summary = createHistoricalSummary({
    id: "summary-one", title: "测试摘要", generatedAtTick: 2,
    events: [{ id: "event-a", kind: "observe" }, { id: "event-b", kind: "share" }],
  });
  assert.equal(summary.readOnly, true);
  const planner = plannerObservation();
  assert.equal(validatePlannerObservation(planner).ok, true);
  assert.equal(validatePlannerObservation({ ...planner, historicalSummary: summary }).ok, false);
  assert.equal(validatePlannerObservation({ ...planner, goal: summary.summary }).ok, false);
});

test("社会模拟确定、全部派生结果有来源且每个初态形成至少 5 种轨迹", () => {
  for (const initialState of initialStates) {
    const signatures = new Set();
    for (let seed = 0; seed < 30; seed += 1) {
      const left = simulateSociety(initialState, situations, seed);
      const right = simulateSociety(initialState, situations, seed);
      assert.deepEqual(left, right);
      assertResultSources(left);
      signatures.add(left.trajectorySignature);
    }
    assert.ok(signatures.size >= 5, `${initialState.id} 只有 ${signatures.size} 种轨迹`);
  }
});

test("每个 SituationSeed 在 20 seed 中形成至少 3 类社会结果且资源零悬挂", () => {
  for (const situation of situations) {
    const signatures = new Set();
    for (let seed = 0; seed < 20; seed += 1) {
      const result = simulateSociety(initialStates[seed % initialStates.length], [situation], seed);
      signatures.add(result.trajectorySignature);
      assert.equal(result.pendingTemporaryResources, 0);
      assert.ok(result.events.some((event) => event.kind === "resource_expired"));
    }
    assert.ok(signatures.size >= 3, `${situation.id} 只有 ${signatures.size} 类结果`);
  }
});

test("初态与情境字段真实改变行动，资源账本按实际量回收且未知资源失败关闭", () => {
  const baseline = simulateSociety(initialStates[0], [situations[0]], 17);
  const changedInitial = structuredClone(initialStates[0]);
  changedInitial.observations[0].fact = "河湾出现了与原观察完全不同的公开痕迹";
  changedInitial.tensions[0].pressure = 1;
  changedInitial.tensions[0].uncertainty = 100;
  changedInitial.actionAffordances = ["observe", "share_claim", "trade", "repair"];
  const changedSituation = structuredClone(situations[0]);
  changedSituation.trigger.startTick += 7;
  changedSituation.trigger.durationTicks += 5;
  changedSituation.observations[0].fact = "灰雨没有留下痕迹，但井沿出现了盐粒";
  changedSituation.actionAffordances = ["observe", "trade", "repair"];
  const counterfactual = simulateSociety(changedInitial, [changedSituation], 17);
  assert.notDeepEqual(actionDigest(baseline), actionDigest(counterfactual));

  const scarce = structuredClone(initialStates[0]);
  scarce.resources = scarce.resources.map((item) => ({ ...item, quantity: item.id === "food" ? 1 : item.quantity, replenishesPerTick: 0, expiresAfterTicks: 0 }));
  const extreme = structuredClone(situations[0]);
  extreme.resourceDeltas[0] = { resourceId: "food", amount: -1000, expiresAfterTicks: 2 };
  const recovered = simulateSociety(scarce, [extreme], 0);
  const ledger = recovered.resourceLedger.find((item) => item.kind === "temporary" && item.resourceId === "food");
  assert.equal(ledger.actualAppliedDelta, -1);
  assert.equal(ledger.reversalAppliedDelta, 1);
  assert.equal(recovered.pendingTemporaryResources, 0);

  const depleted = structuredClone(initialStates[0]);
  depleted.resources = depleted.resources.map((item) => ({ ...item, quantity: 1, replenishesPerTick: 0, expiresAfterTicks: 0 }));
  depleted.tensions = [{ id: "food-pressure", resourceId: "food", pressure: 100, uncertainty: 1 }];
  depleted.actionAffordances = ["observe", "withdraw", "ignore", "verify"];
  const depletion = structuredClone(situations[2]);
  depletion.resourceDeltas = [{ resourceId: "food", amount: -1, expiresAfterTicks: 12 }];
  depletion.actionAffordances = ["observe", "withdraw", "ignore"];
  const guarded = simulateSociety(depleted, [depletion], 0);
  const emptyActions = guarded.events.filter((item) => item.actionAffordance && item.resourceLevelBefore === 0);
  assert.ok(emptyActions.length > 0);
  assert.ok(emptyActions.every((item) => item.actualResourceDelta >= 0), "可见库存为零时不得继续扣减");

  const unknown = structuredClone(situations[0]);
  unknown.resourceDeltas[0].resourceId = "unknown-resource";
  assert.throws(() => simulateSociety(initialStates[0], [unknown], 0), /未知资源/u);
});

test("反馈环、受众、affordance、回收和自然过期 mutation 全部判红", () => {
  const result = simulateSociety(initialStates[0], [situations[0]], 4);
  assert.equal(validateSimulationResult(result, initialStates[0], [situations[0]]).ok, true);

  const noMemory = structuredClone(result);
  noMemory.events.filter((item) => item.actionAffordance).forEach((item) => { item.memoryInputIds = []; });
  assert.equal(validateSimulationResult(noMemory, initialStates[0], [situations[0]]).ok, false);

  const noDiscourse = structuredClone(result);
  noDiscourse.events.filter((item) => item.actionAffordance).forEach((item) => { item.claimInputIds = []; });
  assert.equal(validateSimulationResult(noDiscourse, initialStates[0], [situations[0]]).ok, false);

  const badAffordance = structuredClone(result);
  badAffordance.events.find((item) => item.actionAffordance).actionAffordance = "author_forced";
  assert.equal(validateSimulationResult(badAffordance, initialStates[0], [situations[0]]).ok, false);

  const missingDecisionFactors = structuredClone(result);
  missingDecisionFactors.events.find((item) => item.actionAffordance).decisionFactors = [];
  assert.equal(validateSimulationResult(missingDecisionFactors, initialStates[0], [situations[0]]).ok, false);

  const tamperedDecisionUtility = structuredClone(result);
  tamperedDecisionUtility.events.find((item) => item.actionAffordance).decisionUtility += 1;
  assert.equal(validateSimulationResult(tamperedDecisionUtility, initialStates[0], [situations[0]]).ok, false);

  const inventedDecisionFactor = structuredClone(result);
  inventedDecisionFactor.events.find((item) => item.actionAffordance).decisionFactors[0].path = "author.explanation";
  assert.equal(validateSimulationResult(inventedDecisionFactor, initialStates[0], [situations[0]]).ok, false);

  const tamperedFactorValue = structuredClone(result);
  const profileFactor = tamperedFactorValue.events.find((item) => item.actionAffordance).decisionFactors
    .find((factor) => factor.path !== "dilemma.contextWeight" && factor.path !== "playerSuggestion");
  profileFactor.value = `伪造-${profileFactor.value}`;
  assert.equal(validateSimulationResult(tamperedFactorValue, initialStates[0], [situations[0]]).ok, false);

  const audienceBypass = structuredClone(result);
  const child = audienceBypass.claims.find((item) => item.parentClaimId && audienceBypass.claims.find((parent) => parent.id === item.parentClaimId)?.speakerActorId !== item.speakerActorId);
  assert.ok(child);
  audienceBypass.claims.find((item) => item.id === child.parentClaimId).audienceActorIds = ["unrelated-actor"];
  assert.equal(validateSimulationResult(audienceBypass, initialStates[0], [situations[0]]).ok, false);

  const brokenRecovery = structuredClone(result);
  brokenRecovery.resourceLedger.find((item) => item.kind === "temporary").reversalAppliedDelta += 1;
  assert.equal(validateSimulationResult(brokenRecovery, initialStates[0], [situations[0]]).ok, false);

  const missingNaturalExpiry = structuredClone(result);
  missingNaturalExpiry.events = missingNaturalExpiry.events.filter((item) => item.kind !== "resource_naturally_expired");
  assert.equal(validateSimulationResult(missingNaturalExpiry, initialStates[0], [situations[0]]).ok, false);

  const overdraft = structuredClone(result);
  const overdraftAction = overdraft.events.find((item) => item.actionAffordance);
  overdraftAction.resourceLevelBefore = 0;
  overdraftAction.actualResourceDelta = -1;
  assert.equal(validateSimulationResult(overdraft, initialStates[0], [situations[0]]).ok, false);

  const brokenEventOrder = structuredClone(result);
  brokenEventOrder.events.find((item) => item.sourceEventIds.length > 0).sequence = 0;
  assert.equal(validateSimulationResult(brokenEventOrder, initialStates[0], [situations[0]]).ok, false);

  const brokenClaimOrder = structuredClone(result);
  brokenClaimOrder.claims.reverse();
  assert.equal(validateSimulationResult(brokenClaimOrder, initialStates[0], [situations[0]]).ok, false);

  const missingRelationshipSource = structuredClone(result);
  assert.ok(missingRelationshipSource.acquaintances.length > 0);
  missingRelationshipSource.acquaintances[0].sourceEventId = "missing-event";
  assert.equal(validateSimulationResult(missingRelationshipSource, initialStates[0], [situations[0]]).ok, false);

  const missingPlannerSource = structuredClone(result);
  missingPlannerSource.plannerObservations[0].visibleEventIds[0] = "missing-event";
  assert.equal(validateSimulationResult(missingPlannerSource, initialStates[0], [situations[0]]).ok, false);
});

function claim(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "claim-one",
    speakerActorId: "actor-one",
    stance: "uncertain",
    statement: "我只确认自己看见的部分。",
    sourceEventIds: ["event-a"],
    audienceActorIds: ["actor-two"],
    parentClaimId: null,
    refutesClaimId: null,
    logicalTime: 1,
    ...overrides,
  };
}

function plannerObservation() {
  return {
    actorId: "actor-one", tick: 2, visibleEventIds: ["event-a"], memoryIds: ["memory-a"],
    claimIds: ["claim-a"], resourceSignals: [{ resourceId: "food", level: 20, trend: "stable" }], situationTags: ["rain"],
  };
}

function assertResultSources(result) {
  const eventIds = new Set(result.events.map((event) => event.id));
  assert.ok(result.events.every((item) => item.sourceEventIds.every((id) => eventIds.has(id))));
  assert.ok(result.claims.every((item) => item.sourceEventIds.every((id) => eventIds.has(id))));
  assert.ok(result.memories.every((item) => item.sourceEventIds.every((id) => eventIds.has(id))));
  assert.ok(result.acquaintances.every((item) => eventIds.has(item.sourceEventId)));
  assert.ok(result.resources.every((item) => item.sourceEventIds.length > 0 && item.sourceEventIds.every((id) => eventIds.has(id))));
  assert.ok(result.historicalSummary.sourceEventIds.every((id) => eventIds.has(id)));
  assert.ok(result.plannerObservations.every((item) => !JSON.stringify(item).includes(result.historicalSummary.id)));
  const memoryIds = new Set(result.memories.map((item) => item.id));
  const claimIds = new Set(result.claims.map((item) => item.id));
  assert.ok(result.plannerObservations.every((item) => item.visibleEventIds.every((id) => eventIds.has(id))
    && item.memoryIds.every((id) => memoryIds.has(id)) && item.claimIds.every((id) => claimIds.has(id))));
}

function actionDigest(result) {
  return result.events.filter((item) => item.actionAffordance).map((item) => ({
    tick: item.tick,
    actorId: item.actorId,
    action: item.actionAffordance,
    context: item.decisionContextHash,
    detail: item.detail,
    observations: item.observationEventIds,
    memories: item.memoryInputIds,
    claims: item.claimInputIds,
  }));
}

async function loadJsonFiles(directory, ids) {
  return Promise.all(ids.map(async (id) => JSON.parse(await readFile(path.join(root, directory, `${id}.json`), "utf8"))));
}
