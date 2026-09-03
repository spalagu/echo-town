import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyServerlessBoundary } from "../../scripts/verify-serverless.mjs";

const root = path.resolve(new URL("../..", import.meta.url).pathname);

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "echo-town-ap06-"));
  for (const target of ["config", "apps/web/public", ".github/workflows"]) await mkdir(path.join(directory, target), { recursive: true });
  for (const file of ["config/public-nodes.json", "apps/web/public/public-nodes.json", ".github/workflows/pages.yml", ".github/workflows/pr.yml"]) {
    await cp(path.join(root, file), path.join(directory, file));
  }
  return directory;
}

test("AP-06 基线只有 GitHub Pages 静态部署面", async () => {
  const result = await verifyServerlessBoundary(root);
  assert.deepEqual(result.deploymentObjects, ["GitHub Pages 静态 artifact"]);
  assert.equal(result.projectOperatedServices + result.serverAiEndpoints + result.serverTickEndpoints + result.privatePersistenceEndpoints, 0);
});

test("自营 server、PR 部署与唯一公共运营者 mutation 全部判红", async () => {
  const serverFixture = await fixture();
  const prFixture = await fixture();
  const nodeFixture = await fixture();
  try {
    await mkdir(path.join(serverFixture, "server"));
    await writeFile(path.join(serverFixture, "server/index.js"), "export default {};\n");
    await assert.rejects(() => verifyServerlessBoundary(serverFixture), /服务端部署对象/u);

    const prPath = path.join(prFixture, ".github/workflows/pr.yml");
    await writeFile(prPath, `${await readFile(prPath, "utf8")}\n# actions/deploy-pages\n`);
    await assert.rejects(() => verifyServerlessBoundary(prFixture), /唯一部署面/u);

    const registryPath = path.join(nodeFixture, "config/public-nodes.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    registry.strategies[0].endpoints[1].operator = registry.strategies[0].endpoints[0].operator;
    const mutated = `${JSON.stringify(registry, null, 2)}\n`;
    await writeFile(registryPath, mutated);
    await writeFile(path.join(nodeFixture, "apps/web/public/public-nodes.json"), mutated);
    await assert.rejects(() => verifyServerlessBoundary(nodeFixture), /独立第三方/u);
  } finally {
    await Promise.all([serverFixture, prFixture, nodeFixture].map((directory) => rm(directory, { recursive: true, force: true })));
  }
});
