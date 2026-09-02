import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateClaimRecord } from "../../packages/mystery-fabric/src/index.js";

const encoder = new TextEncoder();
const wasmBytes = await readFile(new URL("../../crates/world-core/pkg/echo_town_world_core_bg.wasm", import.meta.url));
const wasm = await import("../../crates/world-core/pkg/echo_town_world_core.js?mystery-ap20");
wasm.initSync({ module: wasmBytes });

const mysteryIds = ["borrowed-echoes", "tideglass-drift", "third-shadow"];
const mysteries = await Promise.all(mysteryIds.map(async (id) => JSON.parse(
  await readFile(new URL(`../../world/mysteries/${id}.json`, import.meta.url), "utf8"),
)));
const actorPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const witnessPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const actorPublicKeyHex = hex(await crypto.subtle.exportKey("raw", actorPair.publicKey));
const witnessPublicKeyHex = hex(await crypto.subtle.exportKey("raw", witnessPair.publicKey));
const report = { cases: 0, effects: [], claimEvents: 0, secondHopEvents: 0, mutations: [] };

for (const mystery of mysteries) {
  const artifact = mystery.artifacts[0];
  for (const rule of artifact.conditionRules) {
    const effect = artifact.boundedEffects.find((item) => item.pathId === rule.pathId);
    const sourceEventIds = rule.observedFragmentIds.map((id) => (
      mystery.clueFragments.find((clue) => clue.id === id).sourceEventId
    ));
    const config = worldConfig(mystery, artifact, rule);
    const left = core(config);
    const right = core(config);
    const experiment = await signedArtifactExperiment(left, artifact, rule, sourceEventIds);
    const leftEffect = left.apply_artifact_experiment(JSON.stringify(experiment));
    const rightEffect = right.apply_artifact_experiment(JSON.stringify(experiment));
    assert.equal(leftEffect, rightEffect);
    const effectEvent = JSON.parse(leftEffect);
    assert.equal(effectEvent.eventType, "ArtifactEffectObserved");
    assert.equal(effectEvent.authorityId, "authority-fixture");
    assert.equal(effectEvent.payload.effectId, effect.id);
    assert.equal(effectEvent.payload.effectKind, effect.kind);
    assert.equal(effectEvent.payload.magnitude, effect.magnitude);
    assert.equal(effectEvent.payload.durationTicks, effect.durationTicks);

    if (rule.minimumWitnesses > 1) {
      const missingWitnessCore = core(config);
      const missingWitness = await signedArtifactExperiment(
        missingWitnessCore,
        artifact,
        rule,
        sourceEventIds,
        false,
      );
      assert.throws(
        () => missingWitnessCore.apply_artifact_experiment(JSON.stringify(missingWitness)),
        /witness_signature/,
      );
      report.mutations.push(`${mystery.id}:${rule.pathId}:缺失见证签名`);
    }

    const proposition = `${mystery.title}中的现象可能互有关联，但仍有反例。`;
    const belief = {
      schemaVersion: 1,
      id: `belief-${mystery.id}-${rule.pathId}`,
      ownerActorId: "actor-one",
      kind: "belief",
      proposition,
      sourceIds: [...sourceEventIds, effectEvent.acceptedIntentHash],
      confidence: 61,
      receivedFromActorId: null,
      transformationNote: null,
      logicalTime: 2,
    };
    assert.equal(validateClaimRecord(belief).ok, true);
    const firstShare = await signedClaimShare({
      worldCore: left,
      keyPair: actorPair,
      publicKeyHex: actorPublicKeyHex,
      actorId: "actor-one",
      seq: 2,
      claimId: belief.id,
      sourceEventIds: belief.sourceIds,
      audienceActorIds: ["actor-two"],
      proposition,
      createdAtLogical: 1,
    });
    const shareEvent = JSON.parse(left.apply_claim_share(JSON.stringify(firstShare)));
    assert.equal(shareEvent.eventType, "ClaimShared");
    assert.equal(shareEvent.authorityId, "authority-fixture");
    assert.deepEqual(shareEvent.payload.sourceEventIds, belief.sourceIds);
    assert.deepEqual(shareEvent.payload.audienceActorIds, ["actor-two"]);
    const rumor = {
      schemaVersion: 1,
      id: `rumor-${mystery.id}-${rule.pathId}`,
      ownerActorId: "actor-two",
      kind: "rumor",
      proposition,
      sourceIds: [belief.id, ...belief.sourceIds, shareEvent.acceptedIntentHash],
      confidence: 53,
      receivedFromActorId: "actor-one",
      transformationNote: "保留来源，但降低确信度。",
      logicalTime: 3,
    };
    assert.equal(validateClaimRecord(rumor).ok, true);

    const secondShare = await signedClaimShare({
      worldCore: left,
      keyPair: witnessPair,
      publicKeyHex: witnessPublicKeyHex,
      actorId: "actor-two",
      seq: 1,
      claimId: rumor.id,
      sourceEventIds: [shareEvent.acceptedIntentHash],
      audienceActorIds: ["actor-one"],
      proposition: rumor.proposition,
      createdAtLogical: 2,
    });
    const secondHopEvent = JSON.parse(left.apply_claim_share(JSON.stringify(secondShare)));
    assert.equal(secondHopEvent.eventType, "ClaimShared");
    assert.deepEqual(secondHopEvent.payload.sourceEventIds, [shareEvent.acceptedIntentHash]);
    assert.notEqual(left.state_hash(), right.state_hash());

    report.cases += 1;
    report.effects.push(`${mystery.id}:${rule.pathId}:${effect.id}`);
    report.claimEvents += 1;
    report.secondHopEvents += 1;
  }
}

const secretRule = mysteries[0].artifacts[0].conditionRules[0];
const secretConfig = worldConfig(mysteries[0], mysteries[0].artifacts[0], secretRule);
secretConfig.acceptedSourceEventIds.push("secret-event");
const secretCore = core(secretConfig);
const invisibleShare = await signedClaimShare({
  worldCore: secretCore,
  keyPair: actorPair,
  publicKeyHex: actorPublicKeyHex,
  actorId: "actor-one",
  seq: 1,
  claimId: "claim-secret-source",
  sourceEventIds: ["secret-event"],
  audienceActorIds: ["actor-two"],
  proposition: "我不可能亲历的秘密。",
  createdAtLogical: 0,
});
assert.throws(() => secretCore.apply_claim_share(JSON.stringify(invisibleShare)), /source_visibility/);
report.mutations.push("全局存在但发送者不可见的来源");

assert.equal(report.cases, 6);
assert.equal(report.claimEvents, 6);
assert.equal(report.secondHopEvents, 6);
console.log(JSON.stringify(report, null, 2));

function worldConfig(mystery, artifact, activeRule) {
  return {
    worldId: "echo-town-mystery-test",
    zoneId: "center",
    authorityId: "authority-fixture",
    actors: [
      { actorId: "actor-one", publicKeyHex: actorPublicKeyHex, x: 0, y: 0 },
      { actorId: "actor-two", publicKeyHex: witnessPublicKeyHex, x: 0, y: 0 },
    ],
    artifactRules: artifact.conditionRules.map((condition) => {
      const bounded = artifact.boundedEffects.find((item) => item.pathId === condition.pathId);
      return {
        artifactId: artifact.itemId,
        acceptedActions: condition.acceptedActions,
        requiredFragmentIds: condition.observedFragmentIds,
        requiredWorldSignals: condition.worldSignals,
        minimumWitnesses: condition.minimumWitnesses,
        effectId: bounded.id,
        effectKind: bounded.kind,
        magnitude: bounded.magnitude,
        durationTicks: bounded.durationTicks,
        feedbackClass: artifact.feedbackClass,
      };
    }),
    acceptedSourceEventIds: mystery.clueFragments.map((clue) => clue.sourceEventId),
    fragmentSources: Object.fromEntries(mystery.clueFragments.map((clue) => [clue.id, clue.sourceEventId])),
    activeWorldSignals: activeRule.worldSignals,
    actorObservedFragments: { "actor-one": activeRule.observedFragmentIds },
  };
}

function core(config) {
  return new wasm.WasmWorldCore(JSON.stringify(config));
}

async function signedArtifactExperiment(
  worldCore,
  artifact,
  rule,
  sourceEventIds,
  includeWitnessAttestation = true,
) {
  const requiresSecondWitness = rule.minimumWitnesses > 1;
  const witnessActorIds = requiresSecondWitness ? ["actor-one", "actor-two"] : ["actor-one"];
  const unsigned = {
    schemaVersion: 1,
    worldId: "echo-town-mystery-test",
    zoneId: "center",
    actorId: "actor-one",
    seq: 1,
    observedStateHash: worldCore.state_hash(),
    artifactId: artifact.itemId,
    action: rule.acceptedActions[0],
    observedFragmentIds: rule.observedFragmentIds,
    sourceEventIds,
    witnessActorIds,
    budget: 3,
    createdAtLogical: 0,
    modelClass: "rules",
    publicKeyHex: actorPublicKeyHex,
  };
  const witnessAttestations = [];
  if (requiresSecondWitness && includeWitnessAttestation) {
    const witnessMessage = new Uint8Array([
      ...encoder.encode(JSON.stringify(unsigned)),
      ...encoder.encode("|witness|actor-two"),
    ]);
    const witnessSignature = await crypto.subtle.sign("Ed25519", witnessPair.privateKey, witnessMessage);
    witnessAttestations.push({
      actorId: "actor-two",
      publicKeyHex: witnessPublicKeyHex,
      signatureHex: hex(witnessSignature),
    });
  }
  const signature = await crypto.subtle.sign("Ed25519", actorPair.privateKey, encoder.encode(JSON.stringify(unsigned)));
  return { ...unsigned, witnessAttestations, signatureHex: hex(signature) };
}

async function signedClaimShare({
  worldCore,
  keyPair,
  publicKeyHex,
  actorId,
  seq,
  claimId,
  sourceEventIds,
  audienceActorIds,
  proposition,
  createdAtLogical,
}) {
  const propositionHash = hex(await crypto.subtle.digest("SHA-256", encoder.encode(proposition)));
  const unsigned = {
    schemaVersion: 1,
    worldId: "echo-town-mystery-test",
    zoneId: "center",
    actorId,
    seq,
    observedStateHash: worldCore.state_hash(),
    claimId,
    sourceEventIds,
    audienceActorIds,
    propositionHash,
    budget: 2,
    createdAtLogical,
    publicKeyHex,
  };
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, encoder.encode(JSON.stringify(unsigned)));
  return { ...unsigned, signatureHex: hex(signature) };
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
