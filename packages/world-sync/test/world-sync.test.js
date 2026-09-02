import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createIdentity } from "@echo-town/identity-vault";
import { createPublicActivityEnvelope } from "@echo-town/privacy-network";
import {
  createLeaseCertificate,
  createLeaseProposal,
  createSignedWorldSyncEnvelope,
  signLeaseVote,
  validatePublicNodeRegistry,
  verifyLeaseCertificate,
  verifySignedWorldSyncEnvelope,
  WorldSyncReplica,
} from "../src/index.js";
import { openPublicRendezvous } from "../src/trystero.js";

const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const registryPath = new URL("../../../config/public-nodes.json", import.meta.url);
const publicRegistryPath = new URL("../../../apps/web/public/public-nodes.json", import.meta.url);

function activity(identity, sequence) {
  return createPublicActivityEnvelope({
    worldId: "echo-town-local",
    zoneId: "center",
    senderActorId: identity.actorId,
    messageId: `message:${identity.actorId}:${sequence}`,
    logicalTime: sequence,
    activity: {
      schemaVersion: 1,
      id: `activity:${identity.actorId}:${sequence}`,
      actorId: identity.actorId,
      kind: "mergeable_local",
      sourceEventIds: [`source:${sequence}`],
      logicalTime: sequence,
      publicProjection: { eventType: "ObservedPlace", placeId: "old-clocktower" },
    },
    privateContext: { privateMemory: `PRIVATE_CANARY_${sequence}` },
  });
}

async function fixture() {
  const identities = await Promise.all([createIdentity(), createIdentity(), createIdentity()]);
  return { identities, committee: identities.map((identity) => identity.actorId), initial: hash("genesis") };
}

async function certificate(identities, authority, epoch = 1, voters = identities.slice(0, 2), time = 10) {
  const proposal = createLeaseProposal({
    worldId: "echo-town-local", zoneId: "center", epoch, authorityId: authority.actorId,
    issuedAtLogical: time, expiresAtLogical: time + 10,
  });
  return createLeaseCertificate(proposal, await Promise.all(voters.map((identity) => signLeaseVote(identity, proposal))));
}

test("公共节点 registry 固定双策略、多运营者、零项目节点，发布副本逐字一致", async () => {
  const source = await readFile(registryPath, "utf8");
  const published = await readFile(publicRegistryPath, "utf8");
  assert.equal(published, source);
  const registry = validatePublicNodeRegistry(JSON.parse(source));
  assert.deepEqual(registry.strategies.map((strategy) => [strategy.protocol, strategy.role, strategy.endpoints.length]), [
    ["nostr", "primary", 5], ["webtorrent", "backup", 2],
  ]);
  const oneOperator = structuredClone(registry);
  oneOperator.strategies[0].endpoints[1].operator = oneOperator.strategies[0].endpoints[0].operator;
  assert.throws(() => validatePublicNodeRegistry(oneOperator), /独立第三方/u);
  const projectNode = structuredClone(registry);
  projectNode.policy.projectOperatedNodes = true;
  assert.throws(() => validatePublicNodeRegistry(projectNode), /策略非法/u);
});

test("2/3 签名 lease 接受合法法定人数，拒绝少数派、篡改与过期", async () => {
  const { identities, committee } = await fixture();
  const accepted = await certificate(identities, identities[0]);
  await assert.doesNotReject(() => verifyLeaseCertificate(accepted, { committee, logicalTime: 11 }));
  const minority = createLeaseCertificate(accepted.proposal, [accepted.votes[0]]);
  await assert.rejects(() => verifyLeaseCertificate(minority, { committee, logicalTime: 11 }), /2\/3/u);
  const tampered = structuredClone(accepted);
  tampered.proposal.authorityId = identities[1].actorId;
  await assert.rejects(() => verifyLeaseCertificate(tampered, { committee, logicalTime: 11 }), /vote 非法/u);
  await assert.rejects(() => verifyLeaseCertificate(accepted, { committee, logicalTime: 20 }), /过期/u);
});

test("签名活动按 ID 确定性收敛，重放、丢序、串 peer、篡改与无 lease 权威事件全部判红", async () => {
  const { identities, committee, initial } = await fixture();
  const replicas = [new WorldSyncReplica({ worldId: "echo-town-local", zoneId: "center", initialStateHash: initial, committee }), new WorldSyncReplica({ worldId: "echo-town-local", zoneId: "center", initialStateHash: initial, committee })];
  const envelopes = await Promise.all(identities.slice(0, 2).map((identity) => createSignedWorldSyncEnvelope(identity, {
    worldId: "echo-town-local", zoneId: "center", epoch: 1, sequence: 1,
    previousStateHash: initial, stateHash: initial, sentAtLogical: 1, activities: [activity(identity, 1)],
  })));
  assert.equal(JSON.stringify(envelopes).includes("PRIVATE_CANARY"), false);
  await replicas[0].ingest(envelopes[0]); await replicas[0].ingest(envelopes[1]);
  await replicas[1].ingest(envelopes[1]); await replicas[1].ingest(envelopes[0]);
  assert.deepEqual(replicas[0].snapshot(), replicas[1].snapshot());
  assert.equal((await replicas[0].ingest(envelopes[0])).status, "duplicate");

  const skipped = await createSignedWorldSyncEnvelope(identities[0], {
    worldId: "echo-town-local", zoneId: "center", epoch: 1, sequence: 3,
    previousStateHash: initial, stateHash: initial, sentAtLogical: 3, activities: [activity(identities[0], 3)],
  });
  await assert.rejects(() => replicas[0].ingest(skipped), /sequence/u);
  const crossed = structuredClone(envelopes[0]); crossed.worldId = "other-world";
  await assert.rejects(() => verifySignedWorldSyncEnvelope(crossed), /签名/u);
  const tampered = structuredClone(envelopes[0]); tampered.activities[0].activity.publicProjection.placeId = "river-market";
  await assert.rejects(() => verifySignedWorldSyncEnvelope(tampered), /签名/u);
  const impersonatedActivity = activity(identities[1], 2);
  const impersonated = await createSignedWorldSyncEnvelope(identities[0], {
    worldId: "echo-town-local", zoneId: "center", epoch: 1, sequence: 2,
    previousStateHash: initial, stateHash: initial, sentAtLogical: 2, activities: [impersonatedActivity],
  });
  await assert.rejects(() => verifySignedWorldSyncEnvelope(impersonated), /代签/u);
  await assert.rejects(() => createSignedWorldSyncEnvelope(identities[0], {
    worldId: "echo-town-local", zoneId: "center", epoch: 1, sequence: 2,
    previousStateHash: initial, stateHash: hash("forged"), sentAtLogical: 2,
    events: [{ schemaVersion: 1, worldId: "echo-town-local", zoneId: "center", epoch: 1, eventSeq: 1,
      previousStateHash: initial, acceptedIntentHash: hash("intent"), eventType: "Moved", actorId: identities[0].actorId,
      payload: { dx: 1, dy: 0 }, nextStateHash: hash("forged"), authorityId: identities[0].actorId }],
  }), /缺少 lease/u);
});

test("产品协议 30 个分区/重连用例全部收敛，少数派不能签发权威事件", async () => {
  const { identities, committee, initial } = await fixture();
  const results = [];
  for (let index = 1; index <= 30; index += 1) {
    const quorum = index % 3 === 0 ? [identities[0], identities[2]] : index % 3 === 1 ? [identities[1], identities[2]] : [identities[0], identities[1]];
    const authority = quorum[0];
    const lease = await certificate(identities, authority, index, quorum, index * 10);
    const minorityLease = await certificate(identities, identities.find((identity) => !quorum.includes(identity)), index, [identities.find((identity) => !quorum.includes(identity))], index * 10);
    const replicaA = new WorldSyncReplica({ worldId: "echo-town-local", zoneId: "center", initialStateHash: initial, committee });
    const replicaB = new WorldSyncReplica({ worldId: "echo-town-local", zoneId: "center", initialStateHash: initial, committee });
    await assert.rejects(() => verifyLeaseCertificate(minorityLease, { committee, logicalTime: index * 10 + 1 }), /2\/3/u);
    const next = hash(`state:${index}`);
    const event = { schemaVersion: 1, worldId: "echo-town-local", zoneId: "center", epoch: index, eventSeq: 1,
      previousStateHash: initial, acceptedIntentHash: hash(`intent:${index}`), eventType: "Moved", actorId: authority.actorId,
      payload: { dx: index % 2, dy: (index + 1) % 2 }, nextStateHash: next, authorityId: authority.actorId };
    const envelope = await createSignedWorldSyncEnvelope(authority, {
      worldId: "echo-town-local", zoneId: "center", epoch: index, sequence: 1,
      previousStateHash: initial, stateHash: next, sentAtLogical: index * 10 + 1, events: [event], lease,
    });
    await replicaA.ingest(envelope); await replicaB.ingest(envelope);
    const pass = JSON.stringify(replicaA.snapshot()) === JSON.stringify(replicaB.snapshot()) && replicaA.snapshot().stateHash === next;
    results.push({ index, pass, stateHash: next });
  }
  assert.equal(results.length, 30);
  assert.equal(results.every((result) => result.pass), true);
});

test("持久化快照重开后保留 sequence、活动与哈希，旧消息不能再次接受", async () => {
  const { identities, committee, initial } = await fixture();
  const first = await createSignedWorldSyncEnvelope(identities[0], {
    worldId: "echo-town-local", zoneId: "center", epoch: 1, sequence: 1,
    previousStateHash: initial, stateHash: initial, sentAtLogical: 1, activities: [activity(identities[0], 1)],
  });
  const before = new WorldSyncReplica({ worldId: "echo-town-local", zoneId: "center", initialStateHash: initial, committee });
  await before.ingest(first);
  const reopened = new WorldSyncReplica({ worldId: "echo-town-local", zoneId: "center", initialStateHash: initial, committee, snapshot: before.snapshot() });
  await assert.rejects(() => reopened.ingest(first), /sequence/u);
  const second = await createSignedWorldSyncEnvelope(identities[0], {
    worldId: "echo-town-local", zoneId: "center", epoch: 1, sequence: 2,
    previousStateHash: initial, stateHash: initial, sentAtLogical: 2, activities: [activity(identities[0], 2)],
  });
  await reopened.ingest(second);
  assert.equal(reopened.snapshot().activities.length, 2);
  assert.equal(reopened.snapshot().sequences[identities[0].actorId], 2);
});

test("Nostr/WebTorrent 双 transport 同时装配、消息去重并可统一关闭", async () => {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const rooms = [];
  const received = [];
  const moduleLoader = async (protocol) => ({
    joinRoom(config, roomId) {
      const room = {
        protocol, config, roomId, left: false,
        makeAction() {
          const action = { sent: [], async send(message, target) { action.sent.push({ message, target }); } };
          room.action = action; return action;
        },
        leave() { room.left = true; },
      };
      rooms.push(room); return room;
    },
  });
  const transport = await openPublicRendezvous({ registry, roomId: "ap05-room", moduleLoader, onMessage: (message) => received.push(message) });
  assert.deepEqual(transport.strategies.map((strategy) => strategy.protocol), ["nostr", "webtorrent"]);
  rooms[0].action.onMessage({ signature: "same", value: 1 }, { peerId: "peer-a" });
  rooms[1].action.onMessage({ signature: "same", value: 1 }, { peerId: "peer-a" });
  assert.equal(received.length, 1);
  await transport.send({ signature: "outbound" }, "peer-b");
  assert.equal(rooms.every((room) => room.action.sent.length === 1), true);
  transport.close();
  assert.equal(rooms.every((room) => room.left), true);
});
