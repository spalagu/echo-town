import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const port = await availablePort();
const origin = `http://127.0.0.1:${port}/`;
const room = `ap05-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const server = spawn(process.execPath, [path.resolve("node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: path.resolve("apps/web"), stdio: ["ignore", "pipe", "pipe"], env: process.env,
});
let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`AP-05 静态预览未就绪：${output}`);
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const external = [[], []];
  pages.forEach((page, index) => page.on("request", (request) => {
    if (!request.url().startsWith(origin)) external[index].push(request.url());
  }));
  await Promise.all(pages.map((page) => page.goto(`${origin}?sync=1&syncRoom=${room}`, { waitUntil: "domcontentloaded" })));
  await Promise.all(pages.map((page) => page.waitForFunction(() => Boolean(window.__echoTownReady || window.__echoTownBootError))));
  try {
    await Promise.all(pages.map((page) => page.waitForFunction(() => window.__echoTownReady?.worldSync?.status().received.length >= 1, null, { timeout: 45_000 })));
  } catch (error) {
    const diagnostics = await Promise.all(pages.map((page) => page.evaluate(() => ({
      bootError: window.__echoTownBootError?.message ?? null,
      status: window.__echoTownReady?.worldSync?.status() ?? null,
    }))));
    throw new Error(`公共节点双浏览器 45 秒内未收敛：${JSON.stringify({ diagnostics, external }, null, 2)}`, { cause: error });
  }
  await Promise.all(pages.map((page) => page.waitForFunction(
    () => window.__echoTownReady.worldSync.status().strategies.every((strategy) => strategy.peerCount >= 1),
    null,
    { timeout: 30_000 },
  )));
  const eventStartedAt = Date.now();
  await pages[0].evaluate(() => window.__echoTownReady.worldSync.sendPresence());
  await pages[1].waitForFunction(() => window.__echoTownReady.worldSync.status().snapshot.activities.length >= 3, null, { timeout: 3_000 });
  const ordinaryEventLatencyMs = Date.now() - eventStartedAt;
  assert.ok(ordinaryEventLatencyMs < 3_000, `普通事件可见性超过 3 秒：${ordinaryEventLatencyMs}ms`);
  const results = await Promise.all(pages.map((page) => page.evaluate(() => ({
    actorId: window.__echoTownReady.identity.actorId,
    bootError: window.__echoTownBootError?.message ?? null,
    status: window.__echoTownReady.worldSync.status(),
    privateWireLeak: JSON.stringify(window.__echoTownReady.worldSync.status()).includes("PRIVATE"),
    networkCapability: window.__echoTownReady.capabilityController.state().network,
  }))));
  assert.notEqual(results[0].actorId, results[1].actorId);
  for (const result of results) {
    assert.equal(result.bootError, null);
    assert.equal(result.privateWireLeak, false);
    assert.equal(result.networkCapability, "ready");
    assert.deepEqual(result.status.strategies.map((strategy) => strategy.protocol), ["nostr", "webtorrent"]);
    assert.ok(result.status.strategies.every((strategy) => strategy.peerCount >= 1), "Nostr/WebTorrent 未分别建立真实 WebRTC peer");
    assert.ok(result.status.strategies.some((strategy) => strategy.relaySockets.some((socket) => socket.readyState === 1)), "没有登记公共节点处于已连接状态");
    assert.ok(result.status.received.some((item) => item.actorId !== result.actorId));
    assert.equal(result.status.snapshot.activities.length >= 2, true);
  }
  const allowedHosts = new Set(results[0].status.strategies.flatMap((strategy) => strategy.endpoints.map((value) => new URL(value).hostname)));
  for (const requests of external) {
    assert.equal(requests.every((value) => allowedHosts.has(new URL(value).hostname)), true, `出现未登记外部请求：${requests.join(", ")}`);
  }
  if (process.env.ECHO_TOWN_AP05_SCREENSHOT) await pages[0].screenshot({ path: process.env.ECHO_TOWN_AP05_SCREENSHOT, fullPage: true });
  await pages[0].goto(origin, { waitUntil: "domcontentloaded" });
  await pages[0].waitForFunction(() => Boolean(window.__echoTownReady || window.__echoTownBootError));
  const reopened = await pages[0].evaluate(() => ({
    activities: window.__echoTownReady.worldSync.status().snapshot.activities.length,
    networkCapability: window.__echoTownReady.capabilityController.state().network,
    bootError: window.__echoTownBootError?.message ?? null,
  }));
  assert.equal(reopened.bootError, null);
  assert.ok(reopened.activities >= 3);
  assert.equal(reopened.networkCapability, "unavailable");
  console.log(JSON.stringify({
    room,
    discoveryTimeoutMs: 45_000,
    ordinaryEventLatencyMs,
    reopened,
    peers: results.map((result, index) => ({
      actorId: result.actorId,
      received: result.status.received.length,
      activities: result.status.snapshot.activities.length,
      strategies: result.status.strategies.map((strategy) => ({ protocol: strategy.protocol, peerCount: strategy.peerCount, relaySockets: strategy.relaySockets })),
      externalHosts: [...new Set(external[index].map((value) => new URL(value).hostname))],
      errors: result.status.errors,
    })),
  }, null, 2));
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
