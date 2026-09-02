import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";

const port = await freePort();
const server = spawn("npm", ["run", "preview", "--workspace", "@echo-town/web", "--", "--port", String(port), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });
await waitForServer();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const outbound = [];
page.on("request", (request) => {
  if (new URL(request.url()).origin !== `http://127.0.0.1:${port}`) outbound.push(request.url());
});

try {
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__echoTownReady?.firstDecision?.personaDecision?.candidates?.length === 3);
  const result = await page.evaluate(async () => {
    const ready = window.__echoTownReady;
    const observation = {
      actorId: ready.identity.actorId,
      logicalTime: 18,
      position: { x: 0, y: 0 },
      nearbyPlaces: [
        { id: "clocktower", dx: -1, dy: -1, tags: ["curiosity"] },
        { id: "market", dx: 1, dy: 1, tags: ["social"] },
      ],
      needs: [{ kind: "curiosity", level: 75 }],
      visibleEvents: [],
    };
    const dilemmas = [];
    for (const dilemma of ready.dilemmaFixtures) {
      const decisions = [];
      for (const personaProfile of ready.personaFixtures) {
        const decision = await ready.localMind.decide(observation, { personaProfile, dilemma });
        decisions.push(decision.personaDecision);
      }
      dilemmas.push({
        id: dilemma.id,
        strategies: new Set(decisions.map((decision) => decision.candidates[0].strategyId)).size,
        reasonsHaveFactors: decisions.every((decision) => decision.candidates.every((candidate) => candidate.factors.length > 0)),
        candidateCountValid: decisions.every((decision) => decision.candidates.length > 0 && decision.candidates.length <= 3),
      });
    }
    const requestDilemma = ready.dilemmaFixtures.find((item) => item.id === "player_request");
    const playerOutcomes = [];
    for (const personaProfile of ready.personaFixtures) {
      const decision = await ready.localMind.decide(observation, { personaProfile, dilemma: requestDilemma });
      playerOutcomes.push(decision.personaDecision.candidates[0].acceptedPlayerSuggestion);
    }
    return {
      execution: (await ready.localMind.status()).execution,
      dilemmas,
      playerAccepted: playerOutcomes.filter(Boolean).length,
      playerRefused: playerOutcomes.filter((value) => !value).length,
      activePersona: ready.personaProfile.id,
      firstFactors: ready.firstDecision.personaDecision.candidates[0].factors,
    };
  });
  assert.equal(result.execution, "dedicated-worker");
  assert.equal(result.dilemmas.length, 10);
  assert.ok(result.dilemmas.every((item) => item.strategies >= 8));
  assert.ok(result.dilemmas.every((item) => item.reasonsHaveFactors && item.candidateCountValid));
  assert.ok(result.playerAccepted > 0 && result.playerRefused > 0);
  assert.ok(result.firstFactors.length > 0);
  assert.deepEqual(outbound, []);
  await page.screenshot({ path: process.env.ECHO_TOWN_SCREENSHOT || "ap18-persona-core.png", fullPage: true });
  console.log(JSON.stringify({ ...result, externalRequests: outbound.length }, null, 2));
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const { port: selected } = listener.address();
      listener.close(() => resolve(selected));
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`静态预览未就绪：${serverOutput}`);
}
