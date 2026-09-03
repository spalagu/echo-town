import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  simulateSociety,
  validateDiscourseClaim,
  validateInitialStatePack,
  validatePlannerObservation,
  validateSimulationResult,
  validateSituationSeed,
} from "../../packages/public-discourse/src/index.js";

const root = path.resolve(".");
const initialStates = await load("world/society/initial-states", ["river-shortage", "market-debt", "clinic-renovation"]);
const situations = await load("world/society/situation-seeds", ["ash-rain", "broken-cart", "late-traveler", "medicine-delay", "distant-bell"]);
const report = [];
let resultCount = 0;
let sourceAssertions = 0;
for (const initialState of initialStates) {
  const signatures = new Set();
  const claimStances = new Set();
  let refutations = 0;
  for (let seed = 0; seed < 30; seed += 1) {
    const result = simulateSociety(initialState, situations, seed);
    const eventIds = new Set(result.events.map((event) => event.id));
    assert.ok(result.events.every((event) => event.sourceEventIds.every((id) => eventIds.has(id)))); sourceAssertions += result.events.length;
    signatures.add(result.trajectorySignature);
    result.claims.forEach((claim) => {
      claimStances.add(claim.stance);
      if (claim.refutesClaimId) refutations += 1;
      assert.ok(claim.sourceEventIds.every((id) => eventIds.has(id))); sourceAssertions += 1;
    });
    result.memories.forEach((memory) => { assert.ok(memory.sourceEventIds.every((id) => eventIds.has(id))); sourceAssertions += 1; });
    result.acquaintances.forEach((edge) => { assert.ok(eventIds.has(edge.sourceEventId)); sourceAssertions += 1; });
    result.resources.forEach((resource) => { assert.ok(resource.sourceEventIds.every((id) => eventIds.has(id))); sourceAssertions += 1; });
    assert.ok(result.historicalSummary.sourceEventIds.every((id) => eventIds.has(id))); sourceAssertions += 1;
    assert.ok(result.plannerObservations.every((observation) => validatePlannerObservation(observation).ok));
    const memoryIds = new Set(result.memories.map((item) => item.id));
    const claimIds = new Set(result.claims.map((item) => item.id));
    result.plannerObservations.forEach((observation) => {
      assert.ok(observation.visibleEventIds.every((id) => eventIds.has(id)));
      assert.ok(observation.memoryIds.every((id) => memoryIds.has(id)));
      assert.ok(observation.claimIds.every((id) => claimIds.has(id)));
      sourceAssertions += observation.visibleEventIds.length + observation.memoryIds.length + observation.claimIds.length;
    });
    assert.ok(result.plannerObservations.every((observation) => !JSON.stringify(observation).includes("summary-")));
    assert.equal(result.pendingTemporaryResources, 0);
    resultCount += 1;
  }
  assert.ok(signatures.size >= 5);
  assert.ok(claimStances.size >= 2);
  assert.ok(refutations > 0);
  report.push({ initialStateId: initialState.id, trajectories: signatures.size, stances: [...claimStances].sort(), refutations });
}

const mutations = {};
for (const field of ["castSlots", "participants", "goal", "plotStage", "expectedOutcome", "ending"]) {
  assert.throws(() => validateInitialStatePack({ ...initialStates[0], [field]: "forbidden" }));
  mutations[field] = "red";
}
assert.equal(validateDiscourseClaim({
  schemaVersion: 1, id: "claim-bad", speakerActorId: "actor-a", stance: "support", statement: "大家都同意",
  sourceEventIds: ["event-a"], audienceActorIds: [], parentClaimId: null, refutesClaimId: null,
  mutationDepth: 0, heat: 100, logicalTime: 1, consensus: true,
}).ok, false);
mutations.consensus = "red";
const observation = simulateSociety(initialStates[0], situations, 0).plannerObservations[0];
assert.equal(validatePlannerObservation({ ...observation, historicalSummary: "summary-as-goal" }).ok, false);
mutations.summaryAsGoal = "red";

const feedbackSample = simulateSociety(initialStates[0], [situations[0]], 4);
const mutate = (name, change) => {
  const candidate = structuredClone(feedbackSample);
  change(candidate);
  assert.equal(validateSimulationResult(candidate, initialStates[0], [situations[0]]).ok, false, `${name} mutation 应判红`);
  mutations[name] = "red";
};
mutate("memoryFeedback", (candidate) => candidate.events.filter((item) => item.actionAffordance).forEach((item) => { item.memoryInputIds = []; }));
mutate("discourseFeedback", (candidate) => candidate.events.filter((item) => item.actionAffordance).forEach((item) => { item.claimInputIds = []; }));
mutate("affordanceBypass", (candidate) => { candidate.events.find((item) => item.actionAffordance).actionAffordance = "author_forced"; });
mutate("resourceRecovery", (candidate) => { candidate.resourceLedger.find((item) => item.kind === "temporary").reversalAppliedDelta += 1; });
mutate("naturalExpiry", (candidate) => { candidate.events = candidate.events.filter((item) => item.kind !== "resource_naturally_expired"); });
mutate("pendingLedger", (candidate) => { candidate.resourceLedger.find((item) => item.kind === "temporary").settledAtTick = null; });
mutate("resourceOverdraft", (candidate) => {
  const action = candidate.events.find((item) => item.actionAffordance);
  action.resourceLevelBefore = 0;
  action.actualResourceDelta = -1;
});
mutate("eventCausalReplay", (candidate) => { candidate.events.find((item) => item.sourceEventIds.length > 0).sequence = 0; });
mutate("claimCausalReplay", (candidate) => { candidate.claims.reverse(); });
mutate("relationshipProvenance", (candidate) => {
  assert.ok(candidate.acquaintances.length > 0);
  candidate.acquaintances[0].sourceEventId = "missing-event";
});
mutate("plannerProjectionProvenance", (candidate) => { candidate.plannerObservations[0].visibleEventIds[0] = "missing-event"; });
mutate("audienceBypass", (candidate) => {
  const child = candidate.claims.find((item) => item.parentClaimId && candidate.claims.find((parent) => parent.id === item.parentClaimId)?.speakerActorId !== item.speakerActorId);
  assert.ok(child);
  candidate.claims.find((item) => item.id === child.parentClaimId).audienceActorIds = ["unrelated-actor"];
});

const changedInitial = structuredClone(initialStates[0]);
changedInitial.observations[0].fact = "反事实中，河湾出现了完全不同的公开痕迹";
changedInitial.tensions[0].pressure = 1;
changedInitial.tensions[0].uncertainty = 100;
changedInitial.actionAffordances = ["observe", "share_claim", "trade", "repair"];
const changedSituation = structuredClone(situations[0]);
changedSituation.trigger.startTick += 7;
changedSituation.trigger.durationTicks += 5;
changedSituation.observations[0].fact = "反事实中，灰雨没有留下痕迹";
changedSituation.actionAffordances = ["observe", "trade", "repair"];
assert.notDeepEqual(actionDigest(feedbackSample), actionDigest(simulateSociety(changedInitial, [changedSituation], 4)));
mutations.inputCausality = "red";

const situationReport = [];
for (const situation of situations) {
  const signatures = new Set();
  for (let seed = 0; seed < 20; seed += 1) signatures.add(simulateSociety(initialStates[seed % 3], [situation], seed).trajectorySignature);
  assert.ok(signatures.size >= 3);
  situationReport.push({ situationId: situation.id, outcomes: signatures.size });
}

console.log(JSON.stringify({ initialStatePacks: 3, situationSeeds: 5, worldRuns: resultCount, actorScenarios: resultCount * 12, sourceAssertions, report, situationReport, mutations }, null, 2));

async function load(directory, ids) {
  return Promise.all(ids.map(async (id) => JSON.parse(await readFile(path.join(root, directory, `${id}.json`), "utf8"))));
}

function actionDigest(result) {
  return result.events.filter((item) => item.actionAffordance).map((item) => ({
    tick: item.tick,
    actorId: item.actorId,
    action: item.actionAffordance,
    context: item.decisionContextHash,
    detail: item.detail,
    observationEventIds: item.observationEventIds,
    memoryInputIds: item.memoryInputIds,
    claimInputIds: item.claimInputIds,
  }));
}
