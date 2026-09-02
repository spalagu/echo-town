import { createHash } from "node:crypto";
import { lstat, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_KEYS = new Set([
  "schemaVersion", "repository", "commit", "artifactHash", "contentHash",
  "versionManifestPath", "worldContentManifestPath", "files", "totalBytes",
]);
const FILE_KEYS = new Set(["path", "bytes", "sha256"]);
const REPOSITORY = "spalagu/echo-town";
const RELEASE_NAME = "release-manifest.json";

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function validCommit(value) { return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value); }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function portable(root, file) { return path.relative(root, file).split(path.sep).join("/"); }

async function walk(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Pages artifact 禁止符号链接：${portable(root, target)}`);
    if (entry.isDirectory()) files.push(...await walk(root, target));
    else if (entry.isFile()) files.push(target);
    else throw new Error(`Pages artifact 含未知文件类型：${portable(root, target)}`);
  }
  return files;
}

async function fileRecords(root) {
  const files = (await walk(root)).filter((file) => portable(root, file) !== RELEASE_NAME);
  const records = [];
  for (const file of files) {
    const content = await readFile(file);
    records.push({ path: portable(root, file), bytes: content.byteLength, sha256: digest(content) });
  }
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function validateFileRecords(files) {
  return Array.isArray(files) && files.length > 0 && files.every((file) => exactObject(file, FILE_KEYS)
    && typeof file.path === "string" && file.path.length > 0 && !file.path.startsWith("/") && !file.path.includes("..")
    && Number.isInteger(file.bytes) && file.bytes >= 0 && /^[0-9a-f]{64}$/u.test(file.sha256))
    && new Set(files.map((file) => file.path)).size === files.length;
}

function expectedArtifactHash(commit, files) {
  return digest(JSON.stringify({ repository: REPOSITORY, commit, files }));
}

function validateVersionManifest(versionManifest, files, commit) {
  if (versionManifest?.sourceCommit !== commit || !Array.isArray(versionManifest.assets)) {
    throw new Error("version-manifest 与目标合并 SHA 不一致");
  }
  const actual = new Map(files.map((file) => [file.path, file]));
  for (const asset of versionManifest.assets) {
    const file = actual.get(asset.path);
    if (!file || file.bytes !== asset.bytes || file.sha256 !== asset.sha256) {
      throw new Error(`version-manifest 资产不一致：${asset.path}`);
    }
  }
  const expectedPaths = files.map((file) => file.path)
    .filter((file) => file !== "version-manifest.json" && file !== RELEASE_NAME)
    .sort();
  const manifestPaths = versionManifest.assets.map((asset) => asset.path).sort();
  if (JSON.stringify(expectedPaths) !== JSON.stringify(manifestPaths)) throw new Error("version-manifest 资产集合不闭合");
}

export async function buildReleaseManifest(directory, commit) {
  const root = path.resolve(directory);
  if (!validCommit(commit)) throw new Error("release-manifest 必须绑定 40 位小写合并 SHA");
  const stats = await lstat(root);
  if (!stats.isDirectory()) throw new Error("Pages artifact 根必须是目录");
  const files = await fileRecords(root);
  const versionManifest = await readJson(root, "version-manifest.json");
  const worldManifest = await readJson(root, "world-content-manifest.json");
  validateVersionManifest(versionManifest, files, commit);
  if (!/^[0-9a-f]{64}$/u.test(worldManifest?.contentHash || "")) throw new Error("世界内容清单缺少 contentHash");
  return {
    schemaVersion: 1,
    repository: REPOSITORY,
    commit,
    artifactHash: expectedArtifactHash(commit, files),
    contentHash: worldManifest.contentHash,
    versionManifestPath: "version-manifest.json",
    worldContentManifestPath: "world-content-manifest.json",
    files,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}

export async function writeReleaseManifest(directory, commit) {
  const root = path.resolve(directory);
  const manifest = await buildReleaseManifest(root, commit);
  const temporary = path.join(root, `.release-manifest-${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, path.join(root, RELEASE_NAME));
  return structuredClone(manifest);
}

export async function verifyReleaseArtifact(directory, expectedCommit) {
  const root = path.resolve(directory);
  const manifest = await readJson(root, RELEASE_NAME);
  if (!exactObject(manifest, RELEASE_KEYS) || manifest.schemaVersion !== 1 || manifest.repository !== REPOSITORY
    || !validCommit(manifest.commit) || (expectedCommit && manifest.commit !== expectedCommit)
    || !/^[0-9a-f]{64}$/u.test(manifest.artifactHash) || !/^[0-9a-f]{64}$/u.test(manifest.contentHash)
    || manifest.versionManifestPath !== "version-manifest.json"
    || manifest.worldContentManifestPath !== "world-content-manifest.json"
    || !validateFileRecords(manifest.files) || !Number.isInteger(manifest.totalBytes) || manifest.totalBytes < 0) {
    throw new Error("release-manifest 契约非法");
  }
  const rebuilt = await buildReleaseManifest(root, manifest.commit);
  if (JSON.stringify(manifest) !== JSON.stringify(rebuilt)) throw new Error("Pages artifact 与 release-manifest 不一致");
  return structuredClone(manifest);
}

export class PagesDeploymentLedger {
  #active = null;
  #history = [];
  #runIds = new Set();

  async attempt({ runId, commit, artifactDirectory = null, outcome, mode = "release" }) {
    if (typeof runId !== "string" || runId.length === 0 || runId.length > 96 || this.#runIds.has(runId)
      || !validCommit(commit) || !["success", "build_failed", "deployment_failed"].includes(outcome)
      || !["release", "rollback"].includes(mode)) throw new Error("Pages deployment 尝试非法");
    this.#runIds.add(runId);
    const previous = this.#active ? structuredClone(this.#active) : null;
    if (outcome === "build_failed") {
      this.#history.push({ runId, commit, mode, outcome, promoted: false, artifactHash: null, previous });
      return this.snapshot();
    }
    try {
      const manifest = await verifyReleaseArtifact(artifactDirectory, commit);
      const promoted = outcome === "success";
      if (promoted) this.#active = { commit: manifest.commit, artifactHash: manifest.artifactHash };
      this.#history.push({ runId, commit, mode, outcome, promoted, artifactHash: manifest.artifactHash, previous });
      return this.snapshot();
    } catch (error) {
      this.#history.push({ runId, commit, mode, outcome: "rejected", promoted: false, artifactHash: null, previous });
      throw error;
    }
  }

  snapshot() {
    return structuredClone({ schemaVersion: 1, active: this.#active, history: this.#history });
  }
}

function cliCommit(args) {
  const index = args.indexOf("--commit");
  return index >= 0 ? args[index + 1] : process.env.GITHUB_SHA || process.env.SOURCE_COMMIT;
}

async function main() {
  const [command, directory] = process.argv.slice(2);
  const commit = cliCommit(process.argv.slice(2));
  if (!directory || !["write", "verify"].includes(command)) {
    throw new Error("用法：node scripts/pages-release.mjs <write|verify> <artifact-dir> [--commit <sha>]");
  }
  const result = command === "write"
    ? await writeReleaseManifest(directory, commit)
    : await verifyReleaseArtifact(directory, commit);
  console.log(`${command === "write" ? "发布清单已生成" : "Pages artifact 验证通过"}：commit=${result.commit} artifactHash=${result.artifactHash}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
