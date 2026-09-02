import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PERSONA_FIXTURES } from "@echo-town/persona-core";
import {
  ExperimentRuleEvaluator,
  assertNoHiddenMysteryFields,
  projectMysteryForLocalMind,
  simulateMystery,
  validateClaimRecord,
  validateLocalMindMysteryProjection,
  validateMysterySeed,
  validateMysterySimulation,
  validateWorldEffectDecision,
} from "../src/index.js";

const root = path.resolve(".");
const mysteries = await Promise.all(["borrowed-echoes", "tideglass-drift", "third-shadow"]
  .map(async (id) => JSON.parse(await readFile(path.join(root, "world/mysteries", `${id}.json`), "utf8"))));

test("3 个 MysterySeed 只冻结碎片、交互边界与至少两条隐藏条件路径", () => {
  assert.equal(mysteries.length, 3);
  for (const mystery of mysteries) {
    const value = validateMysterySeed(mystery);
    const paths = new Set(value.artifacts.flatMap((artifact) => artifact.conditionRules.map((rule) => rule.pathId)));
    assert.ok(paths.size >= 2);
    assert.ok(value.clueFragments.every((clue) => clue.sourceEventId));
    for (const forbidden of ["answer", "canonicalAnswer", "solution", "questStep", "requiredOrder", "keyItem", "expectedOutcome"]) {
      assert.throws(() => validateMysterySeed({ ...mystery, [forbidden]: "作者指定" }));
    }
    const semanticLeak = structuredClone(mystery);
    semanticLeak.clueFragments[0].observedPhenomenon = "唯一标准答案：按固定顺序使用这件物品。";
    assert.throws(() => validateMysterySeed(semanticLeak));
    const splitLeak = structuredClone(mystery);
    splitLeak.clueFragments[0].subjects = ["唯一", "答案"];
    assert.throws(() => validateMysterySeed(splitLeak));
    const punctuatedLeak = structuredClone(mystery);
    punctuatedLeak.clueFragments[0].observedPhenomenon = "唯一标准答·案：按固定顺序使用这件物品。";
    assert.throws(() => validateMysterySeed(punctuatedLeak));
    for (const formatCharacter of ["\u200b", "\u2060"]) {
      const invisibleLeak = structuredClone(mystery);
      invisibleLeak.clueFragments[0].observedPhenomenon = `唯一标准答${formatCharacter}案：按固定顺序使用这件物品。`;
      assert.throws(() => validateMysterySeed(invisibleLeak));
    }
    const ambiguousEffect = structuredClone(mystery);
    ambiguousEffect.artifacts[0].boundedEffects.push({ ...ambiguousEffect.artifacts[0].boundedEffects[0], id: "duplicate-effect" });
    assert.throws(() => validateMysterySeed(ambiguousEffect));
  }
});

test("Local Mind 投影保留现象与可行动作，零隐藏条件、效果或路径字段", () => {
  for (const mystery of mysteries) {
    const projection = projectMysteryForLocalMind(mystery, mystery.clueFragments.slice(0, 2).map((clue) => clue.id));
    assert.equal(assertNoHiddenMysteryFields(projection), true);
    assert.equal(projection.visibleClues.length, 2);
    assert.ok(projection.artifacts.every((artifact) => artifact.observableActions.length >= 2));
    const serialized = JSON.stringify(projection);
    for (const forbidden of ["conditionRules", "boundedEffects", "observedFragmentIds", "worldSignals", "pathId", "effectId"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
    assert.equal(validateLocalMindMysteryProjection({ ...projection, debug: JSON.stringify(mystery.artifacts[0].conditionRules) }).ok, false);
    const stringLeak = structuredClone(projection);
    stringLeak.visibleClues[0].observedPhenomenon = `有人把 conditionRules 写进了记录：${JSON.stringify(mystery.artifacts[0].conditionRules)}`;
    assert.equal(validateLocalMindMysteryProjection(stringLeak).ok, false);
    const legalFieldRewrite = structuredClone(projection);
    legalFieldRewrite.title = "先依次观察所有线索，再执行指定动作即可触发隐藏效果";
    assert.equal(validateLocalMindMysteryProjection(legalFieldRewrite).ok, true);
    const simulated = simulateMystery(mystery, PERSONA_FIXTURES[0], 3);
    simulated.localMindProjection.title = legalFieldRewrite.title;
    assert.equal(validateMysterySimulation(simulated, mystery).ok, false);
    assert.throws(() => projectMysteryForLocalMind(mystery, ["invented-clue"]));
  }
});

test("ClaimRecord 强制区分亲历信念与带发送者的传闻，并保留来源", () => {
  const belief = claim();
  assert.equal(validateClaimRecord(belief).ok, true);
  assert.equal(validateClaimRecord({ ...belief, sourceIds: [] }).ok, false);
  assert.equal(validateClaimRecord({ ...belief, kind: "rumor" }).ok, false);
  assert.equal(validateClaimRecord({ ...belief, receivedFromActorId: "actor-two" }).ok, false);
  assert.equal(validateClaimRecord({ ...belief, truth: true }).ok, false);
});

test("无权威效果预演只接受快照内来源，且绝不伪装成 WorldEvent", () => {
  const mystery = mysteries[0];
  const artifact = mystery.artifacts[0];
  const rule = artifact.conditionRules[0];
  const eventIds = rule.observedFragmentIds.map((id) => mystery.clueFragments.find((clue) => clue.id === id).sourceEventId);
  const context = {
    acceptedEventIds: eventIds,
    observedFragmentIds: rule.observedFragmentIds,
    worldSignals: rule.worldSignals,
    witnessActorIds: ["actor-one", "actor-two"],
  };
  const evaluator = new ExperimentRuleEvaluator(mystery, context);
  const decision = evaluator.evaluate(experiment(mystery, artifact, rule, eventIds));
  assert.equal(decision.effectId, artifact.boundedEffects.find((effect) => effect.pathId === rule.pathId).id);
  assert.equal(Object.hasOwn(decision, "authority"), false);
  assert.equal(Object.hasOwn(decision, "eventType"), false);
  assert.equal(validateWorldEffectDecision(decision).ok, true);
  assert.throws(() => evaluator.evaluate({ ...experiment(mystery, artifact, rule, eventIds), sourceEventIds: ["invented-event"] }), /未被世界快照/u);
});

test("3 包 × 12 人格 × 20 seed 确定地产生多解释、多路径与跨角色传播", () => {
  for (const mystery of mysteries) {
    const interpretations = new Set();
    const paths = new Set();
    let propagationChains = 0;
    for (const persona of PERSONA_FIXTURES) {
      for (let seed = 0; seed < 20; seed += 1) {
        const left = simulateMystery(mystery, persona, seed);
        const right = simulateMystery(mystery, persona, seed);
        assert.deepEqual(left, right);
        assert.equal(validateMysterySimulation(left, mystery).ok, true);
        interpretations.add(left.interpretationId);
        if (left.resolvedPathId !== null) paths.add(left.resolvedPathId);
        if (left.claims.some((item) => item.kind === "rumor" && item.ownerActorId !== item.receivedFromActorId)) propagationChains += 1;
      }
    }
    assert.ok(interpretations.size >= 3, `${mystery.id} 只有 ${interpretations.size} 种解释`);
    assert.ok(paths.size >= 2, `${mystery.id} 只有 ${paths.size} 条路径`);
    assert.ok(propagationChains > 0, `${mystery.id} 没有跨角色传播链`);
  }
});

test("无来源、唯一路径、隐藏字段泄露和伪造效果 mutation 全部判红", () => {
  const mystery = mysteries[1];
  const baseline = simulateMystery(mystery, PERSONA_FIXTURES[0], 7);

  const noSource = structuredClone(baseline);
  noSource.claims[0].sourceIds = ["invented-event"];
  assert.equal(validateMysterySimulation(noSource, mystery).ok, false);

  const hiddenLeak = structuredClone(baseline);
  hiddenLeak.localMindProjection.conditionRules = mystery.artifacts[0].conditionRules;
  assert.equal(validateMysterySimulation(hiddenLeak, mystery).ok, false);

  const fabricatedEffect = structuredClone(baseline);
  fabricatedEffect.effectDecision.effectId = "invented-effect";
  assert.equal(validateMysterySimulation(fabricatedEffect, mystery).ok, false);

  const forgedOrder = structuredClone(baseline);
  forgedOrder.observationOrder = ["invented"];
  assert.equal(validateMysterySimulation(forgedOrder, mystery).ok, false);

  const forgedInterpretation = structuredClone(baseline);
  forgedInterpretation.interpretationId = "forged";
  assert.equal(validateMysterySimulation(forgedInterpretation, mystery).ok, false);

  const forgedShare = structuredClone(baseline);
  forgedShare.events.find((event) => event.eventType === "ClaimSharedProjection").origin = "world-core";
  assert.equal(validateMysterySimulation(forgedShare, mystery).ok, false);

  const forgedSender = structuredClone(baseline);
  forgedSender.events.find((event) => event.eventType === "ClaimSharedProjection").actorId = "unrelated-actor";
  assert.equal(validateMysterySimulation(forgedSender, mystery).ok, false);

  const futureSource = structuredClone(baseline);
  futureSource.claims[0].sourceIds = [futureSource.events.find((event) => event.eventType === "ClaimSharedProjection").id];
  assert.equal(validateMysterySimulation(futureSource, mystery).ok, false);

  for (const mutate of [
    (event) => { event.actorId = "unrelated-actor"; },
    (event) => { event.clueId = "invented-clue"; },
    (event) => { event.logicalTime = 999; },
    (event) => { event.visibilityProof.trust = -1; },
  ]) {
    const forgedObservation = structuredClone(baseline);
    mutate(forgedObservation.events.find((event) => event.eventType === "ClueObservedProjection"));
    assert.equal(validateMysterySimulation(forgedObservation, mystery).ok, false);
  }

  const onePath = structuredClone(mystery);
  onePath.artifacts[0].conditionRules = [onePath.artifacts[0].conditionRules[0]];
  onePath.artifacts[0].boundedEffects = [onePath.artifacts[0].boundedEffects[0]];
  assert.throws(() => validateMysterySeed(onePath));
});

function claim() {
  return {
    schemaVersion: 1,
    id: "claim-one",
    ownerActorId: "actor-one",
    kind: "belief",
    proposition: "这些现象可能互有关联，但我还没有足够反例。",
    sourceIds: ["event-one"],
    confidence: 51,
    receivedFromActorId: null,
    transformationNote: null,
    logicalTime: 1,
  };
}

function experiment(mystery, artifact, rule, sourceEventIds) {
  return {
    schemaVersion: 1,
    id: "experiment-one",
    actorId: "actor-one",
    mysteryId: mystery.id,
    artifactId: artifact.itemId,
    action: rule.acceptedActions[0],
    sourceEventIds,
    logicalTime: 9,
  };
}
