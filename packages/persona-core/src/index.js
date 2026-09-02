import {
  NEED_NAMES,
  TRAIT_NAMES,
  scorePersonaOption,
  validateDilemma,
  validatePersonaDecision,
  validatePersonaProfile,
} from "./contracts.js";

export { NEED_NAMES, TRAIT_NAMES, VALUE_NAMES, validateDilemma, validatePersonaDecision, validatePersonaProfile } from "./contracts.js";
export { DILEMMA_FIXTURES, PERSONA_FIXTURES } from "./fixtures.js";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function rankIntentCandidates(rawProfile, rawDilemma, { maxCandidates = 3 } = {}) {
  const profile = validatePersonaProfile(rawProfile);
  const dilemma = validateDilemma(rawDilemma);
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 3) {
    throw new Error("Persona Core 候选数量必须为 1～3");
  }
  const decision = {
    schemaVersion: 1,
    profileId: profile.id,
    dilemmaId: dilemma.id,
    candidates: dilemma.options
      .map((option) => scorePersonaOption(profile, dilemma, option))
      .sort((left, right) => right.utility - left.utility || left.strategyId.localeCompare(right.strategyId))
      .slice(0, maxCandidates),
  };
  const validation = validatePersonaDecision(decision, profile, dilemma);
  if (!validation.ok) throw new Error(`Persona Core 产生非法决策：${validation.reason}`);
  return validation.decision;
}

const GROWTH_STATE_KEYS = new Set(["schemaVersion", "windowStartDay", "cumulativeTraitDeltas", "sourceEventIds"]);
const EVENT_KEYS = new Set(["schemaVersion", "logicalDay", "traitDeltas", "moodDelta", "needDeltas", "sourceEventIds"]);
const MOOD_KEYS = new Set(["valence", "arousal"]);

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function exactDeltaMap(value, names, minimum, maximum) {
  const keys = new Set(names);
  return exactObject(value, keys) && names.every((name) => Number.isInteger(value[name]) && value[name] >= minimum && value[name] <= maximum);
}

export function initialGrowthState(windowStartDay = 0) {
  if (!Number.isInteger(windowStartDay) || windowStartDay < 0) throw new Error("人格成长窗口非法");
  return {
    schemaVersion: 1,
    windowStartDay,
    cumulativeTraitDeltas: Object.fromEntries(TRAIT_NAMES.map((name) => [name, 0])),
    sourceEventIds: [],
  };
}

export function applyPersonaEvent(rawProfile, rawState, event) {
  const profile = validatePersonaProfile(rawProfile);
  if (!exactObject(rawState, GROWTH_STATE_KEYS) || rawState.schemaVersion !== 1
    || !Number.isInteger(rawState.windowStartDay) || rawState.windowStartDay < 0
    || !exactDeltaMap(rawState.cumulativeTraitDeltas, TRAIT_NAMES, -5, 5)
    || !Array.isArray(rawState.sourceEventIds) || rawState.sourceEventIds.length > 64
    || rawState.sourceEventIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 96)
    || new Set(rawState.sourceEventIds).size !== rawState.sourceEventIds.length) throw new Error("PersonaGrowthState 非法");
  if (!exactObject(event, EVENT_KEYS) || event.schemaVersion !== 1 || !Number.isInteger(event.logicalDay)
    || event.logicalDay < rawState.windowStartDay || !exactDeltaMap(event.traitDeltas, TRAIT_NAMES, -1, 1)
    || !exactObject(event.moodDelta, MOOD_KEYS) || !Number.isInteger(event.moodDelta.valence)
    || !Number.isInteger(event.moodDelta.arousal) || Math.abs(event.moodDelta.valence) > 20
    || Math.abs(event.moodDelta.arousal) > 20 || !exactDeltaMap(event.needDeltas, NEED_NAMES, -20, 20)
    || !Array.isArray(event.sourceEventIds) || event.sourceEventIds.length === 0
    || event.sourceEventIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 96)
    || new Set(event.sourceEventIds).size !== event.sourceEventIds.length) {
    throw new Error("PersonaGrowthEvent 非法");
  }
  const state = event.logicalDay >= rawState.windowStartDay + 30 ? initialGrowthState(event.logicalDay) : structuredClone(rawState);
  if (event.sourceEventIds.some((id) => state.sourceEventIds.includes(id))) {
    return { ok: false, reason: "source_event_replay", profile, state };
  }
  const cumulativeTraitDeltas = Object.fromEntries(TRAIT_NAMES.map((trait) => [
    trait,
    state.cumulativeTraitDeltas[trait] + event.traitDeltas[trait],
  ]));
  if (TRAIT_NAMES.some((trait) => Math.abs(cumulativeTraitDeltas[trait]) > 5)) {
    return { ok: false, reason: "thirty_day_trait_limit", profile, state };
  }
  for (const trait of TRAIT_NAMES) {
    state.cumulativeTraitDeltas[trait] = cumulativeTraitDeltas[trait];
    profile.traits[trait] = clamp(profile.traits[trait] + event.traitDeltas[trait], 0, 100);
  }
  profile.mood.valence = clamp(profile.mood.valence + event.moodDelta.valence, -100, 100);
  profile.mood.arousal = clamp(profile.mood.arousal + event.moodDelta.arousal, 0, 100);
  for (const need of NEED_NAMES) profile.needs[need] = clamp(profile.needs[need] + event.needDeltas[need], 0, 100);
  state.sourceEventIds.push(...event.sourceEventIds);
  if (state.sourceEventIds.length > 64) state.sourceEventIds.splice(0, state.sourceEventIds.length - 64);
  return { ok: true, profile, state, sourceEventIds: [...event.sourceEventIds] };
}
