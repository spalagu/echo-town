import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assessFictionalContent, fictionBoundaryDeclaration } from "../packages/fiction-boundary/src/index.js";
import { validateMysterySeed } from "../packages/mystery-fabric/src/index.js";
import { validateInitialStatePack, validateSituationSeed } from "../packages/public-discourse/src/contracts.js";

const ROOT_KEYS = new Set(["schemaVersion", "packId", "title", "license", "attribution", "entries"]);
const ATTRIBUTION_KEYS = new Set(["author", "source", "modified"]);
const ENTRY_KEYS = new Set(["id", "kind", "title", "summary", "observableFacts", "actionAffordances", "resourceRules"]);
const RULE_KEYS = new Set(["resourceId", "operation", "amount", "expiresAfterTicks"]);
const ASSET_LICENSE_KEYS = new Set(["schemaVersion", "assetPath", "license", "attribution"]);
const ENTRY_KINDS = new Set(["place", "profession", "resource", "rule_primitive"]);
const OPERATIONS = new Set(["produce", "consume", "expire", "recycle"]);
const ASSET_LICENSES = new Set(["CC-BY-4.0", "CC0-1.0", "OFL-1.1"]);
const ALLOWED_EXTENSIONS = new Set([".json", ".png", ".jpg", ".jpeg", ".webp", ".ogg", ".mp3", ".wav"]);
const FORBIDDEN_EXTENSIONS = new Set([".svg", ".html", ".htm", ".js", ".mjs", ".cjs", ".wasm", ".sh", ".exe", ".dll", ".dylib", ".so"]);
const FORBIDDEN_KEYS = new Set([
  "castslots", "participants", "requiredcharacters", "assignedactorids", "goal", "objective",
  "plotstage", "chapter", "expectedoutcome", "outcome", "ending", "standardanswer", "solution",
  "truthscore", "consensus", "historicalsummary", "plannergoal", "script", "html", "remoteurl",
  "url", "executable", "command",
]);
const FORBIDDEN_TEXT = /<\s*(?:script|iframe|object|embed|html|svg)\b|javascript\s*:|data\s*:\s*text\/html|https?:\/\/|^\s*#!\s*\//iu;
const IDENTIFIER = /^[a-z][a-z0-9-]{2,63}$/;
const ACTION = /^[a-z][a-z0-9_]{1,47}$/;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BYTES = 256 * 1024;

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function boundedText(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function stringList(value, maximumItems, maximumLength, pattern) {
  return Array.isArray(value) && value.length <= maximumItems
    && value.every((item) => boundedText(item, maximumLength) && (!pattern || pattern.test(item)));
}

function rejectForbiddenContent(value, coordinate = "root") {
  if (typeof value === "string") {
    if (coordinate.endsWith(".attribution.source")) return;
    if (FORBIDDEN_TEXT.test(value)) throw new Error(`${coordinate} 含远程、HTML 或可执行文本`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenContent(item, `${coordinate}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLocaleLowerCase())) throw new Error(`${coordinate}.${key} 是禁止的剧情或可执行字段`);
    rejectForbiddenContent(child, `${coordinate}.${key}`);
  }
}

export function validateContentPack(value, coordinate = "content-pack") {
  if (!exactObject(value, ROOT_KEYS) || value.schemaVersion !== 1 || !IDENTIFIER.test(value.packId)
    || !boundedText(value.title, 80) || value.license !== "CC-BY-4.0"
    || !exactObject(value.attribution, ATTRIBUTION_KEYS)
    || !boundedText(value.attribution.author, 120) || !boundedText(value.attribution.source, 160)
    || typeof value.attribution.modified !== "boolean"
    || !Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > 200) {
    throw new Error(`${coordinate} 不符合 ContentPack v1 根契约`);
  }
  const ids = new Set();
  for (const [index, entry] of value.entries.entries()) {
    const entryCoordinate = `${coordinate}.entries[${index}]`;
    if (!exactObject(entry, ENTRY_KEYS) || !IDENTIFIER.test(entry.id) || !ENTRY_KINDS.has(entry.kind)
      || !boundedText(entry.title, 80) || !boundedText(entry.summary, 500)
      || !stringList(entry.observableFacts, 24, 240)
      || !stringList(entry.actionAffordances, 24, 48, ACTION)
      || !Array.isArray(entry.resourceRules) || entry.resourceRules.length > 24) {
      throw new Error(`${entryCoordinate} 不符合声明式条目契约`);
    }
    if (ids.has(entry.id)) throw new Error(`${entryCoordinate} id 重复`);
    ids.add(entry.id);
    for (const [ruleIndex, rule] of entry.resourceRules.entries()) {
      if (!exactObject(rule, RULE_KEYS) || !IDENTIFIER.test(rule.resourceId) || !OPERATIONS.has(rule.operation)
        || !Number.isInteger(rule.amount) || rule.amount < 1 || rule.amount > 10_000
        || !Number.isInteger(rule.expiresAfterTicks) || rule.expiresAfterTicks < 0 || rule.expiresAfterTicks > 1_000_000) {
        throw new Error(`${entryCoordinate}.resourceRules[${ruleIndex}] 不符合资源守恒契约`);
      }
    }
  }
  rejectForbiddenContent(value, coordinate);
  return structuredClone(value);
}

export function validateAssetLicense(value, coordinate = "asset-license") {
  if (!exactObject(value, ASSET_LICENSE_KEYS) || value.schemaVersion !== 1
    || typeof value.assetPath !== "string" || !/^assets\/[a-zA-Z0-9._/-]+$/.test(value.assetPath)
    || value.assetPath.includes("..") || !ASSET_LICENSES.has(value.license)
    || !exactObject(value.attribution, ATTRIBUTION_KEYS)
    || !boundedText(value.attribution.author, 120) || !boundedText(value.attribution.source, 500)
    || typeof value.attribution.modified !== "boolean") {
    throw new Error(`${coordinate} 不符合资产许可旁车 v1`);
  }
  rejectForbiddenContent(value, coordinate);
  return structuredClone(value);
}

async function listFiles(root, current = root, output = []) {
  for (const name of (await readdir(current)).sort()) {
    const absolute = path.join(current, name);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) throw new Error(`${path.relative(root, absolute)} 不得是符号链接`);
    if (metadata.isDirectory()) await listFiles(root, absolute, output);
    else if (metadata.isFile()) output.push({ absolute, relative: path.relative(root, absolute).split(path.sep).join("/"), metadata });
    else throw new Error(`${path.relative(root, absolute)} 不是普通文件`);
  }
  return output;
}

export async function inspectWorld(root) {
  const files = await listFiles(root);
  let totalBytes = 0;
  const packs = [];
  const binaryAssets = [];
  const assetLicenses = new Map();
  for (const file of files) {
    totalBytes += file.metadata.size;
    const extension = path.extname(file.relative).toLocaleLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension) || FORBIDDEN_EXTENSIONS.has(extension)) throw new Error(`${file.relative} 文件类型不允许`);
    if ((file.metadata.mode & 0o111) !== 0) throw new Error(`${file.relative} 不得带可执行位`);
    if (file.metadata.size > MAX_ASSET_BYTES || (extension === ".json" && file.metadata.size > MAX_JSON_BYTES)) {
      throw new Error(`${file.relative} 超过单文件预算`);
    }
    const bytes = await readFile(file.absolute);
    if (extension === ".json") {
      let parsed;
      try { parsed = JSON.parse(bytes.toString("utf8")); } catch (error) { throw new Error(`${file.relative} 不是合法 JSON：${error.message}`); }
      if (file.relative.endsWith(".license.json")) {
        const license = validateAssetLicense(parsed, file.relative);
        if (assetLicenses.has(license.assetPath)) throw new Error(`资产许可旁车重复：${license.assetPath}`);
        assetLicenses.set(license.assetPath, { source: file.relative, license });
      } else {
        const fictionReview = assessFictionalContent(parsed, file.relative);
        const packType = parsed?.packType ?? "content-pack";
        const content = packType === "initial-state"
          ? validateInitialStatePack(parsed, file.relative)
          : packType === "situation-seed"
            ? validateSituationSeed(parsed, file.relative)
            : packType === "mystery-seed"
              ? validateMysterySeed(parsed, file.relative)
              : validateContentPack(parsed, file.relative);
        rejectForbiddenContent(content, file.relative);
        packs.push({
          packType,
          source: file.relative,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
          fictionReview,
          content,
        });
      }
    } else binaryAssets.push(file.relative);
  }
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error("world/ 总大小超过 25 MiB 预算");
  if (packs.length === 0) throw new Error("world/ 至少需要一个 JSON 内容包");
  const packIds = new Set();
  for (const pack of packs) {
    const packId = pack.content.packId ?? pack.content.id;
    const key = `${pack.packType}:${packId}`;
    if (packIds.has(key)) throw new Error(`内容包标识重复：${key}`);
    packIds.add(key);
  }
  for (const asset of binaryAssets) if (!assetLicenses.has(asset)) throw new Error(`${asset} 缺少同路径资产许可旁车`);
  for (const asset of assetLicenses.keys()) if (!binaryAssets.includes(asset)) throw new Error(`${asset} 的资产许可旁车没有对应文件`);
  return { files, packs, assetLicenses: [...assetLicenses.values()], totalBytes };
}

export async function compileWorld({ root, output }) {
  const inspected = await inspectWorld(root);
  const contentHash = createHash("sha256").update(inspected.packs.map((pack) => `${pack.source}:${pack.sha256}`).join("\n")).digest("hex");
  const manifest = {
    schemaVersion: 1,
    contentHash,
    fictionBoundary: fictionBoundaryDeclaration(),
    packs: inspected.packs,
    assetLicenses: inspected.assetLicenses,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifest, totalBytes: inspected.totalBytes, fileCount: inspected.files.length };
}

async function main() {
  const args = process.argv.slice(2);
  const valueAfter = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const root = path.resolve(valueAfter("--root", "world"));
  const output = path.resolve(valueAfter("--output", ".world-dist/content-manifest.json"));
  const gate = valueAfter("--gate", "all");
  if (!["all", "world-schema", "asset-budget", "license-policy", "content-safety"].includes(gate)) throw new Error(`未知 gate：${gate}`);
  const inspected = await inspectWorld(root);
  const humanReviewPacks = inspected.packs.filter((pack) => pack.fictionReview.humanReviewRequired).length;
  if (gate === "all") {
    const result = await compileWorld({ root, output });
    console.log(`世界内容编译通过：${result.manifest.packs.length} 个包，${result.fileCount} 个文件，${humanReviewPacks} 个人工复核包，contentHash=${result.manifest.contentHash}`);
  } else {
    console.log(`${gate} 通过：${inspected.packs.length} 个包，${inspected.files.length} 个文件，${inspected.totalBytes} 字节，${humanReviewPacks} 个人工复核包`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
