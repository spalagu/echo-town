import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
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

const port = await availablePort();
const server = spawn(process.execPath, [path.resolve("node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: path.resolve("apps/web"),
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`静态预览未就绪：${output}`);
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const network = [];
  page.on("request", (request) => network.push(request.url()));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady));
  const initial = await page.evaluate(() => window.__echoTown.position());
  await page.waitForFunction(() => window.__echoTownReady.autonomousLife.snapshot().cycles.filter((cycle) => cycle.stage === "completed").length >= 2);
  const moved = await page.evaluate(() => window.__echoTown.position());
  assert.ok(Math.hypot(moved.x - initial.x, moved.y - initial.y) > 20, "角色应当由自主 Event 推动");
  const runtime = await page.evaluate(() => ({
    directControl: window.__echoTown.directControl,
    moveToType: typeof window.__echoTown.moveTo,
    worldContent: window.__echoTownReady.worldContent,
    autonomy: window.__echoTownReady.autonomousLife.snapshot(),
  }));
  assert.equal(runtime.directControl, false);
  assert.equal(runtime.moveToType, "undefined");
  assert.equal(runtime.worldContent.schemaVersion, 1);
  assert.ok(runtime.worldContent.packs
    .flatMap((pack) => pack.content?.entries ?? [])
    .some((entry) => entry.id === "old-clocktower"), "编译后的世界内容必须包含旧钟楼");
  const socialFoundation = await page.evaluate(() => window.__echoTownReady.socialFoundation);
  assert.deepEqual(socialFoundation, { initialStatePacks: 3, situationSeeds: 5 });
  const manifest = await page.evaluate(() => window.__echoTownReady.manifest);
  const stateHash = await page.evaluate(() => window.__echoTownReady.stateHash);
  assert.ok(manifest.version && manifest.assets.length >= 4);
  assert.match(stateHash, /^[0-9a-f]{64}$/);
  assert.ok(network.every((url) => url.startsWith(`http://127.0.0.1:${port}/`)), "不应依赖外部服务");
  assert.ok(await page.locator("canvas").isVisible());
  await page.screenshot({ path: process.env.ECHO_TOWN_SCREENSHOT || "ap01-echo-town.png", fullPage: true });
  await browser.close();
  console.log(JSON.stringify({ manifest: manifest.version, assets: manifest.assets.length, autonomousCycles: runtime.autonomy.cycles.length, socialFoundation, networkRequests: network.length, wasmStateHash: stateHash }));
} finally {
  server.kill("SIGTERM");
}
