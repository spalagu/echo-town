import { MemoryGraph, validateAcquaintanceEdge, validateMemoryRecord } from "@echo-town/memory-graph";
import {
  DILEMMA_FIXTURES,
  PERSONA_FIXTURES,
  personaFactorPaths,
  rankIntentCandidates,
} from "@echo-town/persona-core";
import { PublicDiscourse } from "./discourse.js";
import {
  validateHistoricalSummary,
  validateDiscourseClaim,
  validateInitialStatePack,
  validatePlannerObservation,
  validateSituationSeed,
} from "./contracts.js";

const STRATEGY_AFFORDANCES = Object.freeze({
  explore: ["investigate", "observe", "compare", "listen", "search"],
  safeguard: ["conserve", "shelter", "care", "repair"],
  convene: ["share_claim", "welcome", "question", "mediate", "trade"],
  care: ["care", "welcome", "shelter", "conserve"],
  observe: ["observe", "compare", "count", "verify", "listen"],
  prototype: ["experiment", "prototype", "repair"],
  withdraw: ["withdraw", "ignore"],
  execute: ["repair", "care", "trade", "search", "reroute", "allocate"],
  mediate: ["mediate", "share_claim", "trade", "welcome"],
  precedent: ["verify", "observe", "conserve"],
  hypothesis: ["experiment", "investigate", "compare", "observe"],
  improvise: ["reroute", "experiment", "trade", "welcome"],
});

const ACTION_CATEGORY = Object.freeze({
  investigate: "investigate", observe: "investigate", compare: "investigate", listen: "investigate", search: "investigate", verify: "investigate", count: "investigate", question: "investigate",
  conserve: "conserve", shelter: "conserve", care: "conserve", withdraw: "withdraw", ignore: "withdraw",
  share_claim: "organize", welcome: "organize", mediate: "organize", trade: "organize",
  repair: "produce", prototype: "produce", reroute: "produce", allocate: "produce",
  experiment: "experiment",
});

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seedText) {
  let state = stableHash(seedText) || 1;
  return {
    integer(maximum) {
      if (!Number.isInteger(maximum) || maximum < 1) throw new Error("随机上界非法");
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
      return state % maximum;
    },
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function factorValueMatchesProfile(profile, factor) {
  if (factor.path === "playerSuggestion") return factor.value === "可拒绝建议";
  if (factor.path === "dilemma.contextWeight") return Number.isInteger(factor.value) && factor.value >= -60 && factor.value <= 60;
  const [section, key] = factor.path.split(".");
  return (key === undefined ? profile[section] : profile[section]?.[key]) === factor.value;
}

function strategyName(strategyId) {
  return strategyId.split("_").at(-1);
}

function visibleToActor(event, actorId) {
  return event.audienceActorIds.length === 0 || event.audienceActorIds.includes(actorId);
}

function localAudience(actors, coordinate) {
  const selected = actors.filter((actor) => stableHash(`${coordinate}:${actor.id}`) % 2 === 0).map((actor) => actor.id);
  if (selected.length === 0) return [actors[stableHash(coordinate) % actors.length].id];
  if (selected.length === actors.length) return selected.slice(0, -1);
  return selected;
}

function chooseAffordance(strategy, allowedAffordances, contextText) {
  const preferred = STRATEGY_AFFORDANCES[strategy] ?? [];
  const matches = preferred.filter((action) => allowedAffordances.includes(action));
  const pool = matches.length ? matches : allowedAffordances;
  return pool[stableHash(`${strategy}:${contextText}`) % pool.length];
}

function contextualDilemma({ base, initialState, situation, actor, visibleObservations, memories, visibleClaims, relationships, resourceSignals, roundIndex, allowedAffordances }) {
  const tensionSignal = initialState.tensions.reduce((sum, item) => sum + item.pressure - item.uncertainty, 0);
  const contextText = [
    initialState.id,
    ...visibleObservations.flatMap((item) => [item.detail, item.salience ?? 50, ...item.tags]),
    ...memories.map((item) => item.summary),
    ...visibleClaims.map((item) => `${item.stance}:${item.statement}`),
    ...relationships.map((item) => `${item.otherActorId}:${item.trust}:${item.affinity}`),
    ...resourceSignals.map((item) => `${item.resourceId}:${item.level}`),
    situation.trigger.kind,
    situation.trigger.startTick,
    situation.trigger.durationTicks,
    situation.trigger.intensity,
    ...initialState.tensions.flatMap((item) => [item.id, item.resourceId, item.pressure, item.uncertainty]),
    ...allowedAffordances,
  ].join("|");
  const options = base.options.map((option) => {
    const strategy = strategyName(option.id);
    const action = chooseAffordance(strategy, allowedAffordances, contextText);
    const actionIndex = allowedAffordances.indexOf(action);
    const observationSignal = (stableHash(`${contextText}:${option.id}`) % 25) - 12;
    const feedbackSignal = clamp(memories.length * 2 + visibleClaims.length * 3 + relationships.length * 2, 0, 24);
    const scarcityWeight = resourceSignals.filter((item) => item.level < 20).length * 4;
    const tensionWeight = Math.round(tensionSignal / Math.max(8, initialState.tensions.length * 8)) + scarcityWeight;
    return {
      ...structuredClone(option),
      id: `${situation.id}_${roundIndex}_${option.id}`.slice(0, 64),
      label: `${situation.title}：${action}（${actor.profile.id} 所见）`,
      contextWeight: clamp(observationSignal + feedbackSignal + tensionWeight + (actionIndex < 3 ? 10 : 0), -60, 60),
      motifs: [...new Set([...option.motifs, ...visibleObservations.flatMap((item) => item.tags)])].slice(0, 8),
    };
  });
  return {
    schemaVersion: 1,
    id: `${situation.id}_${roundIndex}_${actor.profile.id}`.slice(0, 40),
    title: `${situation.title}（第 ${roundIndex + 1} 轮）`,
    playerSuggestionId: options[stableHash(`${actor.id}:${contextText}`) % options.length].id,
    options,
  };
}

function memoryRecord({ id, actorId, kind = "public_event", summary, sourceEventIds, subjects, logicalTime, valence = 0, salience = 65 }) {
  return {
    id,
    ownerActorId: actorId,
    kind,
    summary,
    sourceEventIds,
    subjects,
    logicalTime,
    salience,
    emotionalValence: clamp(valence, -100, 100),
    confidence: 80,
    visibility: "public",
    consolidationParentIds: [],
    decayClass: "protected",
  };
}

function actionResourceDelta(action, intensity) {
  const category = ACTION_CATEGORY[action] ?? "experiment";
  if (category === "produce") return Math.max(1, Math.round(intensity / 12));
  if (category === "conserve") return Math.max(1, Math.round(intensity / 20));
  if (category === "organize") return Math.max(1, Math.round(intensity / 25));
  if (category === "experiment") return (intensity % 7) - 3;
  if (category === "withdraw") return -1;
  return 0;
}

function resourceLevel(state) {
  return Math.max(0, state.permanentQuantity + state.temporaryQuantity);
}

function summarize({ id, title, events, generatedAtTick }) {
  const counts = new Map();
  for (const event of events) counts.set(event.kind, (counts.get(event.kind) || 0) + 1);
  const value = {
    schemaVersion: 1,
    id,
    title,
    summary: [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([kind, count]) => `${kind} ${count} 次`).join("；"),
    sourceEventIds: events.map((event) => event.id),
    generatedAtTick,
    readOnly: true,
  };
  const validation = validateHistoricalSummary(value);
  if (!validation.ok) throw new Error(`HistoricalSummary 被拒绝：${validation.reason}`);
  return validation.value;
}

export function simulateSociety(rawInitialState, rawSituations, worldSeed) {
  const initialState = validateInitialStatePack(rawInitialState);
  if (!Array.isArray(rawSituations) || rawSituations.length === 0) throw new Error("社会模拟至少需要一个 SituationSeed");
  const situations = rawSituations.map((item, index) => validateSituationSeed(item, `situations[${index}]`));
  if (!Number.isInteger(worldSeed) || worldSeed < 0 || worldSeed > 1_000_000) throw new Error("world seed 非法");
  const resourceIds = new Set(initialState.resources.map((item) => item.id));
  for (const situation of situations) {
    for (const delta of situation.resourceDeltas) {
      if (!resourceIds.has(delta.resourceId)) throw new Error(`SituationSeed ${situation.id} 引用了未知资源 ${delta.resourceId}`);
    }
  }

  const random = seededRandom(`${initialState.id}:${worldSeed}`);
  const events = [];
  const discourse = new PublicDiscourse();
  const memory = new MemoryGraph();
  const actors = PERSONA_FIXTURES.map((profile) => ({ id: `${profile.id}-${worldSeed}`, profile }));
  const resources = new Map(initialState.resources.map((item) => [item.id, {
    permanentQuantity: item.quantity,
    temporaryQuantity: 0,
    initialRemaining: item.quantity,
    replenishesPerTick: item.replenishesPerTick,
    expiresAtTick: item.expiresAfterTicks || null,
    sourceEventIds: [],
  }]));
  const resourceLedger = [];
  const observationEvents = [];
  const startedSituations = new Set();
  let resourceClock = 0;

  const addEvent = (event) => {
    const sequenced = { ...event, sequence: events.length };
    events.push(sequenced);
    discourse.registerEvent(sequenced.id);
    return sequenced;
  };

  for (const resource of initialState.resources) {
    const event = addEvent({ id: `initial-${resource.id}-${worldSeed}`, kind: "resource_initialized", tick: 0, actorId: null, detail: `${resource.id}=${resource.quantity}`, sourceEventIds: [] });
    resources.get(resource.id).sourceEventIds.push(event.id);
  }

  for (const observation of initialState.observations) {
    const audienceActorIds = observation.visibility === "public"
      ? []
      : localAudience(actors, `${initialState.id}:${observation.id}`);
    const event = addEvent({
      id: `initial-observation-${observation.id}-${worldSeed}`, kind: "observation", tick: 0, actorId: null,
      detail: observation.fact, tags: initialState.places.find((place) => place.id === observation.placeId).tags,
      visibility: observation.visibility, salience: observation.salience, audienceActorIds, sourceEventIds: [],
    });
    observationEvents.push(event);
  }

  const situationEvents = new Map();

  for (const actor of actors) {
    for (const observation of observationEvents.filter((item) => item.tick === 0 && visibleToActor(item, actor.id))) {
      memory.remember(memoryRecord({
        id: `memory-${actor.id}-${observation.id}`, actorId: actor.id, kind: "event", summary: observation.detail,
        sourceEventIds: [observation.id], subjects: observation.tags, logicalTime: 0, salience: 70,
      }));
    }
  }

  const replenish = (targetTick) => {
    const elapsed = targetTick - resourceClock;
    if (elapsed <= 0) return;
    for (const [resourceId, state] of resources) {
      const amount = state.replenishesPerTick * elapsed;
      if (amount === 0) continue;
      state.permanentQuantity += amount;
      const event = addEvent({
        id: `replenish-${resourceId}-${resourceClock}-${targetTick}-${worldSeed}`, kind: "resource_replenished", tick: targetTick,
        actorId: null, detail: `${resourceId}+${amount}`, sourceEventIds: [state.sourceEventIds[0]],
      });
      state.sourceEventIds.push(event.id);
    }
    resourceClock = targetTick;
  };

  const settleDue = (targetTick) => {
    const dueTicks = new Set(resourceLedger.filter((entry) => entry.settledAtTick === null && entry.expiresAtTick <= targetTick).map((entry) => entry.expiresAtTick));
    for (const state of resources.values()) if (state.expiresAtTick !== null && state.expiresAtTick > resourceClock && state.expiresAtTick <= targetTick) dueTicks.add(state.expiresAtTick);
    for (const dueTick of [...dueTicks].sort((left, right) => left - right)) {
      replenish(dueTick);
      for (const [resourceId, state] of resources) {
        if (state.expiresAtTick !== dueTick) continue;
        const actualAppliedDelta = -Math.min(state.initialRemaining, Math.max(0, state.permanentQuantity));
        state.permanentQuantity += actualAppliedDelta;
        state.initialRemaining = 0;
        state.expiresAtTick = null;
        const event = addEvent({
          id: `natural-expire-${resourceId}-${dueTick}-${worldSeed}`, kind: "resource_naturally_expired", tick: dueTick,
          actorId: null, detail: `${resourceId}${actualAppliedDelta}`, actualAppliedDelta, sourceEventIds: [state.sourceEventIds[0]],
        });
        state.sourceEventIds.push(event.id);
        resourceLedger.push({
          id: `ledger-${event.id}`, kind: "natural-expiry", resourceId,
          declaredDelta: -initialState.resources.find((item) => item.id === resourceId).quantity,
          actualAppliedDelta, appliedAtTick: dueTick, expiresAtTick: dueTick, settledAtTick: dueTick,
          reversalAppliedDelta: 0, sourceEventId: state.sourceEventIds[0], expiryEventId: event.id,
        });
      }
      for (const entry of resourceLedger.filter((item) => item.kind === "temporary" && item.settledAtTick === null && item.expiresAtTick === dueTick)) {
        const state = resources.get(entry.resourceId);
        const reversalAppliedDelta = -entry.actualAppliedDelta;
        state.temporaryQuantity += reversalAppliedDelta;
        const event = addEvent({
          id: `expire-${entry.id}-${worldSeed}`, kind: "resource_expired", tick: dueTick, actorId: null,
          detail: `${entry.resourceId}${reversalAppliedDelta >= 0 ? "+" : ""}${reversalAppliedDelta}`,
          actualAppliedDelta: reversalAppliedDelta, sourceEventIds: [entry.sourceEventId],
        });
        entry.settledAtTick = dueTick;
        entry.reversalAppliedDelta = reversalAppliedDelta;
        entry.expiryEventId = event.id;
        state.sourceEventIds.push(event.id);
      }
    }
    replenish(targetTick);
  };

  const startSituation = (situation) => {
    if (startedSituations.has(situation.id)) return;
    startedSituations.add(situation.id);
    const situationEvent = addEvent({
      id: `situation-${situation.id}-${worldSeed}`, kind: "situation_started", tick: situation.trigger.startTick, actorId: null,
      detail: `${situation.title}；持续 ${situation.trigger.durationTicks} tick`, triggerKind: situation.trigger.kind,
      durationTicks: situation.trigger.durationTicks, sourceEventIds: [],
    });
    situationEvents.set(situation.id, situationEvent);
    situation.observations.forEach((observation, index) => {
      const audienceActorIds = observation.visibility === "public" ? [] : localAudience(actors, `${situation.id}:${index}`);
      observationEvents.push(addEvent({
        id: `situation-observation-${situation.id}-${index}-${worldSeed}`, kind: "observation", tick: situation.trigger.startTick, actorId: null,
        detail: observation.fact, tags: observation.tags, visibility: observation.visibility, salience: Math.round(situation.trigger.intensity), audienceActorIds,
        sourceEventIds: [situationEvent.id],
      }));
    });
    for (const [deltaIndex, delta] of situation.resourceDeltas.entries()) {
      const state = resources.get(delta.resourceId);
      const available = resourceLevel(state);
      const actualAppliedDelta = delta.amount < 0 ? -Math.min(available, Math.abs(delta.amount)) : delta.amount;
      state.temporaryQuantity += actualAppliedDelta;
      const event = addEvent({
        id: `delta-${situation.id}-${deltaIndex}-${worldSeed}`, kind: "resource_delta", tick: situation.trigger.startTick, actorId: null,
        detail: `${delta.resourceId}${actualAppliedDelta >= 0 ? "+" : ""}${actualAppliedDelta}`, declaredDelta: delta.amount,
        actualAppliedDelta, sourceEventIds: [situationEvent.id],
      });
      state.sourceEventIds.push(event.id);
      resourceLedger.push({
        id: `ledger-${situation.id}-${deltaIndex}`, kind: "temporary", resourceId: delta.resourceId,
        declaredDelta: delta.amount, actualAppliedDelta, appliedAtTick: situation.trigger.startTick,
        expiresAtTick: situation.trigger.startTick + delta.expiresAfterTicks, settledAtTick: null,
        reversalAppliedDelta: 0, sourceEventId: event.id, expiryEventId: null,
      });
    }
    for (const actor of actors) {
      for (const observation of observationEvents.filter((item) => item.tick === situation.trigger.startTick && visibleToActor(item, actor.id))) {
        memory.remember(memoryRecord({
          id: `memory-${actor.id}-${observation.id}`, actorId: actor.id, kind: "event", summary: observation.detail,
          sourceEventIds: [observation.id], subjects: observation.tags, logicalTime: situation.trigger.startTick,
          salience: 65 + Math.round(situation.trigger.intensity / 4),
        }));
      }
    }
  };

  const rounds = situations.flatMap((situation) => [
    { situation, phase: "start", tick: situation.trigger.startTick },
    { situation, phase: "response", tick: situation.trigger.startTick + Math.max(1, Math.floor(situation.trigger.durationTicks / 2)) },
  ]).sort((left, right) => left.tick - right.tick || left.situation.id.localeCompare(right.situation.id) || left.phase.localeCompare(right.phase));

  for (const [roundIndex, round] of rounds.entries()) {
    settleDue(round.tick);
    startSituation(round.situation);
    const shared = round.situation.actionAffordances.filter((item) => initialState.actionAffordances.includes(item));
    const allowedAffordances = shared.length ? shared : [...new Set([...initialState.actionAffordances, ...round.situation.actionAffordances])];
    for (const [actorIndex, actor] of actors.entries()) {
      const visibleObservations = observationEvents.filter((item) => item.tick <= round.tick && visibleToActor(item, actor.id));
      const recalled = memory.allMemories()
        .filter((item) => item.ownerActorId === actor.id && item.logicalTime <= round.tick)
        .sort((left, right) => left.logicalTime - right.logicalTime || left.id.localeCompare(right.id))
        .slice(-12);
      const visibleClaims = discourse.visibleTo(actor.id);
      const relationships = memory.snapshot().relationships.filter((item) => item.ownerActorId === actor.id);
      const resourceSignals = [...resources].map(([resourceId, state]) => ({ resourceId, level: resourceLevel(state) }));
      const base = DILEMMA_FIXTURES[(stableHash(`${round.situation.trigger.kind}:${round.phase}`) + actorIndex) % DILEMMA_FIXTURES.length];
      const dilemma = contextualDilemma({ base, initialState, situation: round.situation, actor, visibleObservations,
        memories: recalled, visibleClaims, relationships, resourceSignals, roundIndex, allowedAffordances });
      const decision = rankIntentCandidates(actor.profile, dilemma);
      const candidate = decision.candidates[random.integer(decision.candidates.length)];
      const strategy = strategyName(candidate.strategyId);
      const contextText = [...visibleObservations.map((item) => item.id), ...recalled.map((item) => item.id), ...visibleClaims.map((item) => item.id)].join("|");
      const decisionContextHash = stableHash(JSON.stringify({
        observations: visibleObservations.map((item) => [item.id, item.detail, item.salience, item.tags]),
        memories: recalled.map((item) => [item.id, item.summary]),
        claims: visibleClaims.map((item) => [item.id, item.stance, item.statement]),
        relationships,
        resources: resourceSignals,
        tensions: initialState.tensions,
        trigger: round.situation.trigger,
        allowedAffordances,
      }));
      const actionAffordance = chooseAffordance(strategy, allowedAffordances, contextText);
      const tension = initialState.tensions[stableHash(`${actor.id}:${round.situation.id}:${roundIndex}`) % initialState.tensions.length];
      const state = resources.get(tension.resourceId);
      const declaredDelta = actionResourceDelta(actionAffordance, round.situation.trigger.intensity);
      const resourceLevelBefore = resourceLevel(state);
      const actualAppliedDelta = declaredDelta < 0 ? -Math.min(resourceLevelBefore, Math.abs(declaredDelta)) : declaredDelta;
      state.permanentQuantity += actualAppliedDelta;
      if (actualAppliedDelta < 0) state.initialRemaining = Math.max(0, state.initialRemaining + actualAppliedDelta);
      const resourceLevelAfter = resourceLevel(state);
      const inputSourceEventIds = [...new Set([
        situationEvents.get(round.situation.id).id,
        ...visibleObservations.map((item) => item.id),
        ...recalled.flatMap((item) => item.sourceEventIds),
        ...visibleClaims.flatMap((item) => item.sourceEventIds),
      ])];
      const actionEvent = addEvent({
        id: `action-${roundIndex}-${actorIndex}-${worldSeed}`, kind: ACTION_CATEGORY[actionAffordance] ?? "experiment", tick: round.tick,
        actorId: actor.id, detail: `${actionAffordance}；${tension.resourceId}${actualAppliedDelta >= 0 ? "+" : ""}${actualAppliedDelta}；${candidate.label}`,
        actionAffordance, availableAffordances: allowedAffordances, situationId: round.situation.id, phase: round.phase,
        decisionContextHash, decisionStrategyId: candidate.strategyId,
        decisionUtility: candidate.utility, decisionFactors: structuredClone(candidate.factors),
        resourceId: tension.resourceId, declaredResourceDelta: declaredDelta, actualResourceDelta: actualAppliedDelta,
        resourceLevelBefore, resourceLevelAfter,
        memoryInputIds: recalled.map((item) => item.id), claimInputIds: visibleClaims.map((item) => item.id),
        observationEventIds: visibleObservations.map((item) => item.id), sourceEventIds: inputSourceEventIds,
      });
      state.sourceEventIds.push(actionEvent.id);
      const actionMemory = memory.remember(memoryRecord({
        id: `memory-${actionEvent.id}`, actorId: actor.id, summary: `${actionEvent.kind}：${actionEvent.detail}`,
        sourceEventIds: [actionEvent.id], subjects: [tension.resourceId, round.situation.id], logicalTime: round.tick,
        valence: actualAppliedDelta * 5,
      }));

      const parentPool = discourse.visibleTo(actor.id);
      const parent = parentPool.length && random.integer(3) !== 0 ? parentPool[random.integer(parentPool.length)] : null;
      const stance = parent && random.integer(2) === 0 ? "oppose" : (["investigate", "experiment"].includes(actionEvent.kind) ? "uncertain" : "support");
      let audienceActorIds = actors.filter((item) => item.id !== actor.id && stableHash(`${actionEvent.id}:${item.id}`) % 3 !== 0).slice(0, 8).map((item) => item.id);
      if (audienceActorIds.length === 0) audienceActorIds = [actors[(actorIndex + 1) % actors.length].id];
      discourse.publish({
        schemaVersion: 1, id: `claim-${roundIndex}-${actorIndex}-${worldSeed}`, speakerActorId: actor.id, stance,
        statement: `${actor.profile.id} 根据所见、记忆与可见说法选择 ${actionAffordance}`, sourceEventIds: [actionEvent.id],
        audienceActorIds, parentClaimId: parent?.id ?? null, refutesClaimId: stance === "oppose" ? parent?.id ?? null : null,
        logicalTime: round.tick,
      });

      const otherSpeaker = parent && parent.speakerActorId !== actor.id ? parent.speakerActorId : null;
      if (otherSpeaker && ["organize", "conserve"].includes(actionEvent.kind)) {
        memory.observeAcquaintance({ actorIds: [actor.id, otherSpeaker], sourceEventId: actionEvent.id, logicalTime: round.tick });
        memory.updateRelationship({ ownerActorId: actor.id, otherActorId: otherSpeaker, sourceMemoryId: actionMemory.id,
          deltas: { trust: stance === "oppose" ? -1 : 1, affinity: stance === "oppose" ? -1 : 1 } });
      }
    }
  }

  const finalTick = Math.max(
    ...resourceLedger.filter((item) => item.kind === "temporary").map((item) => item.expiresAtTick),
    ...initialState.resources.map((item) => item.expiresAfterTicks),
    ...rounds.map((item) => item.tick),
  );
  settleDue(finalTick);
  memory.consolidate(finalTick);
  const claims = discourse.projection();
  const plannerObservations = actors.map((actor) => {
    const visibleClaims = discourse.visibleTo(actor.id);
    const visibleMemories = memory.allMemories().filter((item) => item.ownerActorId === actor.id).slice(-12);
    const value = {
      actorId: actor.id, tick: finalTick,
      visibleEventIds: events.filter((event) => event.actorId === actor.id
        || (event.actorId === null && (event.kind !== "observation" || visibleToActor(event, actor.id)))).slice(-64).map((event) => event.id),
      memoryIds: visibleMemories.map((item) => item.id), claimIds: visibleClaims.slice(-24).map((claim) => claim.id),
      resourceSignals: [...resources].map(([resourceId, state]) => ({ resourceId, level: resourceLevel(state), trend: resourceLevel(state) < 20 ? "falling" : "stable" })),
      situationTags: [...new Set(observationEvents.filter((item) => visibleToActor(item, actor.id)).flatMap((item) => item.tags))].slice(0, 16),
    };
    const validation = validatePlannerObservation(value);
    if (!validation.ok) throw new Error(`PlannerObservation 被拒绝：${validation.reason}`);
    return validation.value;
  });
  const historicalSummary = summarize({ id: `summary-${initialState.id}-${worldSeed}`, title: `${initialState.title} 事后摘要`, events, generatedAtTick: finalTick });
  const result = {
    initialStateId: initialState.id, worldSeed, events, claims, memories: memory.allMemories(), acquaintances: memory.publicProjection(),
    resources: [...resources].map(([id, state]) => ({ id, quantity: resourceLevel(state), sourceEventIds: state.sourceEventIds })),
    resourceLedger, plannerObservations, historicalSummary,
    pendingTemporaryResources: resourceLedger.filter((item) => item.kind === "temporary" && item.settledAtTick === null).length,
  };
  result.trajectorySignature = trajectorySignature(result);
  const validation = validateSimulationResult(result, initialState, situations);
  if (!validation.ok) throw new Error(`社会模拟不变量失败：${validation.reason}`);
  return result;
}

export function validateSimulationResult(result, rawInitialState, rawSituations) {
  let initialState;
  let situations;
  try {
    initialState = validateInitialStatePack(rawInitialState);
    situations = rawSituations.map((item, index) => validateSituationSeed(item, `situations[${index}]`));
  } catch (error) {
    return { ok: false, reason: `input:${error.message}` };
  }
  const eventIds = new Set(result?.events?.map((item) => item.id));
  const eventsById = new Map(result?.events?.map((item) => [item.id, item]));
  const claims = new Map(result?.claims?.map((item) => [item.id, item]));
  const memories = new Map(result?.memories?.map((item) => [item.id, item]));
  if (!Array.isArray(result?.events) || eventIds.size !== result.events.length
    || result.events.some((event, index) => event.sequence !== index || (index > 0 && result.events[index - 1].tick > event.tick)
      || event.sourceEventIds.some((sourceId) => !eventsById.has(sourceId) || eventsById.get(sourceId).sequence >= event.sequence))) {
    return { ok: false, reason: "event_causal_replay" };
  }
  const claimIndexes = new Map(result?.claims?.map((item, index) => [item.id, index]));
  if (!Array.isArray(result?.claims) || claims.size !== result.claims.length || result.claims.some((claim, index) => {
    const parentIndex = claim.parentClaimId === null ? -1 : claimIndexes.get(claim.parentClaimId);
    const refuteIndex = claim.refutesClaimId === null ? -1 : claimIndexes.get(claim.refutesClaimId);
    return !validateDiscourseClaim(claim).ok
      || (index > 0 && result.claims[index - 1].logicalTime > claim.logicalTime)
      || (claim.parentClaimId !== null && (!Number.isInteger(parentIndex) || parentIndex >= index))
      || (claim.refutesClaimId !== null && (!Number.isInteger(refuteIndex) || refuteIndex >= index))
      || claim.sourceEventIds.some((id) => !eventsById.has(id) || eventsById.get(id).tick > claim.logicalTime);
  })) return { ok: false, reason: "claim_causal_replay" };
  if (!Array.isArray(result?.memories) || result.memories.some((item) => !validateMemoryRecord(item).ok
    || item.sourceEventIds.some((id) => !eventsById.has(id) || eventsById.get(id).tick > item.logicalTime))) {
    return { ok: false, reason: "memory_provenance" };
  }
  if (!Array.isArray(result?.acquaintances) || result.acquaintances.some((item) => {
    const source = eventsById.get(item.sourceEventId);
    return !validateAcquaintanceEdge(item).ok || !source || source.tick > item.logicalTime || !item.actorIds.includes(source.actorId);
  })) return { ok: false, reason: "relationship_provenance" };
  if (!Array.isArray(result?.resources) || result.resources.some((item) => item.sourceEventIds.length === 0
    || item.sourceEventIds.some((id) => !eventsById.has(id)))) return { ok: false, reason: "resource_provenance" };
  if (!validateHistoricalSummary(result?.historicalSummary).ok
    || JSON.stringify(result.historicalSummary.sourceEventIds) !== JSON.stringify(result.events.map((item) => item.id))) {
    return { ok: false, reason: "summary_provenance" };
  }
  if (!Array.isArray(result?.plannerObservations) || result.plannerObservations.some((observation) => {
    if (!validatePlannerObservation(observation).ok) return true;
    const visibleEventFailure = observation.visibleEventIds.some((id) => {
      const event = eventsById.get(id);
      return !event || event.tick > observation.tick || !(event.actorId === null || event.actorId === observation.actorId)
        || (event.kind === "observation" && !visibleToActor(event, observation.actorId));
    });
    const memoryFailure = observation.memoryIds.some((id) => {
      const item = memories.get(id);
      return !item || item.ownerActorId !== observation.actorId || item.logicalTime > observation.tick;
    });
    const claimFailure = observation.claimIds.some((id) => {
      const item = claims.get(id);
      return !item || item.logicalTime > observation.tick || !(item.audienceActorIds.length === 0
        || item.audienceActorIds.includes(observation.actorId) || item.speakerActorId === observation.actorId);
    });
    return visibleEventFailure || memoryFailure || claimFailure;
  })) return { ok: false, reason: "planner_projection_provenance" };
  const actionEvents = result?.events?.filter((item) => typeof item.actionAffordance === "string") ?? [];
  if (actionEvents.length < PERSONA_FIXTURES.length * 2) return { ok: false, reason: "feedback_rounds" };
  if (!actionEvents.some((item) => item.memoryInputIds?.some((id) => memories.get(id)?.sourceEventIds.some((sourceId) => eventsById.get(sourceId)?.actionAffordance)))) {
    return { ok: false, reason: "memory_feedback_missing" };
  }
  if (!actionEvents.some((item) => item.claimInputIds?.length > 0)) return { ok: false, reason: "discourse_feedback_missing" };
  for (const event of actionEvents) {
    const situation = situations.find((item) => item.id === event.situationId);
    const profile = PERSONA_FIXTURES.find((item) => `${item.id}-${result.worldSeed}` === event.actorId);
    if (!situation || !Array.isArray(event.availableAffordances) || !event.availableAffordances.includes(event.actionAffordance)) return { ok: false, reason: "affordance_bypass" };
    const shared = situation.actionAffordances.filter((item) => initialState.actionAffordances.includes(item));
    const expected = shared.length ? shared : [...new Set([...initialState.actionAffordances, ...situation.actionAffordances])];
    if (JSON.stringify(event.availableAffordances) !== JSON.stringify(expected)) return { ok: false, reason: "affordance_context_ignored" };
    if (!profile || !Number.isInteger(event.decisionContextHash)
      || typeof event.decisionStrategyId !== "string" || event.decisionStrategyId.length === 0 || event.decisionStrategyId.length > 64
      || !Number.isFinite(event.decisionUtility) || !Array.isArray(event.decisionFactors) || event.decisionFactors.length === 0
      || event.decisionFactors.some((factor) => !factor || typeof factor !== "object" || Array.isArray(factor)
        || Object.keys(factor).length !== 3 || !Object.hasOwn(factor, "path") || !Object.hasOwn(factor, "value")
        || !Object.hasOwn(factor, "contribution") || !personaFactorPaths(profile).has(factor.path)
        || !Number.isFinite(factor.contribution) || String(factor.value).length === 0 || String(factor.value).length > 160
        || !factorValueMatchesProfile(profile, factor))
      || Math.round(event.decisionFactors.reduce((sum, factor) => sum + factor.contribution, 0) * 1_000) / 1_000 !== event.decisionUtility
      || !initialState.resources.some((item) => item.id === event.resourceId)
      || !Number.isInteger(event.resourceLevelBefore) || event.resourceLevelBefore < 0
      || !Number.isInteger(event.resourceLevelAfter) || event.resourceLevelAfter < 0
      || !Number.isInteger(event.actualResourceDelta)
      || (event.actualResourceDelta < 0 && Math.abs(event.actualResourceDelta) > event.resourceLevelBefore)
      || !Array.isArray(event.memoryInputIds) || !Array.isArray(event.claimInputIds) || !Array.isArray(event.observationEventIds)
      || event.observationEventIds.length === 0 || event.sourceEventIds.some((id) => !eventIds.has(id))) return { ok: false, reason: "action_provenance" };
    if (event.memoryInputIds.some((id) => {
      const item = memories.get(id);
      return !item || item.ownerActorId !== event.actorId || item.logicalTime > event.tick;
    })) return { ok: false, reason: "memory_visibility_bypass" };
    if (event.claimInputIds.some((id) => {
      const item = claims.get(id);
      return !item || item.logicalTime > event.tick || !(item.audienceActorIds.length === 0
        || item.audienceActorIds.includes(event.actorId) || item.speakerActorId === event.actorId);
    })) return { ok: false, reason: "claim_visibility_bypass" };
    if (event.observationEventIds.some((id) => {
      const item = eventsById.get(id);
      return !item || item.kind !== "observation" || item.tick > event.tick || !visibleToActor(item, event.actorId);
    })) return { ok: false, reason: "observation_visibility_bypass" };
  }
  for (const claim of result?.claims ?? []) {
    const parent = claim.parentClaimId === null ? null : claims.get(claim.parentClaimId);
    if (claim.parentClaimId !== null && (!parent || !(parent.audienceActorIds.length === 0
      || parent.audienceActorIds.includes(claim.speakerActorId) || parent.speakerActorId === claim.speakerActorId))) return { ok: false, reason: "audience_bypass" };
    if (claim.sourceEventIds.some((id) => !eventIds.has(id))) return { ok: false, reason: "claim_provenance" };
  }
  const temporary = result?.resourceLedger?.filter((item) => item.kind === "temporary") ?? [];
  if (!Array.isArray(result?.resourceLedger) || temporary.length === 0 || result.resourceLedger.some((item) => {
    const source = eventsById.get(item.sourceEventId);
    const expiry = eventsById.get(item.expiryEventId);
    return !initialState.resources.some((resource) => resource.id === item.resourceId)
      || !source || !expiry || source.tick > item.appliedAtTick || expiry.tick !== item.expiresAtTick
      || (item.kind === "temporary" && (!expiry.sourceEventIds.includes(item.sourceEventId)
        || item.settledAtTick !== item.expiresAtTick || item.reversalAppliedDelta !== -item.actualAppliedDelta));
  })) return { ok: false, reason: "resource_recovery" };
  const expiringResources = initialState.resources.filter((item) => item.expiresAfterTicks > 0);
  if (expiringResources.some((resource) => !result.events.some((event) => event.kind === "resource_naturally_expired"
    && event.tick === resource.expiresAfterTicks && event.detail.startsWith(resource.id)))) return { ok: false, reason: "natural_expiry" };
  const replenishingResources = initialState.resources.filter((item) => item.replenishesPerTick > 0);
  if (replenishingResources.some((resource) => !result.events.some((event) => event.kind === "resource_replenished" && event.detail.startsWith(resource.id)))) return { ok: false, reason: "resource_replenishment" };
  const pending = temporary.filter((item) => item.settledAtTick === null).length;
  if (result.pendingTemporaryResources !== pending || pending !== 0) return { ok: false, reason: "pending_resource_ledger" };
  if (!result.historicalSummary?.readOnly || result.plannerObservations.some((item) => JSON.stringify(item).includes(result.historicalSummary.id))) return { ok: false, reason: "summary_feedback" };
  return { ok: true };
}

export function trajectorySignature(result) {
  const shareBand = (value, total) => {
    const share = total === 0 ? 0 : value / total;
    return share === 0 ? "none" : share < 0.35 ? "minority" : share < 0.45 ? "contested" : share < 0.55 ? "plurality" : "dominant";
  };
  const kinds = new Map();
  for (const event of result.events) kinds.set(event.kind, (kinds.get(event.kind) || 0) + 1);
  const stances = new Map();
  for (const claim of result.claims) stances.set(claim.stance, (stances.get(claim.stance) || 0) + 1);
  const actionOrder = ["investigate", "conserve", "organize", "produce", "withdraw", "experiment"]
    .sort((left, right) => (kinds.get(right) || 0) - (kinds.get(left) || 0) || left.localeCompare(right));
  const resourceTotal = result.resources.reduce((sum, item) => sum + item.quantity, 0);
  const resourceBand = resourceTotal < 400 ? "strained" : resourceTotal < 440 ? "balanced" : resourceTotal < 460 ? "ample" : "surplus";
  const relationshipBand = result.acquaintances.length < 30 ? "sparse" : result.acquaintances.length < 34
    ? "forming" : result.acquaintances.length < 38 ? "connected" : "woven";
  return [actionOrder[0], actionOrder[1], shareBand(stances.get("support") || 0, result.claims.length),
    shareBand(stances.get("oppose") || 0, result.claims.length), relationshipBand, resourceBand].join(":");
}
