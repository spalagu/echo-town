import { validateDiscourseClaim, validateHistoricalSummary } from "./contracts.js";

export class PublicDiscourse {
  constructor(eventIds = []) {
    this.eventIds = new Set(eventIds);
    this.claims = new Map();
  }

  registerEvent(eventId) {
    if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 96) throw new Error("公开事件 id 非法");
    this.eventIds.add(eventId);
  }

  publish(rawClaim) {
    if (!rawClaim || typeof rawClaim !== "object" || Array.isArray(rawClaim) || "heat" in rawClaim || "mutationDepth" in rawClaim) {
      throw new Error("公开观点的 heat 与变形深度只能由来源图计算");
    }
    if (this.claims.has(rawClaim.id)) throw new Error("DiscourseClaim 只能追加，不能覆盖");
    if (rawClaim.sourceEventIds?.some((id) => !this.eventIds.has(id))) throw new Error("DiscourseClaim 引用了不存在的 Event");
    const parent = rawClaim.parentClaimId === null ? null : this.claims.get(rawClaim.parentClaimId);
    const refuted = rawClaim.refutesClaimId === null ? null : this.claims.get(rawClaim.refutesClaimId);
    if (rawClaim.parentClaimId !== null && !parent) throw new Error("转述来源观点不存在");
    if (rawClaim.refutesClaimId !== null && !refuted) throw new Error("反驳目标观点不存在");
    const visible = (claim) => claim.audienceActorIds.length === 0
      || claim.audienceActorIds.includes(rawClaim.speakerActorId)
      || claim.speakerActorId === rawClaim.speakerActorId;
    if (parent && !visible(parent)) throw new Error("说话者不能转述不可见观点");
    if (refuted && !visible(refuted)) throw new Error("说话者不能反驳不可见观点");
    if ((parent && parent.logicalTime > rawClaim.logicalTime) || (refuted && refuted.logicalTime > rawClaim.logicalTime)) {
      throw new Error("观点不能引用未来信息");
    }
    const value = {
      ...structuredClone(rawClaim),
      mutationDepth: parent ? parent.mutationDepth + 1 : 0,
      heat: Math.min(100, 1 + rawClaim.audienceActorIds.length * 3 + (parent ? 4 : 0) + (refuted ? 6 : 0)),
    };
    const result = validateDiscourseClaim(value);
    if (!result.ok) throw new Error(`DiscourseClaim 被拒绝：${result.reason}`);
    this.claims.set(result.value.id, result.value);
    return structuredClone(result.value);
  }

  visibleTo(actorId) {
    return [...this.claims.values()]
      .filter((claim) => claim.audienceActorIds.length === 0 || claim.audienceActorIds.includes(actorId) || claim.speakerActorId === actorId)
      .map((claim) => structuredClone(claim));
  }

  projection() {
    return [...this.claims.values()]
      .map((claim) => structuredClone(claim));
  }
}

export function createHistoricalSummary({ id, title, events, generatedAtTick }) {
  if (!Array.isArray(events) || events.length === 0 || events.some((event) => typeof event?.id !== "string" || !event.id)) {
    throw new Error("HistoricalSummary 只能读取真实 Event");
  }
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
  const result = validateHistoricalSummary(value);
  if (!result.ok) throw new Error(`HistoricalSummary 被拒绝：${result.reason}`);
  return result.value;
}
