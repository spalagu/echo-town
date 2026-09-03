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
  const page = await browser.newPage();
  const externalRequests = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(`http://127.0.0.1:${port}/`)) externalRequests.push(request.url());
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownSocietyReady?.societySimulation));
  const report = await page.evaluate(() => {
    const { societySimulation: result, societyValidation } = window.__echoTownSocietyReady;
    const actions = result.events.filter((event) => event.actionAffordance);
    const actionIds = new Set(actions.map((event) => event.id));
    const memories = new Map(result.memories.map((memory) => [memory.id, memory]));
    const eventIndexes = new Map(result.events.map((event, index) => [event.id, index]));
    const claimIndexes = new Map(result.claims.map((claim, index) => [claim.id, index]));
    return {
      validation: societyValidation,
      events: result.events.length,
      claims: result.claims.length,
      actionRounds: new Set(actions.map((event) => `${event.situationId}:${event.phase}`)).size,
      memoryFeedbackActions: actions.filter((event) => event.memoryInputIds.some((id) => memories.get(id)?.sourceEventIds.some((sourceId) => actionIds.has(sourceId)))).length,
      discourseFeedbackActions: actions.filter((event) => event.claimInputIds.length > 0).length,
      affordanceBoundActions: actions.filter((event) => event.availableAffordances.includes(event.actionAffordance)).length,
      actions: actions.length,
      temporaryLedgerEntries: result.resourceLedger.filter((entry) => entry.kind === "temporary").length,
      settledTemporaryEntries: result.resourceLedger.filter((entry) => entry.kind === "temporary" && entry.settledAtTick === entry.expiresAtTick).length,
      naturalExpiryEvents: result.events.filter((event) => event.kind === "resource_naturally_expired").length,
      pendingTemporaryResources: result.pendingTemporaryResources,
      replayStable: result.events.every((event, index) => event.sequence === index
        && (index === 0 || result.events[index - 1].tick <= event.tick)
        && event.sourceEventIds.every((id) => eventIndexes.get(id) < index))
        && result.claims.every((claim, index) => (claim.parentClaimId === null || claimIndexes.get(claim.parentClaimId) < index)
          && (claim.refutesClaimId === null || claimIndexes.get(claim.refutesClaimId) < index)),
      summaryReadOnly: result.historicalSummary.readOnly,
      summaryAbsentFromPlanner: result.plannerObservations.every((item) => !JSON.stringify(item).includes(result.historicalSummary.id)),
      trajectorySignature: result.trajectorySignature,
    };
  });
  assert.equal(report.validation.ok, true);
  assert.ok(report.actionRounds >= 2);
  assert.ok(report.memoryFeedbackActions > 0);
  assert.ok(report.discourseFeedbackActions > 0);
  assert.equal(report.affordanceBoundActions, report.actions);
  assert.equal(report.settledTemporaryEntries, report.temporaryLedgerEntries);
  assert.ok(report.naturalExpiryEvents > 0);
  assert.equal(report.pendingTemporaryResources, 0);
  assert.equal(report.replayStable, true);
  assert.equal(report.summaryReadOnly, true);
  assert.equal(report.summaryAbsentFromPlanner, true);
  assert.deepEqual(externalRequests, []);
  await page.screenshot({ path: process.env.ECHO_TOWN_SCREENSHOT || "ap21-society-runtime.png", fullPage: true });
  await browser.close();
  console.log(JSON.stringify({ ...report, externalRequests: externalRequests.length }, null, 2));
} finally {
  server.kill("SIGTERM");
}
