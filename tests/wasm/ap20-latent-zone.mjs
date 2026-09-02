import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const encoder = new TextEncoder();
const wasmBytes = await readFile(new URL("../../crates/world-core/pkg/echo_town_world_core_bg.wasm", import.meta.url));
const wasm = await import("../../crates/world-core/pkg/echo_town_world_core.js?latent-zone-ap20");
wasm.initSync({ module: wasmBytes });
const pack = JSON.parse(await readFile(new URL("../../world/latent-zones/unregistered-interval.json", import.meta.url), "utf8"));
const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const publicKeyHex = hex(await crypto.subtle.exportKey("raw", keyPair.publicKey));
const report = { paths: [], factorEvents: 0, nearMisses: 0, mutations: [] };

for (const alternative of pack.thresholdAlternatives) {
  const relevant = affordancesFor(alternative);
  const left = core(configFor());
  const right = core(configFor());
  const leftFactors = [];
  const rightFactors = [];
  for (const affordance of relevant) {
    const leftEvent = await applyFactor(left, affordance);
    const rightEvent = await applyFactor(right, affordance);
    assert.deepEqual(leftEvent, rightEvent);
    assert.equal(leftEvent.eventType, "LatentZoneFactorObserved");
    assert.equal(leftEvent.payload.triggerId, affordance.triggerId);
    assert.equal(JSON.stringify(leftEvent).includes(affordance.factorValue), false);
    leftFactors.push(leftEvent.acceptedIntentHash);
    rightFactors.push(rightEvent.acceptedIntentHash);
    report.factorEvents += 1;
  }
  const leftJson = left.apply_latent_zone_attempt(JSON.stringify(await signedAttempt(left, leftFactors)));
  const rightJson = right.apply_latent_zone_attempt(JSON.stringify(await signedAttempt(right, rightFactors)));
  assert.equal(leftJson, rightJson);
  const event = JSON.parse(leftJson);
  assert.equal(event.eventType, "ZoneRevealed");
  assert.equal(event.authorityId, "authority-fixture");
  assert.equal(event.payload.zoneId, pack.zoneId);
  assert.deepEqual(event.payload.revealEdges, pack.onSatisfied.revealEdges);
  assert.deepEqual(event.payload.locationStateChanges, pack.onSatisfied.locationStateChanges);
  assert.deepEqual(event.payload.eventPoolAdds, pack.onSatisfied.eventPoolAdds);
  const snapshot = JSON.parse(left.snapshot());
  assert.deepEqual(snapshot.revealedZones, [pack.zoneId]);
  assert.deepEqual(snapshot.reachableEdges, pack.onSatisfied.revealEdges);
  assert.equal(snapshot.locationStates[pack.onSatisfied.locationStateChanges[0].locationId], pack.onSatisfied.locationStateChanges[0].state);
  assert.deepEqual(snapshot.eventPool, pack.onSatisfied.eventPoolAdds);

  const repeat = await signedAttempt(left, [event.acceptedIntentHash]);
  assert.throws(() => left.apply_latent_zone_attempt(JSON.stringify(repeat)), /zone_already_revealed/);
  report.mutations.push(`${alternative.id}:重复显现`);

  for (const omitted of relevant) {
    const nearMiss = core(configFor());
    const factorIds = [];
    for (const affordance of relevant.filter((item) => item.triggerId !== omitted.triggerId)) {
      factorIds.push((await applyFactor(nearMiss, affordance)).acceptedIntentHash);
    }
    const feedback = JSON.parse(nearMiss.apply_latent_zone_attempt(JSON.stringify(await signedAttempt(nearMiss, factorIds))));
    assert.equal(feedback.eventType, "LatentZoneFeedback");
    assert.equal(feedback.payload.zoneId, null);
    assert.deepEqual(feedback.payload.revealEdges, []);
    assert.deepEqual(JSON.parse(nearMiss.snapshot()).revealedZones, []);
    report.nearMisses += 1;
  }

  const progress = core(configFor());
  const beforeLast = [];
  for (const affordance of relevant.slice(0, -1)) {
    beforeLast.push((await applyFactor(progress, affordance)).acceptedIntentHash);
  }
  const faint = JSON.parse(progress.apply_latent_zone_attempt(JSON.stringify(await signedAttempt(progress, beforeLast))));
  assert.equal(faint.eventType, "LatentZoneFeedback");
  const finalFactor = await applyFactor(progress, relevant.at(-1));
  const revealed = JSON.parse(progress.apply_latent_zone_attempt(JSON.stringify(
    await signedAttempt(progress, [...beforeLast, finalFactor.acceptedIntentHash]),
  )));
  assert.equal(revealed.eventType, "ZoneRevealed");
  report.paths.push(alternative.id);
}

const unrelated = core(configFor({ extraSources: ["event-unrelated"] }));
const unrelatedAttempt = await signedAttempt(unrelated, ["event-unrelated"]);
assert.throws(
  () => unrelated.apply_latent_zone_attempt(JSON.stringify(unrelatedAttempt)),
  /factor_event_source/,
);
report.mutations.push("显现尝试拒绝无关可见事件");

const crossPhenomenon = core(configFor({ includeSecondPhenomenon: true }));
const otherAffordance = { ...pack.evidenceAffordances[0], triggerId: `other-${pack.evidenceAffordances[0].triggerId}` };
const otherFactor = await applyFactor(crossPhenomenon, otherAffordance, "other-phenomenon");
const crossPhenomenonAttempt = await signedAttempt(crossPhenomenon, [otherFactor.acceptedIntentHash]);
assert.throws(
  () => crossPhenomenon.apply_latent_zone_attempt(JSON.stringify(crossPhenomenonAttempt)),
  /factor_event_source/,
);
report.mutations.push("显现尝试拒绝其他现象的因子事件");

const wrongSource = core(configFor({ extraSources: ["event-unrelated"] }));
const wrongSourceIntent = await signedFactor(wrongSource, pack.evidenceAffordances[0], ["event-unrelated"]);
assert.throws(() => wrongSource.apply_latent_zone_factor(JSON.stringify(wrongSourceIntent)), /factor_source/);
report.mutations.push("因子必须绑定规定来源事件");

const invisibleSource = pack.evidenceAffordances[0].sourceEventIds[0];
const invisible = core(configFor({ hiddenSources: [invisibleSource] }));
const invisibleIntent = await signedFactor(invisible, pack.evidenceAffordances[0]);
assert.throws(() => invisible.apply_latent_zone_factor(JSON.stringify(invisibleIntent)), /source_visibility/);
report.mutations.push("角色不可见来源不能形成因子事件");

const badSignature = core(configFor());
const tampered = await signedFactor(badSignature, pack.evidenceAffordances[0]);
tampered.signatureHex = `${tampered.signatureHex.slice(0, -2)}00`;
assert.throws(() => badSignature.apply_latent_zone_factor(JSON.stringify(tampered)), /signature/);
report.mutations.push("错误签名被拒绝");

const singlePathConfig = configFor();
singlePathConfig.latentZoneRules.splice(1);
const singlePath = core(singlePathConfig);
const singlePathIntent = await signedAttempt(singlePath, [pack.evidenceAffordances[0].sourceEventIds[0]]);
assert.throws(
  () => singlePath.apply_latent_zone_attempt(JSON.stringify(singlePathIntent)),
  /phenomenon/,
);
report.mutations.push("单路径配置失败关闭");

const reorderedConfig = configFor({ extraSources: ["event-extra-factor"] });
const firstRule = structuredClone(reorderedConfig.latentZoneRules[0]);
firstRule.requiredArtifactStates.push("extra:factor");
reorderedConfig.latentZoneRules = [
  firstRule,
  { ...structuredClone(firstRule), alternativeId: "reordered-duplicate", requiredArtifactStates: [...firstRule.requiredArtifactStates].reverse() },
];
reorderedConfig.latentZoneFactorRules = [
  ...reorderedConfig.latentZoneFactorRules.filter((rule) => affordancesFor(pack.thresholdAlternatives[0]).some((item) => item.triggerId === rule.triggerId)),
  { triggerId: "extra-factor", phenomenonId: pack.publicProjection.phenomenonId, factorKind: "artifact", factorValue: "extra:factor", requiredSourceEventIds: ["event-extra-factor"] },
];
const reordered = core(reorderedConfig);
const reorderedIntent = await signedAttempt(reordered, ["event-extra-factor"]);
assert.throws(
  () => reordered.apply_latent_zone_attempt(JSON.stringify(reorderedIntent)),
  /phenomenon/,
);
report.mutations.push("集合重排不能伪造第二路径");

assert.equal(report.paths.length, 2);
assert.equal(report.nearMisses, 10);
console.log(JSON.stringify(report, null, 2));

function affordancesFor(alternative) {
  const factors = new Set([
    ...alternative.artifactStates,
    ...alternative.worldPredicates,
    ...alternative.socialPredicates,
    ...alternative.actionSequence,
  ]);
  return pack.evidenceAffordances.filter((item) => factors.has(item.factorValue));
}

function configFor({ extraSources = [], hiddenSources = [], includeSecondPhenomenon = false } = {}) {
  const sourceEventIds = [...new Set([
    ...pack.evidenceAffordances.flatMap((item) => item.sourceEventIds),
    ...extraSources,
  ])];
  const fragmentSources = Object.fromEntries(sourceEventIds.map((eventId, index) => [`fragment-${index}`, eventId]));
  const actorObservedFragments = Object.entries(fragmentSources)
    .filter(([, eventId]) => !hiddenSources.includes(eventId))
    .map(([fragmentId]) => fragmentId);
  const latentZoneRules = pack.thresholdAlternatives.map((item) => ({
    alternativeId: item.id,
    phenomenonId: pack.publicProjection.phenomenonId,
    zoneId: pack.zoneId,
    requiredArtifactStates: [...item.artifactStates],
    requiredWorldPredicates: [...item.worldPredicates],
    requiredSocialPredicates: [...item.socialPredicates],
    requiredActionSequence: [...item.actionSequence],
    revealEdges: pack.onSatisfied.revealEdges,
    locationStateChanges: pack.onSatisfied.locationStateChanges,
    eventPoolAdds: pack.onSatisfied.eventPoolAdds,
  }));
  const latentZoneFactorRules = pack.evidenceAffordances.map((item) => ({
    triggerId: item.triggerId,
    phenomenonId: pack.publicProjection.phenomenonId,
    factorKind: item.factorKind,
    factorValue: item.factorValue,
    requiredSourceEventIds: item.sourceEventIds,
  }));
  if (includeSecondPhenomenon) {
    latentZoneRules.push(...pack.thresholdAlternatives.map((item) => ({
      alternativeId: `other-${item.id}`,
      phenomenonId: "other-phenomenon",
      zoneId: "other-latent-zone",
      requiredArtifactStates: [...item.artifactStates],
      requiredWorldPredicates: [...item.worldPredicates],
      requiredSocialPredicates: [...item.socialPredicates],
      requiredActionSequence: [...item.actionSequence],
      revealEdges: pack.onSatisfied.revealEdges.map((edge) => ({ ...edge, to: "other-latent-zone" })),
      locationStateChanges: pack.onSatisfied.locationStateChanges,
      eventPoolAdds: pack.onSatisfied.eventPoolAdds,
    })));
    latentZoneFactorRules.push(...pack.evidenceAffordances.map((item) => ({
      triggerId: `other-${item.triggerId}`,
      phenomenonId: "other-phenomenon",
      factorKind: item.factorKind,
      factorValue: item.factorValue,
      requiredSourceEventIds: item.sourceEventIds,
    })));
  }
  return {
    worldId: "echo-town-latent-test",
    zoneId: "center",
    authorityId: "authority-fixture",
    actors: [{ actorId: "actor-one", publicKeyHex, x: 0, y: 0 }],
    acceptedSourceEventIds: sourceEventIds,
    fragmentSources,
    actorObservedFragments: { "actor-one": actorObservedFragments },
    latentZoneRules,
    latentZoneFactorRules,
  };
}

function core(config) {
  return new wasm.WasmWorldCore(JSON.stringify(config));
}

async function applyFactor(worldCore, affordance, phenomenonId = pack.publicProjection.phenomenonId) {
  return JSON.parse(worldCore.apply_latent_zone_factor(JSON.stringify(
    await signedFactor(worldCore, affordance, affordance.sourceEventIds, phenomenonId),
  )));
}

async function signedFactor(worldCore, affordance, sourceEventIds = affordance.sourceEventIds, phenomenonId = pack.publicProjection.phenomenonId) {
  const snapshot = JSON.parse(worldCore.snapshot());
  const unsigned = {
    schemaVersion: 1,
    worldId: "echo-town-latent-test",
    zoneId: "center",
    actorId: "actor-one",
    seq: snapshot.actors["actor-one"].lastSeq + 1,
    observedStateHash: worldCore.state_hash(),
    phenomenonId,
    triggerId: affordance.triggerId,
    sourceEventIds,
    budget: 3,
    createdAtLogical: snapshot.logicalTime,
    publicKeyHex,
  };
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, encoder.encode(JSON.stringify(unsigned)));
  return { ...unsigned, signatureHex: hex(signature) };
}

async function signedAttempt(worldCore, sourceEventIds, phenomenonId = pack.publicProjection.phenomenonId) {
  const snapshot = JSON.parse(worldCore.snapshot());
  const unsigned = {
    schemaVersion: 1,
    worldId: "echo-town-latent-test",
    zoneId: "center",
    actorId: "actor-one",
    seq: snapshot.actors["actor-one"].lastSeq + 1,
    observedStateHash: worldCore.state_hash(),
    phenomenonId,
    sourceEventIds,
    budget: 3,
    createdAtLogical: snapshot.logicalTime,
    publicKeyHex,
  };
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, encoder.encode(JSON.stringify(unsigned)));
  return { ...unsigned, signatureHex: hex(signature) };
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
