import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const expectedCommit = process.env.GITHUB_SHA || process.env.SOURCE_COMMIT;
if (!/^[0-9a-f]{40}$/u.test(expectedCommit || "")) throw new Error("AP-15 本地浏览器验收需要 40 位 SOURCE_COMMIT/GITHUB_SHA");
const port = await availablePort();
const origin = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, [path.resolve("node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: path.resolve("apps/web"),
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Pages artifact 静态预览未就绪：${output}`);
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const externalRequests = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(origin)) externalRequests.push(request.url());
  });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady || window.__echoTownBootError));
  const result = await page.evaluate(async (commit) => {
    const [releaseResponse, versionResponse, worldResponse] = await Promise.all([
      fetch("./release-manifest.json", { cache: "no-store" }),
      fetch("./version-manifest.json", { cache: "no-store" }),
      fetch("./world-content-manifest.json", { cache: "no-store" }),
    ]);
    const [release, version, world] = await Promise.all([
      releaseResponse.json(), versionResponse.json(), worldResponse.json(),
    ]);
    return {
      bootError: window.__echoTownBootError?.message ?? null,
      releaseOk: releaseResponse.ok,
      versionOk: versionResponse.ok,
      worldOk: worldResponse.ok,
      releaseCommit: release.commit,
      versionCommit: version.sourceCommit,
      contentHashMatches: release.contentHash === world.contentHash,
      artifactHashShape: /^[0-9a-f]{64}$/u.test(release.artifactHash),
      manifestFiles: release.files.length,
      runtimeManifestVersion: window.__echoTownReady?.manifest?.version,
      expectedCommit: commit,
    };
  }, expectedCommit);
  assert.equal(result.bootError, null, `Pages artifact 浏览器启动失败：${result.bootError}`);
  assert.equal(result.releaseOk && result.versionOk && result.worldOk, true);
  assert.equal(result.releaseCommit, expectedCommit);
  assert.equal(result.versionCommit, expectedCommit);
  assert.equal(result.contentHashMatches, true);
  assert.equal(result.artifactHashShape, true);
  assert.ok(result.manifestFiles >= 10);
  assert.equal(result.runtimeManifestVersion, "m2-foundation.1");
  assert.deepEqual(externalRequests, []);
  await browser.close();
  console.log(JSON.stringify({ ...result, externalRequests: externalRequests.length }, null, 2));
} finally {
  server.kill("SIGTERM");
}
