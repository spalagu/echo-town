import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPersonaEvent,
  DILEMMA_FIXTURES,
  initialGrowthState,
  PERSONA_FIXTURES,
  rankIntentCandidates,
  validatePersonaDecision,
  validatePersonaProfile,
} from "../src/index.js";

test("12 个冻结人格在 10 类困境中产生可解释的确定性候选", () => {
  assert.equal(PERSONA_FIXTURES.length, 12);
  assert.equal(DILEMMA_FIXTURES.length, 10);
  for (const dilemma of DILEMMA_FIXTURES) {
    const preferred = new Set();
    for (const profile of PERSONA_FIXTURES) {
      const first = rankIntentCandidates(profile, dilemma);
      const second = rankIntentCandidates(profile, dilemma);
      assert.deepEqual(first, second);
      assert.equal(first.candidates.length, 3);
      assert.equal(validatePersonaDecision(first, profile).ok, true);
      preferred.add(first.candidates[0].strategyId);
    }
    assert.ok(preferred.size >= 8, `${dilemma.id} 只有 ${preferred.size} 种首选策略`);
  }
});

test("人格改变行动排序而非只改变文案，且可以拒绝玩家建议", () => {
  const dilemma = DILEMMA_FIXTURES.find((item) => item.id === "player_request");
  const decisions = PERSONA_FIXTURES.map((profile) => rankIntentCandidates(profile, dilemma));
  assert.ok(new Set(decisions.map((decision) => JSON.stringify(decision.candidates[0].intent))).size >= 4);
  assert.ok(decisions.some((decision) => !decision.candidates[0].acceptedPlayerSuggestion));
  assert.ok(decisions.some((decision) => decision.candidates[0].acceptedPlayerSuggestion));
});

test("受保护特征不能进入 PersonaProfile 或决策输入", () => {
  assert.equal(Object.isFrozen(PERSONA_FIXTURES[0].traits), true);
  assert.equal(Object.isFrozen(DILEMMA_FIXTURES[0].options[0].intent), true);
  assert.throws(() => validatePersonaProfile({ ...PERSONA_FIXTURES[0], protectedTraits: { gender: "x" } }), /字段非法/);
});

test("单事件和 30 日核心特质变化分别限制为 1 与 5", () => {
  let profile = PERSONA_FIXTURES[0];
  let state = initialGrowthState(0);
  for (let day = 0; day < 5; day += 1) {
    const result = applyPersonaEvent(profile, state, growthEvent(day, 1));
    assert.equal(result.ok, true);
    ({ profile, state } = result);
  }
  const overflow = applyPersonaEvent(profile, state, growthEvent(5, 1));
  assert.equal(overflow.ok, false);
  assert.equal(overflow.reason, "thirty_day_trait_limit");
  const replay = applyPersonaEvent(profile, state, growthEvent(4, 0));
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "source_event_replay");
  const nextWindow = applyPersonaEvent(profile, state, growthEvent(30, 1));
  assert.equal(nextWindow.ok, true);
  assert.equal(nextWindow.state.windowStartDay, 30);
  assert.equal(nextWindow.state.cumulativeTraitDeltas.openness, 1);
  assert.throws(() => applyPersonaEvent(profile, state, growthEvent(5, 2)), /PersonaGrowthEvent 非法/);
});

test("移除解释因素会被决策 gate 拒绝", () => {
  const profile = PERSONA_FIXTURES[0];
  const decision = rankIntentCandidates(profile, DILEMMA_FIXTURES[0]);
  decision.candidates[0].factors = [];
  assert.equal(validatePersonaDecision(decision, profile).ok, false);
});

function growthEvent(logicalDay, delta) {
  return {
    schemaVersion: 1,
    logicalDay,
    traitDeltas: { openness: delta, conscientiousness: 0, extraversion: 0, agreeableness: 0, sensitivity: 0 },
    moodDelta: { valence: 1, arousal: -1 },
    needDeltas: { energy: -1, belonging: 0, safety: 0, autonomy: 0, achievement: 1, curiosity: 0 },
    sourceEventIds: [`event-${logicalDay}`],
  };
}
