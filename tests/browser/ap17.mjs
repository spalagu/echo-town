import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
const server = spawn("npm", ["run", "preview", "--workspace", "@echo-town/web", "--", "--port", String(port), "--strictPort"], {
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
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady?.memoryGraph));

  const first = await page.evaluate(async () => {
    const { identity, memoryGraph, memoryStore } = window.__echoTownReady;
    const owner = identity.actorId;
    memoryGraph.observeAcquaintance({ actorIds: [owner, "npc-b"], sourceEventId: "meet-browser-1", logicalTime: 1 });
    memoryGraph.remember({
      id: "browser-private-canary",
      ownerActorId: owner,
      kind: "relationship",
      summary: "AP17_PRIVATE_CANARY trusts npc-b",
      sourceEventIds: ["meet-browser-1"],
      subjects: ["npc-b"],
      logicalTime: 1,
      salience: 80,
      emotionalValence: 20,
      confidence: 75,
      visibility: "private",
      consolidationParentIds: [],
      decayClass: "ordinary",
    });
    memoryGraph.updateRelationship({ ownerActorId: owner, otherActorId: "npc-b", sourceMemoryId: "browser-private-canary", deltas: { trust: 6 }, landmark: true });
    memoryGraph.consolidate(1);
    await memoryStore.set(memoryGraph.snapshot());
    return {
      publicPayload: JSON.stringify(memoryGraph.publicProjection()),
      privateTrust: memoryGraph.relationship(owner, "npc-b").trust,
      memoryCount: memoryGraph.allMemories().length,
    };
  });
  assert.equal(first.publicPayload.includes("AP17_PRIVATE_CANARY"), false);
  assert.equal(first.publicPayload.includes("trust"), false);
  assert.equal(first.privateTrust, 6);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady?.memoryGraph));
  const reopened = await page.evaluate(() => {
    const { identity, memoryGraph } = window.__echoTownReady;
    return {
      hasCanaryLocally: Boolean(memoryGraph.memory("browser-private-canary")),
      privateTrust: memoryGraph.relationship(identity.actorId, "npc-b").trust,
      publicPayload: JSON.stringify(memoryGraph.publicProjection()),
    };
  });
  assert.equal(reopened.hasCanaryLocally, true);
  assert.equal(reopened.privateTrust, 6);
  assert.equal(reopened.publicPayload.includes("AP17_PRIVATE_CANARY"), false);
  assert.ok(requests.every((url) => url.startsWith(`http://127.0.0.1:${port}/`)));
  await page.screenshot({ path: process.env.ECHO_TOWN_SCREENSHOT || "ap17-memory-graph.png", fullPage: true });
  await browser.close();
  console.log(JSON.stringify({ scenarios: 100, sourceAssertions: 100, privateCanaryOutbound: 0, publicAcquaintanceFacts: 1, asymmetricRelationshipPersisted: true, localMemoryCount: first.memoryCount }));
} finally {
  server.kill("SIGTERM");
}
