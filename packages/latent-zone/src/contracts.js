const PACK_KEYS = new Set([
  "schemaVersion", "packType", "id", "title", "license", "attribution", "zoneId",
  "initialReachability", "thresholdAlternatives", "evidenceAffordances", "onSatisfied",
  "eventPool", "publicProjection",
]);
const ATTRIBUTION_KEYS = new Set(["author", "source", "modified"]);
const ALTERNATIVE_KEYS = new Set([
  "id", "artifactStates", "worldPredicates", "socialPredicates", "actionSequence",
]);
const OUTCOME_KEYS = new Set(["revealEdges", "locationStateChanges", "eventPoolAdds"]);
const EDGE_KEYS = new Set(["from", "to", "bidirectional"]);
const LOCATION_CHANGE_KEYS = new Set(["locationId", "state"]);
const EVIDENCE_KEYS = new Set(["triggerId", "factorKind", "factorValue", "sourceEventIds", "publicFeedback"]);
const EVENT_POOL_KEYS = new Set(["id", "phenomena", "actionAffordances"]);
const PUBLIC_KEYS = new Set(["phenomenonId", "phenomena", "observableActions", "feedbackClasses"]);
const IDENTIFIER = /^[a-z][a-z0-9-]{2,63}$/u;
const ACTION = /^[a-z][a-z0-9_]{1,47}$/u;
const FORBIDDEN_ACTION_TOKEN = /(?:answer|complete|ending|final|finish|goal|hidden|key|must|next|progress|quest|recipe|required|reveal|solution|solve|step|unlock)/u;
const PREDICATE = /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9-]{0,63}$/u;
const FORBIDDEN_KEYS = new Set([
  "answer", "solution", "formula", "recipe", "key", "keyitem", "keylabel", "progress",
  "progresspercent", "completion", "quest", "queststep", "goal", "objective", "ending",
  "plotstage", "requiredcharacters", "assignedactorids",
]);
const FORBIDDEN_TEXT = /(?:唯一|标准|正确)(?:答案|解法|路径)|(?:钥匙|配方|进度条|终章|预定结局)|(?:必须|只需).{0,12}(?:依次|集齐|按顺序)|(?:入口|空间).{0,12}(?:就在|位于)|所有.{0,8}(?:永久|必须).{0,12}(?:留在|进入)|canonical\s*(?:answer|solution)|only\s+(?:answer|solution|path)/iu;
const PROGRESS_HINT_TEXT = /(?:还|尚|仍)(?:缺少?|差)|(?:下一步|再完成|再找到|再等到)|\b(?:missing|required|next|need)\b/iu;
const SEMANTIC_LEAK_TEXT = /(?:当|若|如果|只要|每逢).{0,120}(?:先.{0,40}再|依次|随后).{0,120}(?:显现|开启|出现|进入|靠近)|先.{0,40}再.{0,80}(?:便|就|会|可).{0,20}(?:显现|开启|出现|进入|靠近)|(?:若|如果|要是).{0,80}(?:没有|未曾|未能|不曾|缺少?).{0,80}(?:不会|不能|无法|不再)|只有.{0,80}才|(?:最终|终将|必将|都会).{0,120}(?:迁居|留在|进入|消失|定居|结束|收束)|(?:故事|一切).{0,30}(?:在此|至此).{0,20}(?:收束|结束|定局)|\b(?:if|when|unless|only if).{0,120}(?:then|before|after).{0,120}(?:reveal|open|appear|enter)|\b(?:eventually|destined|predetermined).{0,100}(?:ending|end|settle|remain)/iu;
const LOCAL_MIND_SAFE_PHENOMENA = Object.freeze([
  "一些公开记录彼此不一致，原因尚无定论。",
  "角色可以观察、交谈、尝试，也可以暂时不处理。",
]);

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function text(value, maximum = 320) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function uniqueStrings(value, minimum, maximum, pattern, maximumLength = 96) {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum
    && value.every((item) => text(item, maximumLength) && (!pattern || pattern.test(item)))
    && new Set(value).size === value.length;
}

function safeAction(value) {
  return ACTION.test(value) && !FORBIDDEN_ACTION_TOKEN.test(value.replaceAll("_", ""));
}

function rejectHiddenRecipe(value, coordinate = "root") {
  if (typeof value === "string") {
    const compact = value.normalize("NFKC").replace(/[\p{P}\p{S}\p{Cf}\s]+/gu, "");
    if (FORBIDDEN_TEXT.test(value) || FORBIDDEN_TEXT.test(compact)) throw new Error(`${coordinate} 泄露配方、钥匙或唯一入口`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => rejectHiddenRecipe(item, `${coordinate}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLocaleLowerCase())) throw new Error(`${coordinate}.${key} 是禁止的配方、进度或剧情字段`);
    rejectHiddenRecipe(child, `${coordinate}.${key}`);
  }
}

export function validateLatentZonePack(value, coordinate = "LatentZonePack") {
  if (!exactObject(value, PACK_KEYS) || value.schemaVersion !== 1 || value.packType !== "latent-zone"
    || !IDENTIFIER.test(value.id) || !text(value.title, 80) || value.license !== "CC-BY-4.0"
    || !exactObject(value.attribution, ATTRIBUTION_KEYS) || !text(value.attribution.author, 120)
    || !text(value.attribution.source, 200) || typeof value.attribution.modified !== "boolean"
    || !IDENTIFIER.test(value.zoneId) || value.initialReachability !== "latent"
    || !Array.isArray(value.thresholdAlternatives) || value.thresholdAlternatives.length < 2
    || value.thresholdAlternatives.length > 8
    || !exactObject(value.onSatisfied, OUTCOME_KEYS) || !exactObject(value.publicProjection, PUBLIC_KEYS)) {
    throw new Error(`${coordinate} 不符合 LatentZonePack v1`);
  }
  const alternativeIds = new Set();
  const signatures = new Set();
  for (const [index, alternative] of value.thresholdAlternatives.entries()) {
    if (!exactObject(alternative, ALTERNATIVE_KEYS) || !IDENTIFIER.test(alternative.id)
      || !uniqueStrings(alternative.artifactStates, 1, 8, PREDICATE)
      || !uniqueStrings(alternative.worldPredicates, 1, 8, PREDICATE)
      || !uniqueStrings(alternative.socialPredicates, 1, 8, PREDICATE)
      || !uniqueStrings(alternative.actionSequence, 2, 8, ACTION)
      || alternative.actionSequence.some((action) => !safeAction(action))) {
      throw new Error(`${coordinate}.thresholdAlternatives[${index}] 不符合多因素阈值契约`);
    }
    if (alternativeIds.has(alternative.id)) throw new Error(`${coordinate} 阈值 id 重复`);
    alternativeIds.add(alternative.id);
    const signature = JSON.stringify([
      [...alternative.artifactStates].sort(),
      [...alternative.worldPredicates].sort(),
      [...alternative.socialPredicates].sort(),
      alternative.actionSequence,
    ]);
    if (signatures.has(signature)) throw new Error(`${coordinate} 含重复阈值路径`);
    signatures.add(signature);
  }
  const factorValues = value.thresholdAlternatives.flatMap((alternative) => [
    ...alternative.artifactStates,
    ...alternative.worldPredicates,
    ...alternative.socialPredicates,
    ...alternative.actionSequence,
  ]);
  if (!Array.isArray(value.evidenceAffordances) || value.evidenceAffordances.length < factorValues.length
    || value.evidenceAffordances.length > 64
    || value.evidenceAffordances.some((item) => !exactObject(item, EVIDENCE_KEYS)
      || !IDENTIFIER.test(item.triggerId)
      || !["artifact", "world", "social", "action"].includes(item.factorKind)
      || !(item.factorKind === "action" ? ACTION : PREDICATE).test(item.factorValue)
      || (item.factorKind === "action" && !safeAction(item.factorValue))
      || !uniqueStrings(item.sourceEventIds, 1, 8)
      || !text(item.publicFeedback, 200))
    || new Set(value.evidenceAffordances.map((item) => item.triggerId)).size !== value.evidenceAffordances.length
    || factorValues.some((factor) => !value.evidenceAffordances.some((item) => item.factorValue === factor))) {
    throw new Error(`${coordinate}.evidenceAffordances 不符合有来源因子契约`);
  }
  if (!Array.isArray(value.onSatisfied.revealEdges) || value.onSatisfied.revealEdges.length === 0
    || value.onSatisfied.revealEdges.some((edge) => !exactObject(edge, EDGE_KEYS) || !IDENTIFIER.test(edge.from)
      || edge.to !== value.zoneId || typeof edge.bidirectional !== "boolean")
    || !Array.isArray(value.onSatisfied.locationStateChanges) || value.onSatisfied.locationStateChanges.length === 0
    || value.onSatisfied.locationStateChanges.some((change) => !exactObject(change, LOCATION_CHANGE_KEYS)
      || !IDENTIFIER.test(change.locationId) || !IDENTIFIER.test(change.state))
    || !uniqueStrings(value.onSatisfied.eventPoolAdds, 1, 16, IDENTIFIER)) {
    throw new Error(`${coordinate}.onSatisfied 不符合原子世界差分契约`);
  }
  if (!Array.isArray(value.eventPool) || value.eventPool.length === 0 || value.eventPool.length > 16
    || value.eventPool.some((event) => !exactObject(event, EVENT_POOL_KEYS) || !IDENTIFIER.test(event.id)
      || !uniqueStrings(event.phenomena, 1, 8, null, 240)
      || !uniqueStrings(event.actionAffordances, 2, 12, ACTION)
      || event.actionAffordances.some((action) => !safeAction(action)))
    || new Set(value.eventPool.map((event) => event.id)).size !== value.eventPool.length
    || value.onSatisfied.eventPoolAdds.some((id) => !value.eventPool.some((event) => event.id === id))) {
    throw new Error(`${coordinate}.eventPool 不符合显现后持续玩法契约`);
  }
  if (!IDENTIFIER.test(value.publicProjection.phenomenonId)
    || !uniqueStrings(value.publicProjection.phenomena, 2, 12, null, 240)
    || !uniqueStrings(value.publicProjection.observableActions, 4, 24, ACTION)
    || value.publicProjection.observableActions.some((action) => !safeAction(action))
    || JSON.stringify(value.publicProjection.feedbackClasses) !== JSON.stringify(["faint", "ambiguous", "resonant"])
    || value.thresholdAlternatives.some((alternative) => alternative.actionSequence.some(
      (action) => !value.publicProjection.observableActions.includes(action),
    ))) {
    throw new Error(`${coordinate}.publicProjection 不符合可观察投影契约`);
  }
  rejectHiddenRecipe(value, coordinate);
  const aggregate = collectStrings(value).join("");
  rejectHiddenRecipe(aggregate, `${coordinate}.aggregate`);
  const publicNarrative = [
    ...value.publicProjection.phenomena,
    ...value.evidenceAffordances.map((item) => item.publicFeedback),
  ].join(" ");
  if (PROGRESS_HINT_TEXT.test(publicNarrative) || SEMANTIC_LEAK_TEXT.test(publicNarrative)) {
    throw new Error(`${coordinate} 的公开现象或反馈提示了条件、缺项、下一步或预定结局`);
  }
  const hiddenTokens = new Set([
    value.zoneId,
    ...value.thresholdAlternatives.flatMap((alternative) => [
      ...alternative.artifactStates,
      ...alternative.worldPredicates,
      ...alternative.socialPredicates,
      ...alternative.actionSequence,
    ]),
    ...value.onSatisfied.revealEdges.flatMap((edge) => [edge.from, edge.to]),
    ...value.onSatisfied.locationStateChanges.flatMap((change) => [change.locationId, change.state]),
    ...value.onSatisfied.eventPoolAdds,
  ]);
  if ([...hiddenTokens].some((token) => publicNarrative.includes(token))) {
    throw new Error(`${coordinate} 的公开现象或反馈泄露隐藏阈值/结果标识`);
  }
  return structuredClone(value);
}

export function projectLatentZoneForLocalMind(rawPack) {
  const pack = validateLatentZonePack(rawPack);
  return {
    schemaVersion: 1,
    phenomenonId: pack.publicProjection.phenomenonId,
    phenomena: structuredClone(LOCAL_MIND_SAFE_PHENOMENA),
    observableActions: structuredClone(pack.publicProjection.observableActions),
    feedbackClasses: structuredClone(pack.publicProjection.feedbackClasses),
  };
}

function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}
