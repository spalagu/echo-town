const THRESHOLDS = Object.freeze({
  fullDay1RetentionMinimum: 0.70,
  fullDay7RetentionMinimum: 0.40,
  fullFirstWeekActiveDaysMedianMinimum: 4,
  fullStoryRecallRateMinimum: 0.70,
  day7LiftMinimum: 0.15,
});
const PARTICIPANT_KEYS = new Set(["id", "informedConsent", "adult"]);
const RECORD_KEYS = new Set(["participantId", "activeDays", "recalledStoryFactCount"]);

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function participantId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{5,63}$/u.test(value);
}

function stableScore(seed, value) {
  let hash = 2166136261;
  for (const character of `${seed}:${value}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function createStudyPlan({ studyId, preregisteredAt, randomizationSeed, participants }) {
  if (!participantId(studyId) || typeof preregisteredAt !== "string" || !Number.isFinite(Date.parse(preregisteredAt))
    || !Number.isInteger(randomizationSeed) || !Array.isArray(participants) || participants.length !== 40
    || participants.some((item) => !exactObject(item, PARTICIPANT_KEYS) || !participantId(item.id)
      || item.informedConsent !== true || item.adult !== true)
    || new Set(participants.map((item) => item.id)).size !== 40) {
    throw new Error("AP-19 研究计划必须包含 40 名已知情同意的成年匿名参与者");
  }
  const ordered = [...participants].sort((left, right) => stableScore(randomizationSeed, left.id) - stableScore(randomizationSeed, right.id)
    || left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    studyId,
    preregisteredAt,
    durationDays: 14,
    arms: {
      full: ordered.slice(0, 20).map((item) => item.id),
      ablation: ordered.slice(20).map((item) => item.id),
    },
    ablations: ["relationship", "mystery", "scarcity", "contribution"],
    thresholds: { ...THRESHOLDS },
    allowedRecordFields: [...RECORD_KEYS],
    rawPrivateMemoryAllowed: false,
  };
}

function armMetrics(ids, recordById) {
  const records = ids.map((id) => recordById.get(id));
  return {
    participants: records.length,
    day1RetentionRate: records.filter((item) => item.activeDays.includes(1)).length / records.length,
    day7RetentionRate: records.filter((item) => item.activeDays.includes(7)).length / records.length,
    firstWeekActiveDaysMedian: median(records.map((item) => item.activeDays.filter((day) => day >= 0 && day <= 6).length)),
    storyRecallRate: records.filter((item) => item.recalledStoryFactCount >= 2).length / records.length,
  };
}

export function evaluateStudy(plan, records) {
  const assignedIds = [...plan.arms.full, ...plan.arms.ablation];
  if (plan.schemaVersion !== 1 || plan.durationDays !== 14 || assignedIds.length !== 40
    || plan.rawPrivateMemoryAllowed !== false || JSON.stringify(plan.allowedRecordFields) !== JSON.stringify([...RECORD_KEYS])
    || !Array.isArray(records) || records.length !== 40 || records.some((item) => !exactObject(item, RECORD_KEYS)
      || !assignedIds.includes(item.participantId) || !Array.isArray(item.activeDays)
      || item.activeDays.some((day) => !Number.isInteger(day) || day < 0 || day > 13)
      || new Set(item.activeDays).size !== item.activeDays.length
      || !Number.isInteger(item.recalledStoryFactCount) || item.recalledStoryFactCount < 0 || item.recalledStoryFactCount > 20)
    || new Set(records.map((item) => item.participantId)).size !== 40) {
    throw new Error("AP-19 只接受 40 条匿名最小行为记录，禁止原始私人记忆或额外字段");
  }
  const recordById = new Map(records.map((item) => [item.participantId, item]));
  const full = armMetrics(plan.arms.full, recordById);
  const ablation = armMetrics(plan.arms.ablation, recordById);
  const day7Lift = full.day7RetentionRate - ablation.day7RetentionRate;
  const checks = {
    fullDay1Retention: full.day1RetentionRate >= THRESHOLDS.fullDay1RetentionMinimum,
    fullDay7Retention: full.day7RetentionRate >= THRESHOLDS.fullDay7RetentionMinimum,
    fullFirstWeekActiveDaysMedian: full.firstWeekActiveDaysMedian >= THRESHOLDS.fullFirstWeekActiveDaysMedianMinimum,
    fullStoryRecall: full.storyRecallRate >= THRESHOLDS.fullStoryRecallRateMinimum,
    day7Lift: day7Lift >= THRESHOLDS.day7LiftMinimum,
  };
  return {
    schemaVersion: 1,
    studyId: plan.studyId,
    sampleSize: 40,
    full,
    ablation,
    day7Lift,
    checks,
    passed: Object.values(checks).every(Boolean),
    containsRawPrivateMemory: false,
  };
}

export { THRESHOLDS };
