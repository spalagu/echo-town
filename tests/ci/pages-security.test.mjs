import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validatePagesWorkflow, verifyPagesRepository } from "../../scripts/verify-pages-security.mjs";

const root = path.resolve(".");
const workflow = await readFile(path.join(root, ".github/workflows/pages.yml"), "utf8");

test("Pages workflow 只从 main 合并 SHA 构建，并把写权限隔离到 deploy job", async () => {
  assert.deepEqual(await verifyPagesRepository(root), []);
});

test("10 个 Pages 供应链 mutation 全部判红", () => {
  const mutations = [
    workflow.replace("  push:\n", "  pull_request:\n"),
    workflow.replace("permissions:\n", "on:\n  workflow_dispatch:\npermissions:\n"),
    workflow.replace("permissions:\n  contents: read", "permissions:\n  contents: write"),
    workflow.replace("    permissions:\n      contents: read", "    permissions:\n      contents: read\n      pages: write"),
    workflow.replace("    needs: build", "    needs: []"),
    workflow.replace("cancel-in-progress: false", "cancel-in-progress: true"),
    workflow.replace(/actions\/upload-pages-artifact@[0-9a-f]{40}/u, "actions/upload-pages-artifact@v5"),
    workflow.replace("path: apps/web/dist", "path: ."),
    workflow.replace("node scripts/pages-release.mjs verify apps/web/dist --commit \"$GITHUB_SHA\"", "echo skip-release-verification"),
    workflow.replace("runs-on: ubuntu-24.04", "runs-on: self-hosted"),
  ];
  const outcomes = mutations.map((value) => validatePagesWorkflow(value).length > 0);
  assert.equal(outcomes.length, 10);
  assert.ok(outcomes.every(Boolean), JSON.stringify(outcomes));
});
