import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PagesDeploymentLedger, verifyReleaseArtifact, writeReleaseManifest } from "../../scripts/pages-release.mjs";

const commits = {
  a: "1111111111111111111111111111111111111111",
  b: "2222222222222222222222222222222222222222",
  c: "3333333333333333333333333333333333333333",
};
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function fixture(root, name, commit, content) {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  const index = Buffer.from(`<h1>${content}</h1>`);
  const world = Buffer.from(`${JSON.stringify({ schemaVersion: 1, contentHash: hash(`world-${content}`), packs: [] }, null, 2)}\n`);
  await writeFile(path.join(directory, "index.html"), index);
  await writeFile(path.join(directory, "world-content-manifest.json"), world);
  const assets = [
    { path: "index.html", bytes: index.byteLength, sha256: hash(index) },
    { path: "world-content-manifest.json", bytes: world.byteLength, sha256: hash(world) },
  ];
  await writeFile(path.join(directory, "version-manifest.json"), `${JSON.stringify({ version: "fixture", sourceCommit: commit, assets }, null, 2)}\n`);
  await writeReleaseManifest(directory, commit);
  return directory;
}

test("release-manifest 将合并 SHA、世界内容与 artifact 文件哈希闭合", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "echo-town-pages-manifest-"));
  try {
    const directory = await fixture(temporary, "a", commits.a, "版本 A");
    const manifest = await verifyReleaseArtifact(directory, commits.a);
    const firstText = await readFile(path.join(directory, "release-manifest.json"), "utf8");
    const repeated = await writeReleaseManifest(directory, commits.a);
    const secondText = await readFile(path.join(directory, "release-manifest.json"), "utf8");
    assert.equal(manifest.commit, commits.a);
    assert.deepEqual(repeated, manifest);
    assert.equal(secondText, firstText);
    assert.equal(manifest.files.length, 3);
    assert.ok(manifest.totalBytes > 0);
    const sameContentDifferentCommit = await fixture(temporary, "same-content", commits.b, "版本 A");
    assert.notEqual((await verifyReleaseArtifact(sameContentDifferentCommit, commits.b)).artifactHash, manifest.artifactHash);
    await assert.rejects(() => verifyReleaseArtifact(directory, commits.b), /契约非法/u);
    await writeFile(path.join(directory, "index.html"), "tampered");
    await assert.rejects(() => verifyReleaseArtifact(directory, commits.a), /不一致/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Pages artifact 拒绝符号链接和不闭合 version-manifest", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "echo-town-pages-link-"));
  try {
    const directory = await fixture(temporary, "a", commits.a, "版本 A");
    await symlink(path.join(directory, "index.html"), path.join(directory, "linked.html"));
    await assert.rejects(() => verifyReleaseArtifact(directory, commits.a), /禁止符号链接/u);
    await rm(path.join(directory, "linked.html"));
    const versionPath = path.join(directory, "version-manifest.json");
    const version = JSON.parse(await readFile(versionPath, "utf8"));
    version.assets.pop();
    await writeFile(versionPath, JSON.stringify(version));
    await assert.rejects(() => writeReleaseManifest(directory, commits.a), /资产集合不闭合/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("10 次正常、构建失败、部署失败、篡改和回退演练只提升验证成功的 artifact", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "echo-town-pages-ledger-"));
  try {
    const [a, b, c] = await Promise.all([
      fixture(temporary, "a", commits.a, "版本 A"),
      fixture(temporary, "b", commits.b, "版本 B"),
      fixture(temporary, "c", commits.c, "版本 C"),
    ]);
    const ledger = new PagesDeploymentLedger();
    await ledger.attempt({ runId: "run-01", commit: commits.a, artifactDirectory: a, outcome: "success" });
    await ledger.attempt({ runId: "run-02", commit: commits.b, outcome: "build_failed" });
    await ledger.attempt({ runId: "run-03", commit: commits.b, artifactDirectory: b, outcome: "deployment_failed" });
    await assert.rejects(() => ledger.attempt({ runId: "run-04", commit: commits.b, artifactDirectory: a, outcome: "success" }), /契约非法/u);
    await ledger.attempt({ runId: "run-05", commit: commits.b, artifactDirectory: b, outcome: "success" });
    await ledger.attempt({ runId: "run-06", commit: commits.c, outcome: "build_failed" });
    await ledger.attempt({ runId: "run-07", commit: commits.c, artifactDirectory: c, outcome: "deployment_failed" });
    await ledger.attempt({ runId: "run-08", commit: commits.c, artifactDirectory: c, outcome: "success" });
    await ledger.attempt({ runId: "run-09", commit: commits.a, artifactDirectory: a, outcome: "success", mode: "rollback" });
    const final = await ledger.attempt({ runId: "run-10", commit: commits.b, artifactDirectory: b, outcome: "success", mode: "rollback" });
    assert.equal(final.history.length, 10);
    assert.deepEqual(final.active, { commit: commits.b, artifactHash: (await verifyReleaseArtifact(b, commits.b)).artifactHash });
    assert.equal(final.history.filter((item) => item.promoted).length, 5);
    assert.equal(final.history.find((item) => item.runId === "run-04").outcome, "rejected");
    assert.equal(final.history.find((item) => item.runId === "run-03").previous.commit, commits.a);
    assert.equal(final.history.find((item) => item.runId === "run-04").previous.commit, commits.a);
    assert.equal(final.history.find((item) => item.runId === "run-07").previous.commit, commits.b);
    assert.ok(final.history.filter((item) => ["build_failed", "deployment_failed", "rejected"].includes(item.outcome))
      .every((item) => item.promoted === false));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
