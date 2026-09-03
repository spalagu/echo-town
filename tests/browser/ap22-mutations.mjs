import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { chromium } from "playwright";

const mutationToLink = {
  clock: "clock",
  observation: "observation",
  mind: "mind",
  core: "core",
  "memory-relationship": "memoryRelationship",
  scene: "scene",
};

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

function sameCausalInvariant(snapshot) {
  const links = ["clock", "observation", "mind", "core", "memoryRelationship", "scene"];
  const complete = snapshot.cycles.filter((cycle) => cycle.stage === "completed" && links.every((link) => cycle.links[link]));
  return complete.length >= 2
    && complete.filter((cycle) => cycle.beforeStateHash !== cycle.afterStateHash).length >= 2
    && new Set(complete.flatMap((cycle) => cycle.memoryRecordIds)).size >= 2
    && new Set(complete.flatMap((cycle) => cycle.relationshipChangeIds)).size >= 1
    && new Set(complete.map((cycle) => `${cycle.projectedPosition.x},${cycle.projectedPosition.y}`)).size >= 2;
}

const port = await availablePort();
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
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (attempt === 59) throw new Error(`正式制品预览未就绪：${serverOutput}`);
  }
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const mutation of Object.keys(mutationToLink)) {
    const context = await browser.newContext();
    await context.addInitScript((value) => { window.__ECHO_TOWN_TEST_MUTATION__ = value; }, mutation);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__echoTownReady?.autonomousLife?.snapshot));
    await page.waitForTimeout(6_000);
    const snapshot = await page.evaluate(() => window.__echoTownReady.autonomousLife.snapshot());
    assert.equal(snapshot.mutation, mutation, `${mutation} mutation 未进入本地正式制品`);
    assert.equal(sameCausalInvariant(snapshot), false, `${mutation} 断链后因果不变量仍然为绿`);
    if (mutation !== "clock") {
      assert.ok(snapshot.cycles.length >= 2, `${mutation} 没有产生足够的断链观测轮次`);
      assert.ok(snapshot.cycles.some((cycle) => cycle.links[mutationToLink[mutation]] === false), `${mutation} 没有切断目标连接`);
    } else {
      assert.equal(snapshot.cycles.length, 0, "clock 断链后仍产生了自主轮次");
    }
    results.push({
      mutation,
      cycles: snapshot.cycles.length,
      completeCycles: snapshot.cycles.filter((cycle) => cycle.stage === "completed").length,
      invariant: "red",
    });
    await context.close();
  }
  await browser.close();
  console.log(JSON.stringify({ mutations: results, allRed: true }, null, 2));
} finally {
  server.kill("SIGTERM");
}
