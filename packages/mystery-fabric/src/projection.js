import { MYSTERY_HIDDEN_KEYS, validateMysterySeed } from "./contracts.js";

const PROJECTION_KEYS = new Set(["schemaVersion", "mysteryId", "title", "visibleClues", "artifacts", "actionAffordances"]);
const CLUE_KEYS = new Set(["id", "sourceEventId", "observedPhenomenon", "subjects", "reliabilityHint"]);
const ARTIFACT_KEYS = new Set(["itemId", "observableActions", "feedbackClass"]);

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function stringList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

export function projectMysteryForLocalMind(rawMystery, visibleClueIds) {
  const mystery = validateMysterySeed(rawMystery);
  if (!Array.isArray(visibleClueIds) || new Set(visibleClueIds).size !== visibleClueIds.length
    || visibleClueIds.some((id) => !mystery.clueFragments.some((clue) => clue.id === id))) {
    throw new Error("Local Mind 可见线索集合含重复或未知引用");
  }
  const visible = new Set(visibleClueIds);
  const clueOrder = new Map(visibleClueIds.map((id, index) => [id, index]));
  const projection = {
    schemaVersion: 1,
    mysteryId: mystery.id,
    title: mystery.title,
    visibleClues: mystery.clueFragments
      .filter((clue) => visible.has(clue.id))
      .sort((left, right) => clueOrder.get(left.id) - clueOrder.get(right.id))
      .map(({ id, sourceEventId, observedPhenomenon, subjects, reliabilityHint }) => ({
        id, sourceEventId, observedPhenomenon, subjects, reliabilityHint,
      })),
    artifacts: mystery.artifacts.map(({ itemId, observableActions, feedbackClass }) => ({ itemId, observableActions, feedbackClass })),
    actionAffordances: [...mystery.actionAffordances],
  };
  const validation = validateLocalMindMysteryProjection(projection);
  if (!validation.ok) throw new Error(`Local Mind 谜团投影被拒绝：${validation.reason}`);
  return validation.value;
}

export function assertNoHiddenMysteryFields(value, coordinate = "LocalMindProjection") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoHiddenMysteryFields(item, `${coordinate}[${index}]`));
    return true;
  }
  if (typeof value === "string") {
    const normalized = value.normalize("NFKC");
    if (MYSTERY_HIDDEN_KEYS.some((key) => normalized.includes(key))) throw new Error(`${coordinate} 的文本藏有 World Core 隐藏规则名`);
    return true;
  }
  if (!value || typeof value !== "object") return true;
  for (const [key, child] of Object.entries(value)) {
    if (MYSTERY_HIDDEN_KEYS.includes(key)) throw new Error(`${coordinate}.${key} 泄露 World Core 隐藏规则`);
    assertNoHiddenMysteryFields(child, `${coordinate}.${key}`);
  }
  return true;
}

export function validateLocalMindMysteryProjection(value) {
  if (!exactObject(value, PROJECTION_KEYS) || value.schemaVersion !== 1
    || typeof value.mysteryId !== "string" || typeof value.title !== "string"
    || !Array.isArray(value.visibleClues) || !Array.isArray(value.artifacts) || !stringList(value.actionAffordances)
    || !value.visibleClues.every((clue) => exactObject(clue, CLUE_KEYS) && typeof clue.id === "string"
      && typeof clue.sourceEventId === "string" && typeof clue.observedPhenomenon === "string"
      && stringList(clue.subjects) && ["unknown", "contested", "corroborated"].includes(clue.reliabilityHint))
    || !value.artifacts.every((artifact) => exactObject(artifact, ARTIFACT_KEYS) && typeof artifact.itemId === "string"
      && stringList(artifact.observableActions) && ["faint", "ambiguous", "resonant"].includes(artifact.feedbackClass))) {
    return { ok: false, reason: "local_mind_mystery_projection_contract" };
  }
  try { assertNoHiddenMysteryFields(value); } catch { return { ok: false, reason: "hidden_rule_leak" }; }
  return { ok: true, value: structuredClone(value) };
}
