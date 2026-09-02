import { validatePendingActivity } from "@echo-town/offline-runtime";

const INPUT_KEYS = new Set([
  "worldId", "zoneId", "senderActorId", "messageId", "logicalTime", "activity", "privateContext",
]);
const ENVELOPE_KEYS = new Set([
  "schemaVersion", "messageType", "worldId", "zoneId", "senderActorId", "messageId", "logicalTime", "activity",
]);

export const PUBLIC_WIRE_FIELD_PATHS = Object.freeze([
  "activity.actorId",
  "activity.id",
  "activity.kind",
  "activity.logicalTime",
  "activity.publicProjection.eventType",
  "activity.publicProjection.placeId",
  "activity.schemaVersion",
  "activity.sourceEventIds",
  "logicalTime",
  "messageId",
  "messageType",
  "schemaVersion",
  "senderActorId",
  "worldId",
  "zoneId",
]);

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function identifier(value, maximum = 96) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && /^[a-zA-Z0-9:_-]+$/.test(value);
}

function sensitiveStrings(value, output = []) {
  if (typeof value === "string" && value.length >= 8) output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => sensitiveStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => sensitiveStrings(item, output));
  return output;
}

export function enumerateWireFieldPaths(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) paths.push(...enumerateWireFieldPaths(child, path));
    else paths.push(path);
  }
  return paths.sort();
}

export function createPublicActivityEnvelope(input) {
  if (!exactObject(input, INPUT_KEYS)) throw new Error("网络 gate 输入字段非法");
  if (!identifier(input.worldId) || !identifier(input.zoneId) || !identifier(input.senderActorId)
    || !identifier(input.messageId) || !Number.isInteger(input.logicalTime) || input.logicalTime < 0
    || !input.privateContext || typeof input.privateContext !== "object" || Array.isArray(input.privateContext)) {
    throw new Error("网络 gate 输入值非法");
  }
  const activity = validatePendingActivity(input.activity);
  if (activity.actorId !== input.senderActorId || activity.logicalTime !== input.logicalTime) {
    throw new Error("网络 gate 活动身份或逻辑时间不一致");
  }
  const envelope = {
    schemaVersion: 1,
    messageType: "public_activity",
    worldId: input.worldId,
    zoneId: input.zoneId,
    senderActorId: input.senderActorId,
    messageId: input.messageId,
    logicalTime: input.logicalTime,
    activity,
  };
  const actualFields = enumerateWireFieldPaths(envelope);
  if (JSON.stringify(actualFields) !== JSON.stringify(PUBLIC_WIRE_FIELD_PATHS)) {
    throw new Error("网络协议字段全集偏离允许集合");
  }
  const serialized = JSON.stringify(envelope);
  if (sensitiveStrings(input.privateContext).some((secret) => serialized.includes(secret))) {
    throw new Error("网络 gate 检测到私人上下文进入公开协议");
  }
  return envelope;
}

export class PrivacyNetworkGate {
  constructor({ endpoint = "./__echo-town-sync", fetchImpl = (...args) => globalThis.fetch(...args), baseUrl = globalThis.location?.href } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("网络 transport 不可用");
    if (!baseUrl) throw new Error("网络 endpoint 缺少基准 URL");
    this.endpoint = new URL(endpoint, baseUrl).href;
    this.fetchImpl = fetchImpl;
  }

  async sendPublicActivity(input) {
    const envelope = createPublicActivityEnvelope(input);
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-echo-town-protocol": "public-activity-v1",
      },
      body: JSON.stringify(envelope),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`公开活动发送失败：HTTP ${response.status}`);
    return { envelope, status: response.status };
  }
}
