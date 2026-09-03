import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { CompanionSession } from "@echo-town/companion-core";
import { simulateMystery } from "@echo-town/mystery-fabric";
import { PERSONA_FIXTURES } from "@echo-town/persona-core";
import { simulateSociety } from "@echo-town/public-discourse";
import { WEIGHTS, buildEngagementState, createStudyPlan, evaluateStudy, validateEngagementState } from "../src/index.js";

const root = path.resolve(".");
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
const situationIds = ["ash-rain", "broken-cart", "late-traveler", "medicine-delay", "distant-bell"];
const mysteryIds = ["borrowed-echoes", "tideglass-drift", "third-shadow"];
const initialState = await readJson("world/society/initial-states/river-shortage.json");
const plans = await Promise.all(situationIds.map((id) => readJson(`world/society/situation-seeds/${id}.json`)));
const mysteries = await Promise.all(mysteryIds.map((id) => readJson(`world/mysteries/${id}.json`)));
const seed = 31415;
const profile = PERSONA_FIXTURES[0];
const simulation = simulateSociety(initialState, plans, seed);
const mysteryRuns = mysteries.map((mystery, index) => simulateMystery(mystery, profile, index + 3));
const companion = new CompanionSession({
  ownerActorId: "local-owner",
  sourceActorId: `${profile.id}-${seed}`,
  personaProfile: profile,
  events: simulation.events,
  claims: simulation.claims,
  memories: simulation.memories,
  acquaintances: simulation.acquaintances,
});
const pending = companion.submitInfluence({ kind: "wish", text: "愿你继续了解旧钟楼", logicalDay: 30 });
const considered = companion.considerInfluence(pending.id);
const behaviorEventIds = considered.sourceBehaviorIds.flatMap((id) => companion.explainBehavior(id).behavior.sourceEventIds);
const influences = [{
  id: considered.id,
  status: considered.status,
  sourceEventIds: [...new Set([...behaviorEventIds, ...considered.sourceRelationshipEventIds])],
}];

function input() {
  return {
    actorId: `${profile.id}-${seed}`,
    generatedAtTick: 30,
    events: structuredClone(simulation.events),
    claims: structuredClone(simulation.claims),
    relationships: structuredClone(simulation.acquaintances),
    resources: structuredClone(simulation.resources),
    plans: structuredClone(plans),
    mysteryRuns: structuredClone(mysteryRuns),
    influences: structuredClone(influences),
  };
}

function sources(raw) {
  return {
    events: raw.events.concat(raw.mysteryRuns.flatMap((item) => item.events)),
    claims: raw.claims.concat(raw.mysteryRuns.flatMap((item) => item.claims)),
    plans: raw.plans,
    influences: raw.influences,
  };
}

test("冻结六维权重，并从真实关系、悬疑、争议、稀缺、社会变化和参与影响中选出 3–7 个钩子", () => {
  assert.deepEqual(WEIGHTS, {
    unfinishedRelationship: 0.25,
    mystery: 0.20,
    controversy: 0.20,
    scarcity: 0.15,
    socialChange: 0.10,
    contributionImpact: 0.10,
  });
  const raw = input();
  const state = buildEngagementState(raw);
  assert.ok(state.hooks.length >= 3 && state.hooks.length <= 7);
  assert.deepEqual(new Set(state.hooks.map((item) => item.kind)), new Set([
    "relationship", "mystery", "controversy", "scarcity", "social_change", "contribution",
  ]));
  assert.deepEqual(state.coverageGaps, []);
  assert.equal(validateEngagementState(state, sources(raw)).ok, true);
  assert.ok(state.hooks.every((item) => item.readOnly && !item.worldWritable));
  const scarcity = state.hooks.find((item) => item.kind === "scarcity");
  assert.equal(scarcity.expiresAtTick, 39);
  assert.equal(scarcity.notificationCandidate, true);
});

test("相同快照确定地产生相同结果，Director 不改写世界、角色目标或来源输入", () => {
  const raw = input();
  const before = JSON.stringify(raw);
  const left = buildEngagementState(raw);
  const right = buildEngagementState(raw);
  assert.deepEqual(left, right);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(Object.hasOwn(left, "goals"), false);
  assert.equal(Object.hasOwn(left, "events"), false);
  assert.equal(JSON.stringify(left).includes("WorldEvent"), false);
});

test("四组消融分别移除对应信号，只证明信号暴露差异，不冒充留存结论", () => {
  const raw = input();
  const full = buildEngagementState(raw);
  assert.deepEqual(full.ablations, []);
  for (const [ablation, kind] of Object.entries({
    relationship: "relationship", mystery: "mystery", scarcity: "scarcity", contribution: "contribution",
  })) {
    const state = buildEngagementState(raw, { ablations: [ablation] });
    assert.ok(state.ablations.includes(ablation));
    assert.equal(state.hooks.some((item) => item.kind === kind), false);
    assert.ok(full.hooks.some((item) => item.kind === kind));
  }
});

test("伪造来源、写世界权限和无到期通知候选全部失败关闭", () => {
  const raw = input();
  const baseline = buildEngagementState(raw);
  const forgedSource = structuredClone(baseline);
  forgedSource.hooks[0].sourceEventIds = ["invented-event"];
  assert.equal(validateEngagementState(forgedSource, sources(raw)).ok, false);

  const writable = structuredClone(baseline);
  writable.hooks[0].worldWritable = true;
  assert.equal(validateEngagementState(writable, sources(raw)).ok, false);

  const fakeNotification = structuredClone(baseline);
  fakeNotification.hooks[0].notificationCandidate = true;
  fakeNotification.hooks[0].expiresAtTick = null;
  assert.equal(validateEngagementState(fakeNotification, sources(raw)).ok, false);

  assert.throws(() => buildEngagementState({ ...raw, influences: [{ id: "fake", status: "accepted_as_influence", sourceEventIds: ["invented"] }] }), /影响来源非法/u);
});

test("AP-19 runner 冻结 40 名知情成年人、20/20 分组、14 日口径与最小匿名记录", () => {
  const participants = Array.from({ length: 40 }, (_, index) => ({
    id: `participant-${String(index + 1).padStart(2, "0")}`,
    informedConsent: true,
    adult: true,
  }));
  const plan = createStudyPlan({
    studyId: "ap19-synthetic-fixture",
    preregisteredAt: "2026-09-02T00:00:00Z",
    randomizationSeed: 1901,
    participants,
  });
  assert.equal(plan.arms.full.length, 20);
  assert.equal(plan.arms.ablation.length, 20);
  assert.equal(new Set([...plan.arms.full, ...plan.arms.ablation]).size, 40);
  assert.deepEqual(plan.ablations, ["relationship", "mystery", "scarcity", "contribution"]);
  assert.equal(plan.rawPrivateMemoryAllowed, false);

  const syntheticRecords = [...plan.arms.full, ...plan.arms.ablation].map((participantId) => ({
    participantId,
    activeDays: plan.arms.full.includes(participantId) ? [0, 1, 2, 4, 7] : [0, 1, 2],
    recalledStoryFactCount: plan.arms.full.includes(participantId) ? 2 : 1,
  }));
  const syntheticResult = evaluateStudy(plan, syntheticRecords);
  assert.equal(syntheticResult.passed, true);
  assert.equal(syntheticResult.containsRawPrivateMemory, false);
  assert.equal(syntheticResult.day7Lift, 1);
  assert.throws(() => evaluateStudy(plan, syntheticRecords.map((item, index) => index === 0
    ? { ...item, rawPrivateMemory: "禁止收集" } : item)), /禁止原始私人记忆/u);
  assert.throws(() => createStudyPlan({
    studyId: "ap19-underage-fixture", preregisteredAt: "2026-09-02T00:00:00Z", randomizationSeed: 1,
    participants: participants.map((item, index) => index === 0 ? { ...item, adult: false } : item),
  }), /知情同意的成年/u);
});

test("AP-19 runner 对未达阈值的合成记录如实判失败，不用技术测试冒充真实留存", () => {
  const participants = Array.from({ length: 40 }, (_, index) => ({
    id: `participant-fail-${String(index + 1).padStart(2, "0")}`, informedConsent: true, adult: true,
  }));
  const plan = createStudyPlan({
    studyId: "ap19-failing-synthetic-fixture", preregisteredAt: "2026-09-02T00:00:00Z", randomizationSeed: 19, participants,
  });
  const result = evaluateStudy(plan, participants.map((item) => ({
    participantId: item.id, activeDays: [0], recalledStoryFactCount: 0,
  })));
  assert.equal(result.passed, false);
  assert.ok(Object.values(result.checks).every((value) => value === false));
});
