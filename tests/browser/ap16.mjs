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
const webRoot = path.resolve("apps/web");
const viteCli = path.resolve("node_modules/vite/bin/vite.js");
const server = spawn(process.execPath, [viteCli, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: webRoot,
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  const externalRequests = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(`http://127.0.0.1:${port}/`)) externalRequests.push(request.url());
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady?.companion || window.__echoTownBootError));
  const bootError = await page.evaluate(() => window.__echoTownBootError?.message ?? null);
  assert.equal(bootError, null, `浏览器启动失败：${bootError}`);

  const causalReport = await page.evaluate(() => {
    const { companion, worldCore } = window.__echoTownReady;
    const behaviors = companion.behaviors();
    const explanations = behaviors.map((item) => companion.explainBehavior(item.id));
    return {
      behaviors: behaviors.length,
      actions: behaviors.filter((item) => item.type === "action").length,
      statements: behaviors.filter((item) => item.type === "statement").length,
      latestLogicalDay: Math.max(...behaviors.map((item) => item.logicalDay)),
      causalChains: explanations.filter((item) => item.inferred === false && item.events.length > 0
        && item.reason.factors.length > 0 && item.behavior.sourceEventIds[0] === item.events[0].id).length,
      albumMemories: companion.memoryAlbum().length,
      returnSummary: companion.returnSummary(0, 30),
      worldStateHash: worldCore.state_hash(),
    };
  });
  assert.equal(causalReport.behaviors, 20);
  assert.equal(causalReport.actions, 10);
  assert.equal(causalReport.statements, 10);
  assert.ok(causalReport.latestLogicalDay <= 30);
  assert.equal(causalReport.causalChains, 20);
  assert.ok(causalReport.albumMemories > 0);
  assert.equal(causalReport.returnSummary.readOnly, true);
  assert.equal(causalReport.returnSummary.plannerEligible, false);

  await page.locator("#tab-observe").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#tab-heart").getAttribute("aria-selected"), "true");
  await page.locator("#heart-message").fill("PRIVATE-AP16-CANARY");
  await page.locator("#heart-form button[type=submit]").click();
  await page.locator("#heart-feedback").filter({ hasText: "未写入公开世界" }).waitFor();

  for (let index = 0; index < 3; index += 1) {
    await page.locator("#influence-kind").selectOption(["letter", "wish", "gift"][index]);
    await page.locator("#influence-text").fill(`PRIVATE-AP16-CANARY-${index}`);
    await page.locator("#influence-form button[type=submit]").click();
    await page.locator("#influence-list .influence-item").nth(index).waitFor();
  }
  await page.locator("#influence-text").fill("PRIVATE-AP16-CANARY-OVERFLOW");
  await page.locator("#influence-form button[type=submit]").click();
  await page.locator("#influence-feedback").filter({ hasText: "最多保留 3 个" }).waitFor();
  assert.equal(await page.locator(".respond-button").count(), 3);
  await page.locator(".respond-button").first().click();
  await page.waitForFunction(() => !document.querySelector("#influence-feedback").textContent.includes("等待角色回应"));

  const privacyReport = await page.evaluate((beforeHash) => {
    const { companion, worldCore } = window.__echoTownReady;
    const projection = companion.publicProjection();
    const log = companion.influenceLog();
    return {
      publicProjection: projection,
      publicContainsCanary: JSON.stringify(projection).includes("PRIVATE-AP16-CANARY"),
      worldStateUnchanged: worldCore.state_hash() === beforeHash,
      consideredStatus: log[0].status,
      considerationSources: {
        memories: log[0].sourceMemoryIds.length,
        relationships: log[0].sourceRelationshipEventIds.length,
        goalPath: log[0].goalReference?.path,
      },
      allPrivate: companion.heartRoom().every((item) => item.private && !item.worldFact && !item.networkEligible)
        && log.every((item) => item.private && !item.worldFact && !item.networkEligible),
    };
  }, causalReport.worldStateHash);
  assert.deepEqual(privacyReport.publicProjection, { schemaVersion: 1, activities: [] });
  assert.equal(privacyReport.publicContainsCanary, false);
  assert.equal(privacyReport.worldStateUnchanged, true);
  assert.ok(["accepted_as_influence", "refused"].includes(privacyReport.consideredStatus));
  assert.ok(privacyReport.considerationSources.memories > 0);
  assert.ok(privacyReport.considerationSources.relationships > 0);
  assert.equal(privacyReport.considerationSources.goalPath, "desire");
  assert.equal(privacyReport.allPrivate, true);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady?.companion || window.__echoTownBootError));
  const reloadBootError = await page.evaluate(() => window.__echoTownBootError?.message ?? null);
  assert.equal(reloadBootError, null, `浏览器重载失败：${reloadBootError}`);
  await page.locator("#tab-heart").click();
  assert.ok((await page.locator("#heart-log").textContent()).includes("PRIVATE-AP16-CANARY"));
  const restored = await page.evaluate(() => ({
    heartEntries: window.__echoTownReady.companion.heartRoom().length,
    influences: window.__echoTownReady.companion.influenceLog().length,
    publicContainsCanary: JSON.stringify(window.__echoTownReady.companion.publicProjection()).includes("PRIVATE-AP16-CANARY"),
  }));
  assert.equal(restored.heartEntries, 2);
  assert.equal(restored.influences, 3);
  assert.equal(restored.publicContainsCanary, false);
  assert.deepEqual(externalRequests, []);

  const portraitLayout = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(portraitLayout.scrollWidth <= portraitLayout.width, "375px 竖屏不得横向溢出");
  await page.setViewportSize({ width: 812, height: 375 });
  await page.locator("#tab-observe").click();
  await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
  const landscapeLayout = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    companionVisible: document.querySelector("#companion").getBoundingClientRect().width > 0,
  }));
  assert.ok(landscapeLayout.scrollWidth <= landscapeLayout.width, "812×375 横屏与放大字号不得横向溢出");
  assert.equal(landscapeLayout.companionVisible, true);
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator("#tab-heart").click();

  await page.screenshot({ path: process.env.ECHO_TOWN_SCREENSHOT || "ap16-companion.png", fullPage: true });
  await browser.close();
  console.log(JSON.stringify({
    ...causalReport,
    ...privacyReport,
    restored,
    externalRequests: externalRequests.length,
    viewports: ["375x812", "812x375 + 125% 根字号"],
    reducedMotion: true,
  }, null, 2));
} finally {
  server.kill("SIGTERM");
}
