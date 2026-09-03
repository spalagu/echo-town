export const FICTION_POLICY_ID = "echo-town-fiction-boundary-v1";
export const FICTION_NOTICE = "回声镇、其中的角色与事件均为虚构 AI 世界，不对应、仿冒或预测任何真实个人；如有相似，纯属巧合。";

const BOUNDARY_KEYS = new Set(["schemaVersion", "policyId", "fictional", "mapsRealPerson", "predictsRealPerson", "notice"]);
const FORBIDDEN_KEY_FRAGMENTS = Object.freeze([
  "biometricsource",
  "digitaltwin",
  "externalidentity",
  "identifiableperson",
  "impersonatereal",
  "mapsreal",
  "predictreal",
  "realperson",
  "realresident",
]);
const EXPLICIT_PERSON_EVIDENCE = "(?:现实|真实)(?:中|世界中)?的?(?:个人|人物|居民|市民|用户|演员|歌手|作家|运动员|政治人物|公众人物)|可识别的?(?:个人|人物|居民)|realperson|realresident|identifiableperson";
const GENERAL_PERSON_ACTION = "(?:就是|对应|映射|仿冒|冒充|假扮|还原|复刻|复制|取材于|基于|为原型|为蓝本|化身|分身|生平塑造|公开人格|数字孪生|预测|推测|估计|预言|推演|预估|digitaltwin|impersonat(?:e|es|ed|ing)|masquerad(?:e|es|ed|ing)|cop(?:y|ies|ied|ying)|basedon|model(?:l)?edafter|predict(?:s|ed|ing)?|forecast(?:s|ed|ing)?|estimat(?:e|es|ed|ing))";
const EXPLICIT_PERSON_CLAIM = new RegExp(`(?:${GENERAL_PERSON_ACTION}).{0,120}(?:${EXPLICIT_PERSON_EVIDENCE})|(?:${EXPLICIT_PERSON_EVIDENCE}).{0,120}(?:${GENERAL_PERSON_ACTION})`, "iu");
const DOUBLE_NEGATIVE_CLAIM = new RegExp(`(?:(?:不得不|不能不|doesnotavoid|cannotnot|notprohibitedto).{0,80}(?:${GENERAL_PERSON_ACTION}).{0,120}(?:${EXPLICIT_PERSON_EVIDENCE}))`, "iu");
const NAMED_PERSON_CLAIMS = Object.freeze([
  /(?:角色|人物|居民|镇长|市长|店主|医生|系统).{0,80}(?:potentialpersonname).{0,80}(?:本人|化身|分身|公开人格|生平塑造|为原型|为蓝本)/iu,
  /(?:角色|人物|居民|镇长|市长|店主|医生|系统).{0,80}(?:复刻|复制|取材于|基于|塑造).{0,80}(?:potentialpersonname)/iu,
  /(?:potentialpersonname).{0,80}(?:本人|化身|分身|公开人格|生平塑造|为原型|为蓝本)/iu,
  /(?:就是|复刻|复制|取材于|基于|塑造|本人|化身|分身|公开人格|生平塑造|为原型|为蓝本).{0,80}(?:potentialpersonname)/iu,
  /(?:character|actor|agent|resident|person).{0,80}(?:(?:impersonat(?:e|es|ed|ing)|cop(?:y|ies|ied|ying)|basedon|model(?:l)?edafter).{0,80}potentialpersonname|potentialpersonname.{0,80}digitaltwin)/iu,
  /(?:agent|character|actor|resident|person).{0,80}(?:predict(?:s|ed|ing)?|estimat(?:e|es|ed|ing)).{0,80}potentialpersonname.{0,80}(?:nextlocation|where|behavior|behaviour|actions?)/iu,
]);
const LATIN_PERSON_NAME = /\b\p{Lu}\p{Ll}{1,30}(?:[’'-]\p{Lu}?\p{Ll}+)?\s+\p{Lu}\p{Ll}{1,30}\b/gu;
const MIDDLE_DOT_PERSON_NAME = /[·•]/gu;
const NEGATED_BOUNDARY_PATTERNS = Object.freeze([
  new RegExp(`(?:不会|不得|不能|禁止|不应|并非|不是|不对应|不映射|不仿冒|不冒充|不假扮|不还原|不复刻|不预测|不推测|不推演|不预估).{0,64}(?:${EXPLICIT_PERSON_EVIDENCE})`, "giu"),
  /(?:doesnot|donot|mustnot|never|isnot|arenot|not)(?:impersonat(?:e|es|ed|ing)|masquerad(?:e|es|ed|ing)|predict(?:s|ed|ing)?|forecast(?:s|ed|ing)?|basedon|digitaltwin).{0,64}/giu,
  /(?:doesnot|donot|mustnot|never|isnot|arenot|not).{0,64}(?:realperson|realresident|identifiableperson)/giu,
]);

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function normalizedKey(key) {
  return key.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");
}

function normalizedText(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[\p{Cf}\p{P}\p{S}\p{Z}_]+/gu, "");
}

function markPotentialPersonNames(value) {
  return value
    .replace(LATIN_PERSON_NAME, (name) => `${name} potentialpersonname `)
    .replace(MIDDLE_DOT_PERSON_NAME, (separator) => `${separator} potentialpersonname `);
}

export function fictionBoundaryDeclaration() {
  return {
    schemaVersion: 1,
    policyId: FICTION_POLICY_ID,
    fictional: true,
    mapsRealPerson: false,
    predictsRealPerson: false,
    notice: FICTION_NOTICE,
  };
}

export function validateFictionBoundary(value, coordinate = "fictionBoundary") {
  if (!exactObject(value, BOUNDARY_KEYS) || value.schemaVersion !== 1
    || value.policyId !== FICTION_POLICY_ID || value.fictional !== true
    || value.mapsRealPerson !== false || value.predictsRealPerson !== false
    || value.notice !== FICTION_NOTICE) {
    throw new Error(`${coordinate} 不符合 ${FICTION_POLICY_ID}`);
  }
  return structuredClone(value);
}

function scanText(value, coordinate, reviewSignals) {
  let text = normalizedText(markPotentialPersonNames(value.replaceAll(FICTION_NOTICE, "")));
  if (DOUBLE_NEGATIVE_CLAIM.test(text)) throw new Error(`${coordinate} 含真实个人仿冒、映射或预测声明`);
  for (const pattern of NEGATED_BOUNDARY_PATTERNS) text = text.replace(pattern, "");
  if (EXPLICIT_PERSON_CLAIM.test(text)) {
    throw new Error(`${coordinate} 含真实个人仿冒、映射或预测声明`);
  }
  if (NAMED_PERSON_CLAIMS.some((pattern) => pattern.test(text))) reviewSignals.push(coordinate);
}

function inspectContent(value, coordinate, textLeaves, reviewSignals) {
  if (typeof value === "string") {
    textLeaves.push(value);
    scanText(value, coordinate, reviewSignals);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectContent(item, `${coordinate}[${index}]`, textLeaves, reviewSignals));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const keyToken = normalizedKey(key);
    if (FORBIDDEN_KEY_FRAGMENTS.some((fragment) => keyToken.includes(fragment))) {
      throw new Error(`${coordinate}.${key} 是禁止的真实个人映射或预测字段`);
    }
    inspectContent(child, `${coordinate}.${key}`, textLeaves, reviewSignals);
  }
}

export function assessFictionalContent(value, coordinate = "content") {
  const textLeaves = [];
  const reviewSignals = [];
  inspectContent(value, coordinate, textLeaves, reviewSignals);
  if (textLeaves.length > 1) scanText(textLeaves.join("\u241e"), `${coordinate} 聚合文本`, reviewSignals);
  const uniqueSignals = [...new Set(reviewSignals)];
  return {
    automatedDecision: "accept",
    humanReviewRequired: uniqueSignals.length > 0,
    reviewSignals: uniqueSignals,
  };
}

export function assertFictionalContent(value, coordinate = "content") {
  assessFictionalContent(value, coordinate);
  return value;
}

export function assertVisibleFictionNotice(element) {
  if (!element || element.textContent?.trim() !== FICTION_NOTICE) throw new Error("虚构边界文案缺失或被修改");
  const style = globalThis.getComputedStyle?.(element);
  const rectangle = element.getBoundingClientRect?.();
  const colorIsTransparent = style && (style.color === "transparent" || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/iu.test(style.color));
  const filterIsTransparent = style && /opacity\(\s*0(?:%|(?:\.0+)?)\s*\)/iu.test(style.filter);
  const transformMatrix = style?.transform?.match(/^matrix\(([-0-9.e]+),\s*([-0-9.e]+),\s*([-0-9.e]+),\s*([-0-9.e]+)/iu);
  const transformIsCollapsed = transformMatrix
    && Math.abs(Number(transformMatrix[1]) * Number(transformMatrix[4]) - Number(transformMatrix[2]) * Number(transformMatrix[3])) < 0.000001;
  const textIsIndentedAway = style && rectangle && Number.parseFloat(style.textIndent) < -rectangle.width;
  const outsideViewport = rectangle && globalThis.innerWidth !== undefined && globalThis.innerHeight !== undefined
    && (rectangle.width <= 0 || rectangle.height <= 0 || rectangle.right <= 0 || rectangle.bottom <= 0
      || rectangle.left >= globalThis.innerWidth || rectangle.top >= globalThis.innerHeight);
  if (element.hidden || element.hasAttribute?.("inert") || element.getAttribute?.("aria-hidden") === "true"
    || element.closest?.('[hidden], [inert], [aria-hidden="true"]') || element.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false
    || colorIsTransparent || filterIsTransparent || transformIsCollapsed || textIsIndentedAway
    || outsideViewport || (style && (style.display === "none" || style.visibility === "hidden"
      || Number(style.opacity) === 0 || Number.parseFloat(style.fontSize) === 0
      || style.clipPath !== "none" || (style.clip !== "auto" && style.clip !== "rect(auto, auto, auto, auto)")))) {
    throw new Error("虚构边界文案不可见");
  }
  return true;
}
