const WORLD_ID = "echo-town-local";
const ZONE_ID = "center";
const MUTATIONS = new Set(["clock", "observation", "mind", "core", "memory-relationship", "scene"]);
const PLACE_GRID = [
  { id: "old-clocktower", x: -14, y: -6, tags: ["curiosity"] },
  { id: "glass-greenhouse", x: 11, y: -6, tags: ["rest"] },
  { id: "echo-post-office", x: -10, y: 5, tags: ["belonging"] },
  { id: "river-market", x: 8, y: 5, tags: ["social"] },
];

function clone(value) {
  return structuredClone(value);
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function signIntent(identity, unsigned) {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(identity.privateKey),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(JSON.stringify(unsigned)));
  return { ...unsigned, signatureHex: bytesToHex(signature) };
}

function nearestPlace(position) {
  return [...PLACE_GRID].sort((left, right) => {
    const leftDistance = Math.abs(position.x - left.x) + Math.abs(position.y - left.y);
    const rightDistance = Math.abs(position.x - right.x) + Math.abs(position.y - right.y);
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  })[0];
}

function safeObservationRecord(observation) {
  return {
    logicalTime: observation.logicalTime,
    position: clone(observation.position),
    memorySourceEventIds: [...new Set(observation.recalledMemories.flatMap((memory) => memory.sourceEventIds))],
    relationshipActorIds: observation.relationshipSignals.map((relationship) => relationship.otherActorId),
  };
}

export function localMutationMode(locationObject = globalThis.location, requested = globalThis.__ECHO_TOWN_TEST_MUTATION__) {
  if (!locationObject || !["localhost", "127.0.0.1"].includes(locationObject.hostname)) return null;
  return MUTATIONS.has(requested) ? requested : null;
}

export class AutonomousLifeRuntime {
  constructor({
    identity,
    publicKeyHex,
    worldCore,
    localMind,
    personaProfile,
    dilemmas,
    memoryGraph,
    memoryStore,
    relationshipActorId,
    projectEvent,
    onCycle = () => {},
    onDecision = () => {},
    mutation = null,
    initialDelayMs = 0,
    intervalMs = 1_500,
    now = () => performance.now(),
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancel = (timer) => clearTimeout(timer),
  }) {
    this.identity = identity;
    this.publicKeyHex = publicKeyHex;
    this.worldCore = worldCore;
    this.localMind = localMind;
    this.personaProfile = personaProfile;
    this.dilemmas = dilemmas;
    this.memoryGraph = memoryGraph;
    this.memoryStore = memoryStore;
    this.relationshipActorId = relationshipActorId;
    this.projectEvent = projectEvent;
    this.onCycle = onCycle;
    this.onDecision = onDecision;
    this.mutation = MUTATIONS.has(mutation) ? mutation : null;
    this.initialDelayMs = initialDelayMs;
    this.intervalMs = intervalMs;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.sessionId = crypto.randomUUID();
    this.running = false;
    this.timer = null;
    this.inFlight = 0;
    this.maxConcurrent = 0;
    this.cycles = [];
    this.events = [];
    this.nextCycleId = 1;
    this.status = "stopped";
  }

  snapshot() {
    return clone({
      schemaVersion: 1,
      status: this.status,
      mutation: this.mutation,
      inFlight: this.inFlight,
      maxConcurrent: this.maxConcurrent,
      directControl: false,
      cycles: this.cycles,
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (this.mutation === "clock") {
      this.status = "broken-clock";
      return;
    }
    this.status = "idle";
    this.queue(this.initialDelayMs);
  }

  stop() {
    this.running = false;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.status = "stopped";
  }

  queue(delay) {
    if (!this.running || this.timer !== null) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.runCycle();
    }, delay);
  }

  worldState() {
    return JSON.parse(this.worldCore.snapshot());
  }

  buildObservation(state) {
    const actor = state.actors[this.identity.actorId];
    if (!actor) throw new Error("World Core 缺少当前角色");
    const relationship = this.memoryGraph.relationship(this.identity.actorId, this.relationshipActorId);
    const recalled = this.memoryGraph.retrieve({
      text: "回声镇 自主生活 关系 地点",
      subjectIds: [this.identity.actorId],
      relatedActorIds: [this.relationshipActorId],
      goalKinds: ["event", "relationship"],
      logicalTime: state.logicalTime,
    });
    return {
      actorId: this.identity.actorId,
      logicalTime: state.logicalTime,
      position: { x: actor.x, y: actor.y },
      nearbyPlaces: PLACE_GRID.map((place) => ({
        id: place.id,
        dx: Math.max(-100, Math.min(100, place.x - actor.x)),
        dy: Math.max(-100, Math.min(100, place.y - actor.y)),
        tags: [...place.tags],
      })),
      needs: [
        { kind: "social", level: 62 + (state.logicalTime % 17) },
        { kind: "curiosity", level: 78 - (state.logicalTime % 13) },
        { kind: "autonomy", level: 54 + (state.logicalTime % 11) },
      ],
      visibleEvents: this.events.slice(-24).map((event) => ({
        eventType: event.eventType,
        actorId: event.actorId,
        placeId: event.placeId,
        logicalTime: event.logicalTime,
      })),
      recalledMemories: recalled.map(({ record, effectiveConfidence }) => ({
        id: record.id,
        kind: record.kind,
        sourceEventIds: [...record.sourceEventIds],
        logicalTime: record.logicalTime,
        effectiveConfidence,
      })),
      relationshipSignals: relationship ? [{
        otherActorId: relationship.otherActorId,
        familiarity: relationship.familiarity,
        trust: relationship.trust,
        affinity: relationship.affinity,
        respect: relationship.respect,
        fear: relationship.fear,
        intimacy: relationship.intimacy,
      }] : [],
    };
  }

  async applyMemoryAndRelationship(event, logicalTime, cycleId) {
    const sourceEventId = event.acceptedIntentHash;
    const memoryId = `life-${this.sessionId}-${cycleId}`;
    this.memoryGraph.observeAcquaintance({
      actorIds: [this.identity.actorId, this.relationshipActorId],
      sourceEventId,
      logicalTime,
    });
    this.memoryGraph.remember({
      id: memoryId,
      ownerActorId: this.identity.actorId,
      kind: "event",
      summary: `${this.personaProfile.id} 自主选择向 ${event.payload.dx},${event.payload.dy} 移动。`,
      sourceEventIds: [sourceEventId],
      subjects: [this.identity.actorId, this.relationshipActorId],
      logicalTime,
      salience: 64,
      emotionalValence: 4,
      confidence: 100,
      visibility: "private",
      consolidationParentIds: [],
      decayClass: "ordinary",
    });
    this.memoryGraph.consolidate(logicalTime);
    this.memoryGraph.updateRelationship({
      ownerActorId: this.identity.actorId,
      otherActorId: this.relationshipActorId,
      sourceMemoryId: memoryId,
      deltas: { familiarity: 1, trust: cycleId % 3 === 0 ? 1 : 0, affinity: cycleId % 2 === 0 ? 1 : 0 },
    });
    await this.memoryStore.set(this.memoryGraph.snapshot());
    return {
      memoryRecordIds: [memoryId],
      relationshipChangeIds: [`relationship-${this.sessionId}-${cycleId}`],
    };
  }

  async runCycle() {
    if (!this.running || this.inFlight > 0) return;
    this.inFlight += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.inFlight);
    const cycle = {
      cycleId: this.nextCycleId++,
      startedAtMs: this.now(),
      completedAtMs: null,
      stage: "started",
      mindMode: null,
      intentId: null,
      acceptedEventId: null,
      beforeStateHash: null,
      afterStateHash: null,
      memoryRecordIds: [],
      relationshipChangeIds: [],
      projectedPosition: null,
      observation: null,
      decision: null,
      links: { clock: true, observation: false, mind: false, core: false, memoryRelationship: false, scene: false },
      error: null,
    };
    try {
      this.status = "collect-observation";
      if (this.mutation === "observation") throw new Error("mutation:observation");
      const beforeState = this.worldState();
      const observation = this.buildObservation(beforeState);
      cycle.links.observation = true;
      cycle.observation = safeObservationRecord(observation);

      this.status = "decide";
      if (this.mutation === "mind") throw new Error("mutation:mind");
      const dilemma = this.dilemmas[(beforeState.logicalTime + observation.recalledMemories.length) % this.dilemmas.length];
      const decision = await this.localMind.decide(observation, { personaProfile: this.personaProfile, dilemma });
      this.onDecision(decision);
      const proposal = decision.intents[0];
      cycle.links.mind = true;
      cycle.mindMode = decision.model;
      const personaChoice = decision.personaDecision?.candidates?.[0];
      cycle.decision = personaChoice ? {
        label: personaChoice.label,
        voice: personaChoice.voice,
        factors: personaChoice.factors.slice(0, 3).map((factor) => ({
          path: factor.path,
          value: factor.value,
          contribution: factor.contribution,
        })),
      } : { label: proposal.reasonCode, voice: "规则行动", factors: [] };

      this.status = "apply-intent";
      if (this.mutation === "core") throw new Error("mutation:core");
      const actor = beforeState.actors[this.identity.actorId];
      const unsigned = {
        schemaVersion: 1,
        worldId: WORLD_ID,
        zoneId: ZONE_ID,
        actorId: this.identity.actorId,
        seq: actor.lastSeq + 1,
        observedStateHash: this.worldCore.state_hash(),
        intentType: proposal.intentType,
        payload: clone(proposal.payload),
        budget: proposal.budget,
        createdAtLogical: beforeState.logicalTime,
        modelClass: decision.model,
        publicKeyHex: this.publicKeyHex,
      };
      const signed = await signIntent(this.identity, unsigned);
      cycle.intentId = `${this.identity.actorId}:${unsigned.seq}`;
      cycle.beforeStateHash = unsigned.observedStateHash;
      const event = JSON.parse(this.worldCore.apply_intent(JSON.stringify(signed)));
      const afterState = this.worldState();
      cycle.links.core = true;
      cycle.acceptedEventId = event.acceptedIntentHash;
      cycle.afterStateHash = event.nextStateHash;
      const placeId = nearestPlace(afterState.actors[this.identity.actorId]).id;
      this.events.push({ ...event, logicalTime: afterState.logicalTime, placeId });
      if (this.events.length > 100) this.events.shift();

      this.status = "remember-relate";
      if (this.mutation !== "memory-relationship") {
        const feedback = await this.applyMemoryAndRelationship(event, afterState.logicalTime, cycle.cycleId);
        cycle.memoryRecordIds = feedback.memoryRecordIds;
        cycle.relationshipChangeIds = feedback.relationshipChangeIds;
        cycle.links.memoryRelationship = true;
      }

      this.status = "project-event";
      if (this.mutation !== "scene") {
        cycle.projectedPosition = await this.projectEvent(event, afterState);
        cycle.links.scene = true;
      }
      cycle.stage = Object.values(cycle.links).every(Boolean) ? "completed" : "broken";
    } catch (error) {
      cycle.stage = "broken";
      cycle.error = error.message;
    } finally {
      cycle.completedAtMs = this.now();
      this.cycles.push(cycle);
      if (this.cycles.length > 100) this.cycles.shift();
      this.inFlight -= 1;
      this.status = this.running ? "idle" : "stopped";
      this.onCycle(clone(cycle), this.snapshot());
      this.queue(this.intervalMs);
    }
  }
}
