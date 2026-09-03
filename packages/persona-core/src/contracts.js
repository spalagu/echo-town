export const TRAIT_NAMES = Object.freeze([
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "sensitivity",
]);

export const NEED_NAMES = Object.freeze([
  "energy",
  "belonging",
  "safety",
  "autonomy",
  "achievement",
  "curiosity",
]);

export const VALUE_NAMES = Object.freeze([
  "关怀",
  "自由",
  "创造",
  "共同体",
  "传统",
  "冒险",
  "真相",
  "成就",
  "公正",
]);

const PROFILE_KEYS = new Set([
  "schemaVersion",
  "id",
  "traits",
  "values",
  "desire",
  "fear",
  "contradiction",
  "habits",
  "speechStyle",
  "mood",
  "needs",
]);
const MOOD_KEYS = new Set(["valence", "arousal"]);
const DILEMMA_KEYS = new Set(["schemaVersion", "id", "title", "playerSuggestionId", "options"]);
const OPTION_KEYS = new Set(["id", "label", "intent", "traitVector", "values", "need", "moodAxis", "motifs", "contextWeight"]);
const INTENT_KEYS = new Set(["schemaVersion", "intentType", "payload", "budget", "reasonCode"]);
const PAYLOAD_KEYS = new Set(["dx", "dy"]);
const DECISION_KEYS = new Set(["schemaVersion", "profileId", "dilemmaId", "candidates"]);
const CANDIDATE_KEYS = new Set([
  "schemaVersion",
  "strategyId",
  "label",
  "intent",
  "utility",
  "factors",
  "acceptedPlayerSuggestion",
  "voice",
]);
const FACTOR_KEYS = new Set(["path", "value", "contribution"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isObject(value)
    && Object.keys(value).length === keys.size
    && Object.keys(value).every((key) => keys.has(key));
}

function isInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isText(value, maximum = 160) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function assertNumberMap(value, names, minimum, maximum, label) {
  const keys = new Set(names);
  if (!hasExactKeys(value, keys)) throw new Error(`${label} 字段非法`);
  for (const name of names) {
    if (!isInteger(value[name], minimum, maximum)) throw new Error(`${label}.${name} 越界`);
  }
}

export function validatePersonaProfile(value) {
  if (!hasExactKeys(value, PROFILE_KEYS)) throw new Error("PersonaProfile 字段非法");
  if (value.schemaVersion !== 1 || !isText(value.id, 64)) throw new Error("PersonaProfile 标识非法");
  assertNumberMap(value.traits, TRAIT_NAMES, 0, 100, "traits");
  if (!Array.isArray(value.values) || value.values.length !== 3 || new Set(value.values).size !== 3
    || value.values.some((item) => !VALUE_NAMES.includes(item))) throw new Error("PersonaProfile values 非法");
  for (const field of ["desire", "fear", "contradiction", "speechStyle"]) {
    if (!isText(value[field])) throw new Error(`PersonaProfile ${field} 非法`);
  }
  if (!Array.isArray(value.habits) || value.habits.length !== 2 || value.habits.some((item) => !isText(item, 80))) {
    throw new Error("PersonaProfile habits 非法");
  }
  if (!hasExactKeys(value.mood, MOOD_KEYS) || !isInteger(value.mood.valence, -100, 100)
    || !isInteger(value.mood.arousal, 0, 100)) throw new Error("PersonaProfile mood 非法");
  assertNumberMap(value.needs, NEED_NAMES, 0, 100, "needs");
  return structuredClone(value);
}

function validateIntent(intent) {
  if (!hasExactKeys(intent, INTENT_KEYS) || intent.schemaVersion !== 1 || intent.intentType !== "move") {
    throw new Error("Persona dilemma Intent 非法");
  }
  if (!hasExactKeys(intent.payload, PAYLOAD_KEYS)
    || !isInteger(intent.payload.dx, -1, 1) || !isInteger(intent.payload.dy, -1, 1)
    || (intent.payload.dx === 0 && intent.payload.dy === 0)) throw new Error("Persona dilemma 移动非法");
  if (!isInteger(intent.budget, 1, 100) || !isText(intent.reasonCode, 40)
    || !/^[a-z][a-z0-9_]*$/.test(intent.reasonCode)) throw new Error("Persona dilemma Intent 元数据非法");
}

export function validateDilemma(value) {
  if (!hasExactKeys(value, DILEMMA_KEYS) || value.schemaVersion !== 1 || !isText(value.id, 40)
    || !isText(value.title) || !isText(value.playerSuggestionId, 64)) throw new Error("Persona dilemma 字段非法");
  if (!Array.isArray(value.options) || value.options.length < 8 || value.options.length > 16) {
    throw new Error("Persona dilemma 选项数量非法");
  }
  const ids = new Set();
  for (const option of value.options) {
    if (!hasExactKeys(option, OPTION_KEYS) || !isText(option.id, 64) || !isText(option.label)) {
      throw new Error("Persona dilemma option 字段非法");
    }
    if (ids.has(option.id)) throw new Error("Persona dilemma option 重复");
    ids.add(option.id);
    validateIntent(option.intent);
    assertNumberMap(option.traitVector, TRAIT_NAMES, 0, 100, "traitVector");
    if (!Array.isArray(option.values) || option.values.length === 0 || option.values.length > 3
      || option.values.some((item) => !VALUE_NAMES.includes(item))) throw new Error("Persona dilemma option values 非法");
    if (!NEED_NAMES.includes(option.need) || !isInteger(option.moodAxis, -1, 1)) {
      throw new Error("Persona dilemma option 状态因素非法");
    }
    if (!isInteger(option.contextWeight, -60, 60)) throw new Error("Persona dilemma option 情境权重非法");
    if (!Array.isArray(option.motifs) || option.motifs.length < 2 || option.motifs.length > 8
      || new Set(option.motifs).size !== option.motifs.length
      || option.motifs.some((item) => !isText(item, 20))) throw new Error("Persona dilemma option 叙事动机非法");
  }
  if (!ids.has(value.playerSuggestionId)) throw new Error("Persona dilemma 玩家建议不存在");
  return structuredClone(value);
}

export function personaFactorPaths(profile) {
  const valid = new Set([
    ...TRAIT_NAMES.map((name) => `traits.${name}`),
    ...profile.values.map((_, index) => `values.${index}`),
    "desire",
    "fear",
    "contradiction",
    ...profile.habits.map((_, index) => `habits.${index}`),
    "speechStyle",
    "mood.valence",
    "mood.arousal",
    ...NEED_NAMES.map((name) => `needs.${name}`),
    "dilemma.contextWeight",
    "playerSuggestion",
  ]);
  return valid;
}

export function validatePersonaDecision(decision, rawProfile, rawDilemma) {
  const profile = validatePersonaProfile(rawProfile);
  let dilemma;
  try { dilemma = validateDilemma(rawDilemma); } catch { return { ok: false, reason: "dilemma_reference" }; }
  if (!hasExactKeys(decision, DECISION_KEYS) || decision.schemaVersion !== 1 || decision.profileId !== profile.id
    || decision.dilemmaId !== dilemma.id || !Array.isArray(decision.candidates)
    || decision.candidates.length === 0 || decision.candidates.length > 3) return { ok: false, reason: "decision_shape" };
  const paths = personaFactorPaths(profile);
  for (const candidate of decision.candidates) {
    if (!hasExactKeys(candidate, CANDIDATE_KEYS) || candidate.schemaVersion !== 1
      || !isText(candidate.strategyId, 64) || !isText(candidate.label)
      || !Number.isFinite(candidate.utility) || typeof candidate.acceptedPlayerSuggestion !== "boolean"
      || candidate.voice !== profile.speechStyle
      || !Array.isArray(candidate.factors) || candidate.factors.length === 0) return { ok: false, reason: "candidate_shape" };
    try { validateIntent(candidate.intent); } catch { return { ok: false, reason: "candidate_intent" }; }
    const option = dilemma.options.find((item) => item.id === candidate.strategyId);
    if (!option || candidate.factors.some((factor) => !hasExactKeys(factor, FACTOR_KEYS) || !paths.has(factor.path)
      || !Number.isFinite(factor.contribution) || !isText(String(factor.value), 160)
      || !factorValueMatches(profile, option, factor))) {
      return { ok: false, reason: "factor_reference" };
    }
    if (round(candidate.factors.reduce((sum, factor) => sum + factor.contribution, 0)) !== candidate.utility) {
      return { ok: false, reason: "utility_sum" };
    }
  }
  const expected = dilemma.options
    .map((option) => scorePersonaOption(profile, dilemma, option))
    .sort((left, right) => right.utility - left.utility || left.strategyId.localeCompare(right.strategyId))
    .slice(0, decision.candidates.length);
  if (JSON.stringify(decision.candidates) !== JSON.stringify(expected)) return { ok: false, reason: "decision_recompute" };
  return { ok: true, decision: structuredClone(decision) };
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

function motifMatches(text, motifs) {
  return motifs.filter((motif) => text.includes(motif)).length;
}

export function scorePersonaOption(profile, dilemma, option) {
  const factors = [];
  if (option.contextWeight) factors.push({ path: "dilemma.contextWeight", value: option.contextWeight, contribution: option.contextWeight });
  for (const trait of TRAIT_NAMES) {
    const distance = Math.abs(profile.traits[trait] - option.traitVector[trait]);
    factors.push({ path: `traits.${trait}`, value: profile.traits[trait], contribution: round((50 - distance) * 0.3) });
  }
  profile.values.forEach((value, index) => {
    const contribution = option.values.includes(value) ? 18 - (index * 4) : 0;
    if (contribution) factors.push({ path: `values.${index}`, value, contribution });
  });
  factors.push({ path: `needs.${option.need}`, value: profile.needs[option.need], contribution: round(profile.needs[option.need] * 0.22) });
  factors.push({ path: "mood.valence", value: profile.mood.valence, contribution: round((profile.mood.valence / 100) * option.moodAxis * 4) });
  factors.push({ path: "mood.arousal", value: profile.mood.arousal, contribution: round((profile.mood.arousal / 100) * 3) });
  for (const [path, text, weight] of [
    ["desire", profile.desire, 6],
    ["fear", profile.fear, -5],
    ["contradiction", profile.contradiction, 3],
  ]) {
    const contribution = motifMatches(text, option.motifs) * weight;
    if (contribution) factors.push({ path, value: text, contribution });
  }
  profile.habits.forEach((habit, index) => {
    const contribution = motifMatches(habit, option.motifs) * 2;
    if (contribution) factors.push({ path: `habits.${index}`, value: habit, contribution });
  });
  if (option.id === dilemma.playerSuggestionId) {
    factors.push({ path: "playerSuggestion", value: "可拒绝建议", contribution: round(10 - (profile.needs.autonomy * 0.28)) });
  }
  const nonZeroFactors = factors
    .filter((factor) => factor.contribution !== 0)
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution) || left.path.localeCompare(right.path));
  return {
    schemaVersion: 1,
    strategyId: option.id,
    label: option.label,
    intent: structuredClone(option.intent),
    utility: round(nonZeroFactors.reduce((sum, factor) => sum + factor.contribution, 0)),
    factors: nonZeroFactors,
    acceptedPlayerSuggestion: option.id === dilemma.playerSuggestionId,
    voice: profile.speechStyle,
  };
}

function factorValueMatches(profile, option, factor) {
  if (factor.path === "playerSuggestion") return factor.value === "可拒绝建议";
  if (factor.path === "dilemma.contextWeight") return factor.value === option.contextWeight;
  const [section, key] = factor.path.split(".");
  const expected = key === undefined ? profile[section] : profile[section]?.[key];
  return expected === factor.value;
}
