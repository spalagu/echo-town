import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { PUBLIC_WIRE_FIELD_PATHS, enumerateWireFieldPaths } from "../../packages/privacy-network/src/index.js";

const CANARY = "AP10_PRIVATE_CANARY_7f3b";
const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn("npm", ["run", "preview", "--workspace", "@echo-town/web", "--", "--port", String(port), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const captured = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname.endsWith("/__echo-town-sync")) {
      captured.push({ url: request.url(), method: request.method(), headers: request.headers(), body: request.postData() ?? "" });
      await route.fulfill({ status: 202, contentType: "application/json", body: "{}" });
    } else await route.continue();
  });
  await page.goto(`${origin}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady?.privacyNetwork));
  const local = await page.evaluate(async (canary) => {
    const ready = window.__echoTownReady;
    const actorId = ready.identity.actorId;
    ready.memoryGraph.remember({
      id: "ap10-private-memory",
      ownerActorId: actorId,
      kind: "event",
      summary: `只有本地角色知道：${canary}`,
      sourceEventIds: ["ap10-local-event"],
      subjects: [actorId, "old-clocktower"],
      logicalTime: 10,
      salience: 90,
      emotionalValence: 20,
      confidence: 100,
      visibility: "private",
      consolidationParentIds: [],
      decayClass: "ordinary",
    });
    ready.memoryGraph.consolidate(10);
    await ready.memoryStore.set(ready.memoryGraph.snapshot());
    ready.game.scene.scenes[0].player.setPosition(156, 116);
    const interaction = window.__echoTown.interact();
    const base = {
      worldId: "echo-town-local",
      zoneId: "center",
      senderActorId: actorId,
      messageId: "ap10-message",
      logicalTime: 10,
      activity: {
        schemaVersion: 1,
        id: "ap10-activity",
        actorId,
        kind: "mergeable_local",
        sourceEventIds: ["ap10-local-event"],
        logicalTime: 10,
        publicProjection: { eventType: "ObservedPlace", placeId: "old-clocktower" },
      },
      privateContext: {
        privateMemory: canary,
        rawPrompt: `原始提示词 ${canary}`,
        modelReasoning: `模型内部推理 ${canary}`,
        browserFingerprint: `稳定浏览器指纹 ${canary}`,
      },
    };
    const sent = await ready.privacyNetwork.sendPublicActivity(base);
    const mutations = [];
    for (const mutate of [
      (value) => ({ ...value, activity: { ...value.activity, privateMemory: canary } }),
      (value) => ({ ...value, activity: { ...value.activity, publicProjection: { ...value.activity.publicProjection, rawPrompt: canary } } }),
      (value) => ({ ...value, activity: { ...value.activity, publicProjection: { eventType: "ObservedPlace", placeId: canary } } }),
    ]) {
      try {
        await ready.privacyNetwork.sendPublicActivity(mutate(base));
        mutations.push("green");
      } catch {
        mutations.push("red");
      }
    }
    return {
      actorId,
      interaction,
      hasCanaryLocally: ready.memoryGraph.memory("ap10-private-memory")?.summary.includes(canary),
      sentStatus: sent.status,
      declaredFields: ready.privacyWireFields,
      mutations,
    };
  }, CANARY);

  assert.equal(local.interaction.place, "旧钟楼");
  assert.equal(local.hasCanaryLocally, true);
  assert.equal(local.sentStatus, 202);
  assert.deepEqual(local.mutations, ["red", "red", "red"]);
  assert.equal(captured.length, 1, "被拒绝的 mutation 不得产生网络请求");
  const wire = JSON.parse(captured[0].body);
  assert.equal(captured[0].method, "POST");
  assert.equal(captured[0].headers["x-echo-town-protocol"], "public-activity-v1");
  assert.equal(JSON.stringify(captured).includes(CANARY), false, "私人 canary 不得出现在抓包内容中");
  assert.deepEqual(enumerateWireFieldPaths(wire), PUBLIC_WIRE_FIELD_PATHS);
  assert.deepEqual(local.declaredFields, PUBLIC_WIRE_FIELD_PATHS);
  await page.screenshot({ path: process.env.ECHO_TOWN_SCREENSHOT || "ap10-privacy-network.png", fullPage: true });
  await browser.close();
  console.log(JSON.stringify({
    interactions: 1,
    capturedRequests: captured.length,
    canaryOutbound: 0,
    wireFields: PUBLIC_WIRE_FIELD_PATHS.length,
    exactFieldSet: true,
    rejectedMutations: local.mutations.length,
    localPrivateMemoryRetained: true,
  }, null, 2));
} finally {
  server.kill("SIGTERM");
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
      const response = await fetch(`${origin}/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`静态预览未就绪：${serverOutput}`);
}
