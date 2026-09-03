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

function observation(index) {
  return {
    actorId: "echo_ap03",
    logicalTime: index,
    position: { x: index, y: -index },
    nearbyPlaces: [
      { id: "home", dx: -2, dy: 1, tags: ["rest"] },
      { id: "market", dx: 3, dy: -1, tags: ["social"] },
    ],
    needs: [{ kind: index % 2 === 0 ? "rest" : "social", level: 70 + (index % 20) }],
    visibleEvents: [],
  };
}

const cloudInferenceHosts = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.cohere.com",
  "api.mistral.ai",
  "api-inference.huggingface.co",
]);

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
  if (process.env.ECHO_TOWN_AP03_CPU === "1") {
    await page.addInitScript(() => { window.__echoTownAp03Cpu = true; });
  }
  const requests = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (cloudInferenceHosts.has(url.hostname)) await route.abort("blockedbyclient");
    else await route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady));

  const result = await page.evaluate(async (scenarios) => {
    const mind = window.__echoTownReady.localMind;
    const status = await mind.status();
    const decisions = [];
    for (const scenario of scenarios) decisions.push(await mind.decide(scenario));
    const mutation = await mind.gate([{
      schemaVersion: 1,
      intentType: "move",
      payload: { dx: 1, dy: 0 },
      budget: 1,
      reasonCode: "mutation",
      writeWorldState: true,
    }]);
    let cpu = null;
    if (window.__echoTownAp03Cpu) {
      await mind.configureCpu();
      cpu = await mind.decide(scenarios[0]);
    }
    return { status, decisions, mutation, cpu };
  }, Array.from({ length: 50 }, (_, index) => observation(index)));

  assert.equal(result.status.execution, "dedicated-worker");
  assert.equal(result.decisions.length, 50);
  for (const decision of result.decisions) {
    assert.equal(decision.execution, "dedicated-worker");
    assert.equal(decision.model, "rules");
    assert.equal(decision.intents.length, 1);
    assert.equal(decision.intents[0].schemaVersion, 1);
    assert.equal(decision.intents[0].intentType, "move");
    assert.ok(Math.abs(decision.intents[0].payload.dx) <= 1);
    assert.ok(Math.abs(decision.intents[0].payload.dy) <= 1);
  }
  assert.equal(result.mutation.ok, false, "越权字段 mutation 必须被 gate 拒绝");
  assert.equal(requests.some((value) => cloudInferenceHosts.has(new URL(value).hostname)), false, "不得请求云推理端点");
  if (process.env.ECHO_TOWN_AP03_CPU === "1") {
    assert.equal(result.cpu.model, "cpu-wasm");
    assert.ok(result.cpu.languageCandidate, "CPU/Wasm 必须生成非空语言候选");
  }
  assert.ok(await page.locator("#mind-status").getByText("dedicated-worker", { exact: false }).isVisible());
  await page.screenshot({ path: process.env.ECHO_TOWN_SCREENSHOT || "ap03-local-mind.png", fullPage: true });
  await browser.close();
  console.log(JSON.stringify({ scenarios: result.decisions.length, legal: 50, execution: result.status.execution, mode: result.status.mode, cloudInferenceRequests: 0, mutationRejected: true, cpu: result.cpu ? { model: result.cpu.model, languageCandidate: result.cpu.languageCandidate } : null }));
} finally {
  server.kill("SIGTERM");
}
