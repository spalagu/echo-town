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
const origin = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, [path.resolve("node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: path.resolve("apps/web"),
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });

try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (attempt === 59) throw new Error(`正式制品预览未就绪：${serverOutput}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    if (typeof ServiceWorkerContainer === "undefined") return;
    const neverReady = new Promise(() => {});
    Object.defineProperty(ServiceWorkerContainer.prototype, "ready", {
      configurable: true,
      get: () => neverReady,
    });
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__echoTownReady?.autonomousLife?.snapshot().cycles.length > 0, null, { timeout: 5_000 });
  const result = await page.evaluate(() => {
    const snapshot = window.__echoTownReady.autonomousLife.snapshot();
    return {
      firstDecisionMs: snapshot.cycles[0].startedAtMs,
      offlineControlled: window.__echoTownReady.offlineWorker.controlled,
      directControl: window.__echoTown.directControl,
    };
  });
  assert.ok(result.firstDecisionMs <= 2_000, `离线缓存未就绪时首次自主决策在 ${result.firstDecisionMs}ms 才开始`);
  assert.equal(result.offlineControlled, false);
  assert.equal(result.directControl, false);
  assert.deepEqual(pageErrors, []);
  await context.close();
  await browser.close();
  console.log(JSON.stringify({ ...result, serviceWorkerReady: "blocked", result: "passed" }, null, 2));
} finally {
  server.kill("SIGTERM");
}
