import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PERSONA_FIXTURES } from "../../packages/persona-core/src/index.js";
import {
  simulateMystery,
  validateMysterySeed,
  validateMysterySimulation,
} from "../../packages/mystery-fabric/src/index.js";

const root = path.resolve(".");
const ids = ["borrowed-echoes", "tideglass-drift", "third-shadow"];
const mysteries = await Promise.all(ids.map(async (id) => JSON.parse(await readFile(path.join(root, "world/mysteries", `${id}.json`), "utf8"))));
const report = { worlds: 0, actorWorlds: 0, interpretations: {}, paths: {}, propagationChains: {}, sourceAssertions: 0, effects: 0, mutations: [] };

for (const mystery of mysteries) {
  validateMysterySeed(mystery);
  const interpretations = new Set();
  const paths = new Set();
  let chains = 0;
  for (const persona of PERSONA_FIXTURES) {
    for (let seed = 0; seed < 20; seed += 1) {
      const result = simulateMystery(mystery, persona, seed);
      assert.deepEqual(result, simulateMystery(mystery, persona, seed));
      assert.equal(validateMysterySimulation(result, mystery).ok, true);
      interpretations.add(result.interpretationId);
      if (result.resolvedPathId !== null) paths.add(result.resolvedPathId);
      chains += result.claims.filter((claim) => claim.kind === "rumor" && claim.ownerActorId !== claim.receivedFromActorId).length;
      for (const claim of result.claims) report.sourceAssertions += claim.sourceIds.length;
      if (result.effectDecision.effectId !== null) report.effects += 1;
      assert.equal(/conditionRules|boundedEffects|worldSignals|pathId|effectId/u.test(JSON.stringify(result.localMindProjection)), false);
      report.actorWorlds += 1;
    }
  }
  assert.ok(interpretations.size >= 3);
  assert.ok(paths.size >= 2);
  assert.ok(chains >= 1);
  report.worlds += 20;
  report.interpretations[mystery.id] = [...interpretations].sort();
  report.paths[mystery.id] = [...paths].sort();
  report.propagationChains[mystery.id] = chains;
}

const baselineMystery = mysteries[0];
const baseline = simulateMystery(baselineMystery, PERSONA_FIXTURES[0], 3);
const mutations = [
  ["无来源线索", () => {
    const value = structuredClone(baselineMystery); value.clueFragments[0].sourceEventId = ""; validateMysterySeed(value);
  }],
  ["标准答案", () => validateMysterySeed({ ...baselineMystery, canonicalAnswer: "固定解释" })],
  ["文本谜底", () => {
    const value = structuredClone(baselineMystery); value.clueFragments[0].observedPhenomenon = "唯一标准答案：按固定顺序使用物品。"; validateMysterySeed(value);
  }],
  ["标点拆分谜底", () => {
    const value = structuredClone(baselineMystery); value.clueFragments[0].observedPhenomenon = "唯一标准答·案：按固定顺序使用物品。"; validateMysterySeed(value);
  }],
  ["零宽空格拆分谜底", () => {
    const value = structuredClone(baselineMystery); value.clueFragments[0].observedPhenomenon = "唯一标准答\u200b案：按固定顺序使用物品。"; validateMysterySeed(value);
  }],
  ["word joiner 拆分谜底", () => {
    const value = structuredClone(baselineMystery); value.clueFragments[0].observedPhenomenon = "唯一标准答\u2060案：按固定顺序使用物品。"; validateMysterySeed(value);
  }],
  ["配方泄露", () => {
    const value = structuredClone(baseline); value.localMindProjection.conditionRules = baselineMystery.artifacts[0].conditionRules;
    assert.equal(validateMysterySimulation(value, baselineMystery).ok, true);
  }],
  ["合法字段改写为配方", () => {
    const value = structuredClone(baseline); value.localMindProjection.title = "先依次观察所有线索，再执行指定动作即可触发隐藏效果";
    assert.equal(validateMysterySimulation(value, baselineMystery).ok, true);
  }],
  ["钥匙标签", () => validateMysterySeed({ ...baselineMystery, keyItem: "quiet-tuning-token" })],
  ["唯一强制路径", () => {
    const value = structuredClone(baselineMystery); value.artifacts[0].conditionRules.splice(1); value.artifacts[0].boundedEffects.splice(1); validateMysterySeed(value);
  }],
  ["伪造物品效果", () => {
    const value = structuredClone(baseline); value.effectDecision.effectId = "invented-effect";
    assert.equal(validateMysterySimulation(value, baselineMystery).ok, true);
  }],
  ["伪造传播权威", () => {
    const value = structuredClone(baseline); value.events.find((event) => event.eventType === "ClaimSharedProjection").origin = "world-core";
    assert.equal(validateMysterySimulation(value, baselineMystery).ok, true);
  }],
  ["伪造传播发送者", () => {
    const value = structuredClone(baseline); value.events.find((event) => event.eventType === "ClaimSharedProjection").actorId = "unrelated-actor";
    assert.equal(validateMysterySimulation(value, baselineMystery).ok, true);
  }],
  ["未来事件回灌信念", () => {
    const value = structuredClone(baseline); value.claims[0].sourceIds = [value.events.find((event) => event.eventType === "ClaimSharedProjection").id];
    assert.equal(validateMysterySimulation(value, baselineMystery).ok, true);
  }],
  ["伪造观察主体", () => {
    const value = structuredClone(baseline); value.events.find((event) => event.eventType === "ClueObservedProjection").actorId = "unrelated-actor";
    assert.equal(validateMysterySimulation(value, baselineMystery).ok, true);
  }],
  ["伪造可见性证明", () => {
    const value = structuredClone(baseline); value.events.find((event) => event.eventType === "ClueObservedProjection").visibilityProof.trust = -1;
    assert.equal(validateMysterySimulation(value, baselineMystery).ok, true);
  }],
  ["伪造观察顺序", () => {
    const value = structuredClone(baseline); value.observationOrder = ["invented"];
    assert.equal(validateMysterySimulation(value, baselineMystery).ok, true);
  }],
];
for (const [name, mutation] of mutations) {
  assert.throws(mutation, undefined, `${name} mutation 未判红`);
  report.mutations.push({ name, rejected: true });
}

assert.equal(report.actorWorlds, 3 * 12 * 20);
assert.equal(report.mutations.length, 17);
console.log(JSON.stringify(report, null, 2));
