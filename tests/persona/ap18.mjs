import assert from "node:assert/strict";
import {
  applyPersonaEvent,
  DILEMMA_FIXTURES,
  initialGrowthState,
  PERSONA_FIXTURES,
  rankIntentCandidates,
  validatePersonaDecision,
} from "../../packages/persona-core/src/index.js";

const results = [];
for (const dilemma of DILEMMA_FIXTURES) {
  const decisions = PERSONA_FIXTURES.map((profile) => rankIntentCandidates(profile, dilemma));
  const strategies = new Set(decisions.map((decision) => decision.candidates[0].strategyId));
  const actions = new Set(decisions.map((decision) => JSON.stringify(decision.candidates[0].intent)));
  assert.ok(strategies.size >= 8);
  assert.ok(decisions.every((decision, index) => validatePersonaDecision(decision, PERSONA_FIXTURES[index]).ok));
  results.push({ dilemmaId: dilemma.id, preferredStrategies: strategies.size, distinctWorldIntents: actions.size });
}

const fixedProfileStrategies = new Set(DILEMMA_FIXTURES[0].options.map(() => (
  rankIntentCandidates(PERSONA_FIXTURES[0], DILEMMA_FIXTURES[0]).candidates[0].strategyId
)));
assert.ok(fixedProfileStrategies.size < 8, "固定人格 mutation 应判红");

const explanationMutation = rankIntentCandidates(PERSONA_FIXTURES[0], DILEMMA_FIXTURES[0]);
explanationMutation.candidates.forEach((candidate) => { candidate.factors = []; });
assert.equal(validatePersonaDecision(explanationMutation, PERSONA_FIXTURES[0]).ok, false, "移除因素 mutation 应判红");

const largeStep = {
  schemaVersion: 1,
  logicalDay: 0,
  traitDeltas: { openness: 2, conscientiousness: 0, extraversion: 0, agreeableness: 0, sensitivity: 0 },
  moodDelta: { valence: 0, arousal: 0 },
  needDeltas: { energy: 0, belonging: 0, safety: 0, autonomy: 0, achievement: 0, curiosity: 0 },
  sourceEventIds: ["ap18-mutation"],
};
assert.throws(() => applyPersonaEvent(PERSONA_FIXTURES[0], initialGrowthState(), largeStep));

const playerDilemma = DILEMMA_FIXTURES.find((item) => item.id === "player_request");
const playerDecisions = PERSONA_FIXTURES.map((profile) => rankIntentCandidates(profile, playerDilemma));
assert.ok(playerDecisions.some((decision) => decision.candidates[0].acceptedPlayerSuggestion));
assert.ok(playerDecisions.some((decision) => !decision.candidates[0].acceptedPlayerSuggestion));

console.log(JSON.stringify({
  personas: PERSONA_FIXTURES.length,
  dilemmas: DILEMMA_FIXTURES.length,
  scenarios: PERSONA_FIXTURES.length * DILEMMA_FIXTURES.length,
  results,
  playerSuggestionAccepted: playerDecisions.filter((decision) => decision.candidates[0].acceptedPlayerSuggestion).length,
  playerSuggestionRefused: playerDecisions.filter((decision) => !decision.candidates[0].acceptedPlayerSuggestion).length,
  mutations: { fixedPersona: "red", removedFactors: "red", largeTraitStep: "red" },
}, null, 2));
