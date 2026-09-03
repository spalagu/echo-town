import {
  actorIdFromPublicKey,
  canonicalJson,
  sign,
  verifyPublicSignature,
} from "@echo-town/identity-vault";
import { createPublicActivityEnvelope, validatePublicActivityEnvelope } from "@echo-town/privacy-network";

const REGISTRY_KEYS = new Set(["schemaVersion", "policy", "strategies"]);
const POLICY_KEYS = new Set(["projectOperatedNodes", "serverAuthority", "privatePayloadsAllowed", "directFailure"]);
const STRATEGY_KEYS = new Set(["id", "protocol", "role", "endpoints"]);
const ENDPOINT_KEYS = new Set(["id", "operator", "url", "source"]);
const PROPOSAL_KEYS = new Set(["schemaVersion", "worldId", "zoneId", "epoch", "authorityId", "issuedAtLogical", "expiresAtLogical"]);
const VOTE_KEYS = new Set(["schemaVersion", "voterId", "voterPublicKey", "proposal", "signature"]);
const CERTIFICATE_KEYS = new Set(["schemaVersion", "proposal", "votes"]);
const ENVELOPE_KEYS = new Set([
  "schemaVersion", "messageType", "worldId", "zoneId", "epoch", "sequence", "senderActorId",
  "senderPublicKey", "previousStateHash", "stateHash", "sentAtLogical", "activities", "events", "lease", "signature",
]);
const EVENT_KEYS = new Set([
  "schemaVersion", "worldId", "zoneId", "epoch", "eventSeq", "previousStateHash", "acceptedIntentHash",
  "eventType", "actorId", "payload", "nextStateHash", "authorityId",
]);
const SNAPSHOT_KEYS = new Set(["schemaVersion", "worldId", "zoneId", "epoch", "stateHash", "committee", "activities", "events", "sequences"]);
const HASH = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[a-zA-Z0-9:_-]+$/u;

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function identifier(value, maximum = 96) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && IDENTIFIER.test(value);
}

function text(value, maximum = 200) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function integer(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function clone(value) {
  return structuredClone(value);
}

export function validatePublicNodeRegistry(registry) {
  if (!exactObject(registry, REGISTRY_KEYS) || registry.schemaVersion !== 1
    || !exactObject(registry.policy, POLICY_KEYS)
    || registry.policy.projectOperatedNodes !== false || registry.policy.serverAuthority !== false
    || registry.policy.privatePayloadsAllowed !== false || registry.policy.directFailure !== "explicit_offline"
    || !Array.isArray(registry.strategies) || registry.strategies.length !== 2) {
    throw new Error("公共节点 registry 策略非法");
  }
  const protocols = new Set();
  const endpointIds = new Set();
  for (const strategy of registry.strategies) {
    if (!exactObject(strategy, STRATEGY_KEYS) || !identifier(strategy.id)
      || !["nostr", "webtorrent"].includes(strategy.protocol)
      || !["primary", "backup"].includes(strategy.role) || protocols.has(strategy.protocol)
      || !Array.isArray(strategy.endpoints)) throw new Error("公共节点策略非法");
    protocols.add(strategy.protocol);
    const minimum = strategy.protocol === "nostr" ? 3 : 2;
    if (strategy.endpoints.length < minimum) throw new Error("公共节点运营者数量不足");
    const operators = new Set();
    const hosts = new Set();
    for (const endpoint of strategy.endpoints) {
      if (!exactObject(endpoint, ENDPOINT_KEYS) || !identifier(endpoint.id) || !text(endpoint.operator, 80)
        || endpointIds.has(endpoint.id) || !text(endpoint.source)) throw new Error("公共节点条目非法");
      let url;
      try { url = new URL(endpoint.url); } catch { throw new Error("公共节点 URL 非法"); }
      if (url.protocol !== "wss:" || !url.hostname || /(^|\.)echo-town(?:\.|$)/iu.test(url.hostname)
        || operators.has(endpoint.operator) || hosts.has(url.hostname)) throw new Error("公共节点必须使用独立第三方 WSS 运营者");
      endpointIds.add(endpoint.id);
      operators.add(endpoint.operator);
      hosts.add(url.hostname);
    }
  }
  if (!protocols.has("nostr") || !protocols.has("webtorrent")) throw new Error("公共节点缺少双信令策略");
  return clone(registry);
}

export function createLeaseProposal({ worldId, zoneId, epoch, authorityId, issuedAtLogical, expiresAtLogical }) {
  const proposal = { schemaVersion: 1, worldId, zoneId, epoch, authorityId, issuedAtLogical, expiresAtLogical };
  if (!exactObject(proposal, PROPOSAL_KEYS) || !identifier(worldId) || !identifier(zoneId) || !identifier(authorityId)
    || !integer(epoch, 1) || !integer(issuedAtLogical) || !integer(expiresAtLogical, issuedAtLogical + 1)) {
    throw new Error("authority lease proposal 非法");
  }
  return proposal;
}

export async function signLeaseVote(identity, proposal) {
  const checked = createLeaseProposal(proposal);
  return {
    schemaVersion: 1,
    voterId: identity.actorId,
    voterPublicKey: identity.publicKey,
    proposal: checked,
    signature: await sign(identity, checked),
  };
}

export function createLeaseCertificate(proposal, votes) {
  const checked = createLeaseProposal(proposal);
  if (!Array.isArray(votes) || votes.length === 0) throw new Error("authority lease votes 非法");
  return { schemaVersion: 1, proposal: checked, votes: votes.map(clone) };
}

export async function verifyLeaseCertificate(certificate, { committee, logicalTime }) {
  if (!exactObject(certificate, CERTIFICATE_KEYS) || certificate.schemaVersion !== 1
    || !Array.isArray(committee) || committee.length < 3 || new Set(committee).size !== committee.length
    || !integer(logicalTime)) throw new Error("authority lease certificate 非法");
  const proposal = createLeaseProposal(certificate.proposal);
  if (logicalTime < proposal.issuedAtLogical || logicalTime >= proposal.expiresAtLogical) throw new Error("authority lease 已过期或尚未生效");
  const accepted = new Set();
  for (const vote of certificate.votes) {
    if (!exactObject(vote, VOTE_KEYS) || vote.schemaVersion !== 1 || !identifier(vote.voterId)
      || typeof vote.voterPublicKey !== "string" || canonicalJson(vote.proposal) !== canonicalJson(proposal)
      || !committee.includes(vote.voterId) || accepted.has(vote.voterId)
      || await actorIdFromPublicKey(Uint8Array.from(atob(vote.voterPublicKey), (value) => value.charCodeAt(0))) !== vote.voterId
      || !await verifyPublicSignature(vote.voterPublicKey, proposal, vote.signature)) {
      throw new Error("authority lease vote 非法");
    }
    accepted.add(vote.voterId);
  }
  if (accepted.size < Math.ceil((committee.length * 2) / 3)) throw new Error("authority lease 未达到 2/3 法定人数");
  return clone(certificate);
}

function validateWorldEvent(event) {
  if (!exactObject(event, EVENT_KEYS) || event.schemaVersion !== 1 || !identifier(event.worldId)
    || !identifier(event.zoneId) || !integer(event.epoch, 1) || !integer(event.eventSeq, 1)
    || !HASH.test(event.previousStateHash) || !HASH.test(event.acceptedIntentHash)
    || !identifier(event.eventType) || !identifier(event.actorId) || !identifier(event.authorityId)
    || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)
    || !HASH.test(event.nextStateHash)) throw new Error("WorldEvent 同步载荷非法");
  return clone(event);
}

function signingEnvelope(envelope) {
  const { signature: _signature, ...payload } = envelope;
  return payload;
}

function validateEnvelopeShape(envelope) {
  if (!exactObject(envelope, ENVELOPE_KEYS) || envelope.schemaVersion !== 1 || envelope.messageType !== "world_sync_batch"
    || !identifier(envelope.worldId) || !identifier(envelope.zoneId) || !integer(envelope.epoch, 1)
    || !integer(envelope.sequence, 1) || !identifier(envelope.senderActorId) || typeof envelope.senderPublicKey !== "string"
    || !HASH.test(envelope.previousStateHash) || !HASH.test(envelope.stateHash) || !integer(envelope.sentAtLogical)
    || !Array.isArray(envelope.activities) || envelope.activities.length > 64
    || !Array.isArray(envelope.events) || envelope.events.length > 64
    || (envelope.lease !== null && typeof envelope.lease !== "object") || typeof envelope.signature !== "string") {
    throw new Error("World Sync envelope 非法");
  }
  const activities = envelope.activities.map(validatePublicActivityEnvelope);
  const events = envelope.events.map(validateWorldEvent);
  if (activities.length === 0 && events.length === 0) throw new Error("World Sync envelope 不得为空");
  if (events.length > 0 && envelope.lease === null) throw new Error("权威事件缺少 lease");
  if (events.length === 0 && envelope.lease !== null) throw new Error("可合并活动不得夹带 lease");
  return { ...clone(envelope), activities, events };
}

export async function createSignedWorldSyncEnvelope(identity, input) {
  const envelope = validateEnvelopeShape({
    schemaVersion: 1,
    messageType: "world_sync_batch",
    worldId: input.worldId,
    zoneId: input.zoneId,
    epoch: input.epoch,
    sequence: input.sequence,
    senderActorId: identity.actorId,
    senderPublicKey: identity.publicKey,
    previousStateHash: input.previousStateHash,
    stateHash: input.stateHash,
    sentAtLogical: input.sentAtLogical,
    activities: input.activities ?? [],
    events: input.events ?? [],
    lease: input.lease ?? null,
    signature: "pending",
  });
  envelope.signature = await sign(identity, signingEnvelope(envelope));
  return envelope;
}

export async function verifySignedWorldSyncEnvelope(value) {
  const envelope = validateEnvelopeShape(value);
  const publicKeyBytes = Uint8Array.from(atob(envelope.senderPublicKey), (character) => character.charCodeAt(0));
  if (await actorIdFromPublicKey(publicKeyBytes) !== envelope.senderActorId
    || !await verifyPublicSignature(envelope.senderPublicKey, signingEnvelope(envelope), envelope.signature)) {
    throw new Error("World Sync 签名或 actorId 非法");
  }
  if (envelope.activities.some((activity) => activity.senderActorId !== envelope.senderActorId)) {
    throw new Error("World Sync 不得代签其他 actor 的公开活动");
  }
  return envelope;
}

export class WorldSyncReplica {
  constructor({ worldId, zoneId, initialStateHash, committee, snapshot = null }) {
    if (!identifier(worldId) || !identifier(zoneId) || !HASH.test(initialStateHash)
      || !Array.isArray(committee) || committee.length < 1 || new Set(committee).size !== committee.length
      || committee.some((actorId) => !identifier(actorId))) {
      throw new Error("World Sync replica 初始化非法");
    }
    this.worldId = worldId;
    this.zoneId = zoneId;
    this.committee = uniqueSorted(committee);
    this.stateHash = initialStateHash;
    this.epoch = 1;
    this.activities = new Map();
    this.events = [];
    this.sequences = new Map();
    this.signatures = new Set();
    if (snapshot !== null) this.restore(snapshot, initialStateHash);
  }

  restore(snapshot, initialStateHash) {
    if (!exactObject(snapshot, SNAPSHOT_KEYS) || snapshot.schemaVersion !== 1 || snapshot.worldId !== this.worldId
      || snapshot.zoneId !== this.zoneId || !integer(snapshot.epoch, 1) || !HASH.test(snapshot.stateHash)
      || !Array.isArray(snapshot.committee) || snapshot.committee.length < 1 || new Set(snapshot.committee).size !== snapshot.committee.length
      || snapshot.committee.some((actorId) => !identifier(actorId)) || !Array.isArray(snapshot.activities) || !Array.isArray(snapshot.events)
      || !snapshot.sequences || typeof snapshot.sequences !== "object" || Array.isArray(snapshot.sequences)) {
      throw new Error("World Sync 持久化快照非法");
    }
    const activities = snapshot.activities.map(validatePublicActivityEnvelope);
    if (new Set(activities.map((item) => item.activity.id)).size !== activities.length) throw new Error("World Sync 快照活动重复");
    const events = snapshot.events.map(validateWorldEvent);
    let previous = initialStateHash;
    events.forEach((event, index) => {
      if (event.worldId !== this.worldId || event.zoneId !== this.zoneId || event.eventSeq !== index + 1
        || event.previousStateHash !== previous) throw new Error("World Sync 快照事件链非法");
      previous = event.nextStateHash;
    });
    if ((events.length > 0 ? previous : initialStateHash) !== snapshot.stateHash) throw new Error("World Sync 快照状态哈希未闭合");
    const sequences = Object.entries(snapshot.sequences);
    if (sequences.some(([actorId, sequence]) => !identifier(actorId) || !integer(sequence, 1))) throw new Error("World Sync 快照 sequence 非法");
    this.epoch = snapshot.epoch;
    this.stateHash = snapshot.stateHash;
    this.committee = uniqueSorted(snapshot.committee);
    this.activities = new Map(activities.map((item) => [item.activity.id, item]));
    this.events = events;
    this.sequences = new Map(sequences);
  }

  setCommittee(actorIds) {
    if (!Array.isArray(actorIds) || actorIds.length < 1 || new Set(actorIds).size !== actorIds.length
      || actorIds.some((actorId) => !identifier(actorId))) throw new Error("World Sync committee 非法");
    const next = uniqueSorted(actorIds);
    if (this.events.length > 0 && canonicalJson(next) !== canonicalJson(this.committee)) {
      throw new Error("已有权威事件后不得无 lease 更换 committee");
    }
    this.committee = next;
    return [...this.committee];
  }

  async ingest(value) {
    const envelope = await verifySignedWorldSyncEnvelope(value);
    if (envelope.worldId !== this.worldId || envelope.zoneId !== this.zoneId) throw new Error("World Sync 串 world/zone");
    if (this.signatures.has(envelope.signature)) return { status: "duplicate", snapshot: this.snapshot() };
    const expectedSequence = (this.sequences.get(envelope.senderActorId) ?? 0) + 1;
    if (envelope.sequence !== expectedSequence) throw new Error("World Sync sequence 丢失或重放");
    if (envelope.events.length > 0) {
      await verifyLeaseCertificate(envelope.lease, { committee: this.committee, logicalTime: envelope.sentAtLogical });
      const proposal = envelope.lease.proposal;
      if (proposal.worldId !== this.worldId || proposal.zoneId !== this.zoneId || proposal.epoch !== envelope.epoch
        || proposal.authorityId !== envelope.senderActorId || envelope.epoch < this.epoch
        || envelope.previousStateHash !== this.stateHash) throw new Error("World Sync authority/epoch/state 前置条件非法");
      let previous = this.stateHash;
      let expectedEventSequence = this.events.length + 1;
      for (const event of envelope.events) {
        if (event.worldId !== this.worldId || event.zoneId !== this.zoneId || event.epoch !== envelope.epoch
          || event.authorityId !== envelope.senderActorId || event.previousStateHash !== previous
          || event.eventSeq !== expectedEventSequence) throw new Error("WorldEvent 链或 authority 非法");
        previous = event.nextStateHash;
        expectedEventSequence += 1;
      }
      if (previous !== envelope.stateHash) throw new Error("World Sync state hash 未闭合");
      this.events.push(...envelope.events.map(clone));
      this.stateHash = envelope.stateHash;
      this.epoch = envelope.epoch;
    } else if (envelope.previousStateHash !== this.stateHash || envelope.stateHash !== this.stateHash) {
      throw new Error("可合并活动不得伪造世界状态变化");
    }
    for (const activityEnvelope of envelope.activities) {
      const id = activityEnvelope.activity.id;
      const existing = this.activities.get(id);
      if (existing && canonicalJson(existing) !== canonicalJson(activityEnvelope)) throw new Error("同 ID 公开活动发生冲突");
      this.activities.set(id, clone(activityEnvelope));
    }
    this.sequences.set(envelope.senderActorId, envelope.sequence);
    this.signatures.add(envelope.signature);
    return { status: "accepted", snapshot: this.snapshot() };
  }

  snapshot() {
    return {
      schemaVersion: 1,
      worldId: this.worldId,
      zoneId: this.zoneId,
      epoch: this.epoch,
      stateHash: this.stateHash,
      committee: [...this.committee],
      activities: [...this.activities.values()].sort((left, right) => left.activity.id.localeCompare(right.activity.id)).map(clone),
      events: this.events.map(clone),
      sequences: Object.fromEntries([...this.sequences.entries()].sort(([left], [right]) => left.localeCompare(right))),
    };
  }
}

export class MemoryWorldSyncStore {
  constructor(value = null) { this.value = value === null ? null : clone(value); }
  async get() { return this.value === null ? null : clone(this.value); }
  async set(value) { this.value = clone(value); }
}

export class IndexedDbWorldSyncStore {
  constructor({ databaseName = "echo-town-world-sync", storeName = "replicas", key = "center-v1" } = {}) {
    this.databaseName = databaseName;
    this.storeName = storeName;
    this.key = key;
  }

  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(this.storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async transaction(mode, operation) {
    const database = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(this.storeName, mode);
        const request = operation(transaction.objectStore(this.storeName));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  }

  get() { return this.transaction("readonly", (store) => store.get(this.key)); }
  set(value) { return this.transaction("readwrite", (store) => store.put(clone(value), this.key)); }
}

export class PublicWorldSyncSession {
  constructor({ identity, registry, replica, roomId, openTransport, onSnapshot = async () => {}, onStatus = () => {} }) {
    validatePublicNodeRegistry(registry);
    if (!identity || !replica || !identifier(roomId, 128) || typeof openTransport !== "function"
      || typeof onSnapshot !== "function" || typeof onStatus !== "function") throw new Error("World Sync session 初始化非法");
    this.identity = identity;
    this.registry = clone(registry);
    this.replica = replica;
    this.roomId = roomId;
    this.openTransport = openTransport;
    this.onSnapshot = onSnapshot;
    this.onStatus = onStatus;
    this.sequence = 0;
    this.received = [];
    this.errors = [];
    this.joinedPeers = new Set();
    this.knownActors = new Set(replica.committee);
    this.transport = null;
  }

  async start() {
    if (this.transport) return this.status();
    this.transport = await this.openTransport({
      registry: this.registry,
      roomId: this.roomId,
      onMessage: async (message, context) => {
        try {
          const result = await this.replica.ingest(message);
          if (result.status === "accepted") {
            this.knownActors.add(message.senderActorId);
            if (this.replica.snapshot().events.length === 0) this.replica.setCommittee([...this.knownActors]);
            this.received.push({ actorId: message.senderActorId, peerId: context.peerId, at: performance.now() });
            await this.onSnapshot(this.replica.snapshot());
            this.onStatus(this.status());
          }
        } catch (error) { this.errors.push(error.message); this.onStatus(this.status()); }
      },
      onPeerJoin: (peerId) => {
        if (this.joinedPeers.has(peerId)) return;
        this.joinedPeers.add(peerId);
        this.onStatus(this.status());
        this.sendPresence(peerId).catch((error) => this.errors.push(error.message));
      },
      onPeerLeave: (peerId) => {
        this.joinedPeers.delete(peerId);
        this.onStatus(this.status());
      },
    });
    this.onStatus(this.status());
    return this.status();
  }

  async sendPresence(target) {
    if (!this.transport) throw new Error("World Sync 尚未启动");
    const logicalTime = this.sequence + 1;
    const activity = createPublicActivityEnvelope({
      worldId: this.replica.worldId,
      zoneId: this.replica.zoneId,
      senderActorId: this.identity.actorId,
      messageId: `presence:${this.identity.actorId}:${logicalTime}`,
      logicalTime,
      activity: {
        schemaVersion: 1,
        id: `presence:${this.identity.actorId}:${logicalTime}`,
        actorId: this.identity.actorId,
        kind: "mergeable_local",
        sourceEventIds: [`presence:${logicalTime}`],
        logicalTime,
        publicProjection: { eventType: "PeerPresent", placeId: "town-square" },
      },
      privateContext: {},
    });
    return this.sendBatch({ activities: [activity], logicalTime, target });
  }

  async sendBatch({ activities = [], events = [], lease = null, epoch, stateHash, logicalTime, target } = {}) {
    if (!this.transport) throw new Error("World Sync 尚未启动");
    this.sequence += 1;
    const snapshot = this.replica.snapshot();
    const envelope = await createSignedWorldSyncEnvelope(this.identity, {
      worldId: snapshot.worldId,
      zoneId: snapshot.zoneId,
      epoch: epoch ?? snapshot.epoch,
      sequence: this.sequence,
      previousStateHash: snapshot.stateHash,
      stateHash: stateHash ?? snapshot.stateHash,
      sentAtLogical: logicalTime ?? this.sequence,
      activities,
      events,
      lease,
    });
    const result = await this.replica.ingest(envelope);
    await this.onSnapshot(result.snapshot);
    await this.transport.send(envelope, target);
    this.onStatus(this.status());
    return envelope;
  }

  status() {
    return {
      started: Boolean(this.transport),
      strategies: this.transport?.strategyStatus?.() ?? this.transport?.strategies ?? [],
      received: clone(this.received),
      errors: [...this.errors],
      snapshot: this.replica.snapshot(),
    };
  }

  close() {
    this.transport?.close();
    this.transport = null;
  }
}
