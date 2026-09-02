import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PERSONA_FIXTURES } from "@echo-town/persona-core";
import { simulateSociety } from "@echo-town/public-discourse";
import { CompanionSession, MAX_UNRESOLVED_INFLUENCES } from "../src/index.js";

const root = path.resolve(".");
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
const initialState = await readJson("world/society/initial-states/river-shortage.json");
const situationIds = ["ash-rain", "broken-cart", "late-traveler", "medicine-delay", "distant-bell"];
const situations = await Promise.all(situationIds.map((id) => readJson(`world/society/situation-seeds/${id}.json`)));
const worldSeed = 31415;
const simulation = simulateSociety(initialState, situations, worldSeed);

function createSession(profile = PERSONA_FIXTURES[0], snapshot) {
  return new CompanionSession({
    ownerActorId: "local-owner",
    sourceActorId: `${profile.id}-${worldSeed}`,
    personaProfile: profile,
    events: simulation.events,
    claims: simulation.claims,
    memories: simulation.memories,
    acquaintances: simulation.acquaintances,
    snapshot,
  });
}

test("12 类人格都形成 30 日内 20 条可追溯行为因果链", () => {
  for (const profile of PERSONA_FIXTURES) {
    const session = createSession(profile);
    const behaviors = session.behaviors();
    assert.equal(behaviors.length, 20);
    assert.equal(behaviors.filter((item) => item.type === "action").length, 10);
    assert.equal(behaviors.filter((item) => item.type === "statement").length, 10);
    assert.ok(behaviors.every((item) => item.logicalDay <= 30 && item.sourceEventIds.length > 0
      && item.decisionFactors.length > 0 && item.personaProfileId === profile.id));
    for (const behavior of behaviors) {
      const explanation = session.explainBehavior(behavior.id);
      assert.equal(explanation.inferred, false);
      assert.equal(explanation.events[0].id, behavior.sourceEventIds[0]);
      assert.equal(explanation.reason.personaProfileId, profile.id);
      assert.deepEqual(explanation.reason.factors, behavior.decisionFactors);
    }
  }
});

test("离开与返回摘要、记忆册只引用真实行为来源且不回灌规划器", () => {
  const session = createSession();
  const summary = session.returnSummary(0, 30);
  const behaviorIds = new Set(session.behaviors().map((item) => item.id));
  const eventIds = new Set(simulation.events.map((item) => item.id));
  assert.equal(summary.readOnly, true);
  assert.equal(summary.plannerEligible, false);
  assert.ok(summary.sourceBehaviorIds.length > 0);
  assert.ok(summary.sourceBehaviorIds.every((id) => behaviorIds.has(id)));
  assert.ok(summary.sourceEventIds.every((id) => eventIds.has(id)));
  const album = session.memoryAlbum();
  assert.ok(album.length > 0);
  assert.ok(album.every((item) => item.ownerActorId === "local-owner" && item.sourceEventIds.length > 0
    && item.sourceEventIds.every((id) => eventIds.has(id))));
});

test("心室、信件、愿望与礼物只留在本地私人状态，角色可以接受影响或拒绝", () => {
  const canary = "PRIVATE-COMPANION-CANARY";
  const statuses = new Set();
  for (const profile of PERSONA_FIXTURES) {
    const session = createSession(profile);
    const heart = session.sendHeartMessage({ text: canary, logicalDay: 30 });
    assert.equal(heart.user.private, true);
    assert.equal(heart.companion.worldFact, false);
    const influence = session.submitInfluence({ kind: "wish", text: canary, logicalDay: 30 });
    const considered = session.considerInfluence(influence.id);
    statuses.add(considered.status);
    assert.ok(considered.sourceMemoryIds.length > 0);
    assert.ok(considered.sourceRelationshipEventIds.length > 0);
    assert.deepEqual(considered.goalReference, { path: "desire", value: profile.desire });
    assert.equal(JSON.stringify(session.publicProjection()).includes(canary), false);
    assert.deepEqual(session.publicProjection(), { schemaVersion: 1, activities: [] });
  }
  assert.ok(statuses.has("accepted_as_influence"));
  assert.ok(statuses.has("refused"));
});

test("未回应影响上限为 3，exact-key gate 拒绝强制执行和网络外发字段", () => {
  const session = createSession();
  for (let index = 0; index < MAX_UNRESOLVED_INFLUENCES; index += 1) {
    session.submitInfluence({ kind: ["letter", "wish", "gift"][index], text: `输入 ${index}`, logicalDay: 30 });
  }
  assert.throws(() => session.submitInfluence({ kind: "wish", text: "第四个", logicalDay: 30 }), /最多保留 3 个/u);
  assert.throws(() => session.submitInfluence({ kind: "wish", text: "强制行动", logicalDay: 30, mustExecute: true }), /输入非法/u);
  const snapshot = session.snapshot();
  snapshot.influences[0].networkEligible = true;
  assert.throws(() => createSession(PERSONA_FIXTURES[0], snapshot), /私人快照非法/u);
});

test("私人状态可恢复，伪造行动因素或表达来源会失败关闭", () => {
  const session = createSession();
  session.sendHeartMessage({ text: "明天也想听你讲镇上的事", logicalDay: 30 });
  const influence = session.submitInfluence({ kind: "letter", text: "愿你按自己的想法生活", logicalDay: 30 });
  session.considerInfluence(influence.id);
  const restored = createSession(PERSONA_FIXTURES[0], session.snapshot());
  assert.deepEqual(restored.heartRoom(), session.heartRoom());
  assert.deepEqual(restored.influenceLog(), session.influenceLog());

  const badEvents = structuredClone(simulation.events);
  badEvents.find((item) => item.actorId === `${PERSONA_FIXTURES[0].id}-${worldSeed}` && item.actionAffordance).decisionFactors = [];
  assert.throws(() => new CompanionSession({
    ownerActorId: "local-owner", sourceActorId: `${PERSONA_FIXTURES[0].id}-${worldSeed}`,
    personaProfile: PERSONA_FIXTURES[0], events: badEvents, claims: simulation.claims, memories: simulation.memories,
    acquaintances: simulation.acquaintances,
  }), /行为因果链非法/u);

  const badClaims = structuredClone(simulation.claims);
  badClaims.find((item) => item.speakerActorId === `${PERSONA_FIXTURES[0].id}-${worldSeed}`).sourceEventIds = ["missing-event"];
  assert.throws(() => new CompanionSession({
    ownerActorId: "local-owner", sourceActorId: `${PERSONA_FIXTURES[0].id}-${worldSeed}`,
    personaProfile: PERSONA_FIXTURES[0], events: simulation.events, claims: badClaims, memories: simulation.memories,
    acquaintances: simulation.acquaintances,
  }), /缺少真实行动来源/u);
});
