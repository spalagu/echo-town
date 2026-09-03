import {
  validateExperimentIntent,
  validateMysterySeed,
  validateWorldContext,
  validateWorldEffectDecision,
} from "./contracts.js";

function includesAll(haystack, needles) {
  const values = new Set(haystack);
  return needles.every((needle) => values.has(needle));
}

// 这是 World Core 规则的无权威确定性镜像，只用于离线预演与测试；它不能生成 WorldEvent。
export class ExperimentRuleEvaluator {
  #mystery;
  #context;

  constructor(rawMystery, rawWorldSnapshot) {
    this.#mystery = validateMysterySeed(rawMystery);
    const context = validateWorldContext(rawWorldSnapshot);
    if (!context.ok) throw new Error(`世界快照被拒绝：${context.reason}`);
    this.#context = context.value;
  }

  evaluate(rawIntent) {
    const intent = validateExperimentIntent(rawIntent);
    if (!intent.ok) throw new Error(`实验意图被拒绝：${intent.reason}`);
    if (intent.value.mysteryId !== this.#mystery.id) throw new Error("实验意图引用了错误的谜团");
    const artifact = this.#mystery.artifacts.find((item) => item.itemId === intent.value.artifactId);
    if (!artifact || !artifact.observableActions.includes(intent.value.action)) throw new Error("实验动作不在物品可观察交互边界内");
    if (!includesAll(this.#context.acceptedEventIds, intent.value.sourceEventIds)) throw new Error("实验引用了未被世界快照接纳的事件");
    if (!this.#context.witnessActorIds.includes(intent.value.actorId)) throw new Error("实验见证列表必须包含行动者");
    const clueSources = new Map(this.#mystery.clueFragments.map((clue) => [clue.id, clue.sourceEventId]));
    const rule = artifact.conditionRules.find((candidate) => candidate.acceptedActions.includes(intent.value.action)
      && includesAll(this.#context.observedFragmentIds, candidate.observedFragmentIds)
      && candidate.observedFragmentIds.every((fragmentId) => intent.value.sourceEventIds.includes(clueSources.get(fragmentId)))
      && includesAll(this.#context.worldSignals, candidate.worldSignals)
      && this.#context.witnessActorIds.length >= candidate.minimumWitnesses);
    const effect = rule ? artifact.boundedEffects.find((candidate) => candidate.pathId === rule.pathId) : null;
    const decision = {
      schemaVersion: 1,
      mysteryId: this.#mystery.id,
      artifactId: artifact.itemId,
      sourceEventIds: [...intent.value.sourceEventIds],
      effectId: effect?.id ?? null,
      effectKind: effect?.kind ?? null,
      magnitude: effect?.magnitude ?? null,
      durationTicks: effect?.durationTicks ?? null,
      feedbackClass: effect ? artifact.feedbackClass : "faint",
    };
    const validation = validateWorldEffectDecision(decision);
    if (!validation.ok) throw new Error(`效果预演被拒绝：${validation.reason}`);
    return validation.value;
  }
}
