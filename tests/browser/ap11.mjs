import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";

const port = await availablePort();
const url = `http://127.0.0.1:${port}/`;
let server = startServer();
let serverOutput = "";

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  let page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__echoTownReady?.offlineWorker?.controlled === true);
  const online = await page.evaluate(async () => {
    const ready = window.__echoTownReady;
    const owner = ready.identity.actorId;
    ready.memoryGraph.remember({
      id: "ap11-offline-memory",
      ownerActorId: owner,
      kind: "event",
      summary: "断网前看见旧钟楼的指针轻微晃动。",
      sourceEventIds: ["ap11-before-offline"],
      subjects: ["old-clocktower"],
      logicalTime: 11,
      salience: 72,
      emotionalValence: 8,
      confidence: 80,
      visibility: "private",
      consolidationParentIds: [],
      decayClass: "ordinary",
    });
    ready.memoryGraph.consolidate(11);
    await ready.memoryStore.set(ready.memoryGraph.snapshot());
    ready.offlineQueue.record({
      schemaVersion: 1,
      id: "ap11-pending-activity",
      actorId: owner,
      kind: "mergeable_local",
      sourceEventIds: ["ap11-before-offline"],
      logicalTime: 11,
      publicProjection: { eventType: "ObservedPlace", placeId: "old-clocktower" },
    });
    await ready.offlineStore.set(ready.offlineQueue.snapshot());
    const cacheNames = await caches.keys();
    const entries = await caches.open(cacheNames[0]).then((cache) => cache.keys());
    return { actorId: owner, stateHash: ready.stateHash, cacheNames, cacheEntries: entries.length, cacheUrls: entries.map((request) => request.url) };
  });
  assert.ok(online.cacheNames.some((name) => name.startsWith("echo-town-")));
  assert.ok(online.cacheEntries >= 10);
  await page.close();

  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  const reopens = [];
  for (let index = 0; index < 10; index += 1) {
    page = await context.newPage();
    const failedRequests = [];
    page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForFunction(() => Boolean(window.__echoTownReady?.game || window.__echoTownBootError), undefined, { timeout: 5_000 });
    } catch {
      const diagnostic = await page.evaluate(() => ({
        title: document.title,
        text: document.body?.innerText?.slice(0, 240),
        controlled: Boolean(navigator.serviceWorker?.controller),
        scripts: Array.from(document.scripts, (script) => script.src),
      }));
      throw new Error(`第 ${index + 1} 次离线重开未启动：${JSON.stringify({ ...diagnostic, failedRequests, cacheUrls: online.cacheUrls })}`);
    }
    const bootError = await page.evaluate(() => window.__echoTownBootError?.message ?? null);
    if (bootError) throw new Error(`第 ${index + 1} 次离线重开失败：${bootError}`);
    const result = await page.evaluate(() => {
      const ready = window.__echoTownReady;
      return {
        actorId: ready.identity.actorId,
        stateHash: ready.stateHash,
        hasMemory: Boolean(ready.memoryGraph.memory("ap11-offline-memory")),
        pending: ready.offlineQueue.prepareResync().activities.length,
        containsPrivatePayload: ready.offlineQueue.prepareResync().containsPrivatePayload,
        capabilityText: document.querySelector("#capability-status").textContent,
        runtimeText: document.querySelector("#runtime-status").textContent,
        canvas: Boolean(document.querySelector("#game canvas")),
      };
    });
    reopens.push(result);
    if (index === 9) await page.screenshot({ path: process.env.ECHO_TOWN_SCREENSHOT || "ap11-offline-reopen.png", fullPage: true });
    await page.close();
  }
  assert.ok(reopens.every((item) => item.actorId === online.actorId));
  assert.ok(reopens.every((item) => item.stateHash === online.stateHash));
  assert.ok(reopens.every((item) => item.hasMemory && item.pending === 1 && !item.containsPrivatePayload));
  assert.ok(reopens.every((item) => item.capabilityText.includes("连接不可用") && item.capabilityText.includes("离线单人")));
  assert.ok(reopens.every((item) => item.runtimeText.includes("离线缓存就绪") && item.canvas));

  serverOutput = "";
  server = startServer();
  await waitForServer();
  page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady?.offlineQueue));
  const restored = await page.evaluate(() => ({
    online: navigator.onLine,
    resyncReady: window.__echoTownReady.offlineQueue.prepareResync(),
  }));
  assert.equal(restored.online, true);
  assert.equal(restored.resyncReady.activities.length, 1);
  assert.equal(restored.resyncReady.containsPrivatePayload, false);
  await page.close();
  await browser.close();
  console.log(JSON.stringify({ onlineCacheEntries: online.cacheEntries, offlineReopens: reopens.length, stableIdentity: true, stableMemory: true, explicitOffline: true, resyncReadyAfterOnline: true }));
} finally {
  if (server && server.exitCode === null) server.kill("SIGTERM");
}

function startServer() {
  const child = spawn("npm", ["run", "preview", "--workspace", "@echo-town/web", "--", "--port", String(port), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  child.stdout.on("data", (chunk) => { serverOutput += chunk; });
  child.stderr.on("data", (chunk) => { serverOutput += chunk; });
  return child;
}

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port: selected } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return selected;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`静态预览未就绪：${serverOutput}`);
}
