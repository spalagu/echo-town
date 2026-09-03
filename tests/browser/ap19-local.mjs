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
  throw new Error(`静态预览未就绪：${output}`);
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  const externalRequests = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(origin)) externalRequests.push(request.url());
  });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady?.engagementState || window.__echoTownBootError));
  const bootError = await page.evaluate(() => window.__echoTownBootError?.message ?? null);
  assert.equal(bootError, null, `浏览器启动失败：${bootError}`);

  const initial = await page.evaluate(() => {
    const ready = window.__echoTownReady;
    const state = ready.engagementState;
    const eventIds = new Set([
      ...ready.societySimulation.events.map((item) => item.id),
      ...ready.mysteryRuns.flatMap((run) => run.events.map((item) => item.id)),
    ]);
    const claimIds = new Set([
      ...ready.societySimulation.claims.map((item) => item.id),
      ...ready.mysteryRuns.flatMap((run) => run.claims.map((item) => item.id)),
    ]);
    const planIds = new Set(ready.worldContent.packs.filter((pack) => pack.packType === "situation-seed").map((pack) => pack.content.id));
    return {
      count: state.hooks.length,
      kinds: state.hooks.map((item) => item.kind),
      allReadOnly: state.readOnly && !state.worldWritable && state.hooks.every((item) => item.readOnly && !item.worldWritable),
      allSourced: state.hooks.every((item) => item.sourceEventIds.every((id) => eventIds.has(id))
        && item.sourceClaimIds.every((id) => claimIds.has(id))
        && item.sourcePlanIds.every((id) => planIds.has(id))),
      notificationsBounded: state.hooks.every((item) => !item.notificationCandidate
        || (Number.isInteger(item.expiresAtTick) && item.expiresAtTick > state.generatedAtTick)),
      influenceGap: state.coverageGaps.includes("influence"),
      beforeHash: ready.worldCore.state_hash(),
    };
  });
  assert.ok(initial.count >= 3 && initial.count <= 7);
  assert.ok(initial.kinds.includes("relationship"));
  assert.ok(initial.kinds.includes("mystery") || initial.kinds.includes("controversy"));
  assert.ok(initial.kinds.includes("scarcity"));
  assert.equal(initial.allReadOnly, true);
  assert.equal(initial.allSourced, true);
  assert.equal(initial.notificationsBounded, true);
  assert.equal(initial.influenceGap, true);
  assert.equal(await page.locator("#engagement-hook-list .engagement-hook").count(), initial.count);

  await page.locator("#tab-heart").click();
  await page.locator("#influence-kind").selectOption("wish");
  await page.locator("#influence-text").fill("AP19-LOCAL-CANARY：愿你继续倾听旧钟楼，但由你自己决定。");
  await page.locator("#influence-form button[type=submit]").click();
  await page.locator(".respond-button").click();
  await page.waitForFunction(() => window.__echoTownReady.engagementState.hooks.some((item) => item.kind === "contribution"));

  const after = await page.evaluate((beforeHash) => {
    const ready = window.__echoTownReady;
    const contribution = ready.engagementState.hooks.find((item) => item.kind === "contribution");
    const influence = ready.companion.influenceLog().find((item) => item.id === contribution.sourceInfluenceIds[0]);
    return {
      count: ready.engagementState.hooks.length,
      status: influence.status,
      sourceEvents: contribution.sourceEventIds.length,
      sourceInfluences: contribution.sourceInfluenceIds.length,
      readOnly: contribution.readOnly && !contribution.worldWritable,
      worldStateUnchanged: ready.worldCore.state_hash() === beforeHash,
      noPublicCanary: !JSON.stringify(ready.companion.publicProjection()).includes("AP19-LOCAL-CANARY"),
      hasGoals: Object.hasOwn(ready.engagementState, "goals"),
      hasEvents: Object.hasOwn(ready.engagementState, "events"),
    };
  }, initial.beforeHash);
  assert.ok(after.count >= 3 && after.count <= 7);
  assert.ok(["accepted_as_influence", "refused"].includes(after.status));
  assert.ok(after.sourceEvents > 0 && after.sourceInfluences === 1);
  assert.equal(after.readOnly, true);
  assert.equal(after.worldStateUnchanged, true);
  assert.equal(after.noPublicCanary, true);
  assert.equal(after.hasGoals, false);
  assert.equal(after.hasEvents, false);
  assert.deepEqual(externalRequests, []);

  const portrait = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(portrait.scrollWidth <= portrait.width);
  await page.setViewportSize({ width: 812, height: 375 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
  const landscape = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(landscape.scrollWidth <= landscape.width);
  await page.screenshot({ path: process.env.ECHO_TOWN_SCREENSHOT || "ap19-engagement.png", fullPage: true });
  await browser.close();
  console.log(JSON.stringify({ initial, after, externalRequests: externalRequests.length, viewports: ["375x812", "812x375 + 125% 根字号"] }, null, 2));
} finally {
  server.kill("SIGTERM");
}
