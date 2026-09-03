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

function completeCycles(snapshot) {
  const links = ["clock", "observation", "mind", "core", "memoryRelationship", "scene"];
  return snapshot.cycles.filter((cycle) => cycle.stage === "completed" && links.every((link) => cycle.links[link]));
}

function verifySnapshot(snapshot, { requireRules = false } = {}) {
  const cycles = completeCycles(snapshot);
  assert.ok(cycles.length >= 8, `60 秒内完整自主链只有 ${cycles.length} 条`);
  assert.ok(cycles[0].startedAtMs <= 2_000, `首次自主决策在 ${cycles[0].startedAtMs}ms 才开始`);
  assert.ok(snapshot.maxConcurrent <= 1, `出现 ${snapshot.maxConcurrent} 轮并发决策`);
  for (let index = 1; index < cycles.length; index += 1) {
    const gap = cycles[index].startedAtMs - cycles[index - 1].completedAtMs;
    assert.ok(gap <= 5_000, `第 ${index + 1} 轮在上一轮结束 ${gap}ms 后才开始`);
  }
  assert.ok(new Set(cycles.map((cycle) => `${cycle.projectedPosition.x},${cycle.projectedPosition.y}`)).size >= 3, "角色位置快照少于 3 个");
  assert.ok(cycles.filter((cycle) => cycle.beforeStateHash !== cycle.afterStateHash).length >= 8, "World Core stateHash 变化少于 8 次");
  assert.ok(new Set(cycles.flatMap((cycle) => cycle.memoryRecordIds)).size >= 8, "来源化记忆少于 8 条");
  assert.ok(new Set(cycles.flatMap((cycle) => cycle.relationshipChangeIds)).size >= 1, "关系没有发生变化");
  assert.ok(cycles.every((cycle) => cycle.observation.memorySourceEventIds.length > 0 || cycle.cycleId === 1), "上一轮 Event 没有反馈进后续 Observation");
  if (requireRules) assert.ok(cycles.every((cycle) => cycle.mindMode === "rules"), "强制 rules 基线出现了非 rules 决策");
  return cycles;
}

async function runBaseline({ forceRules }) {
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
    const context = await browser.newContext();
    const page = await context.newPage();
    const externalRequests = [];
    page.on("request", (request) => {
      if (!request.url().startsWith(`http://127.0.0.1:${port}/`)) externalRequests.push(request.url());
    });
    await page.goto(`http://127.0.0.1:${port}/${forceRules ? "?forceRules=1" : ""}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__echoTownReady));
    await page.waitForFunction(() => Boolean(window.__echoTownReady?.autonomousLife?.snapshot), null, { timeout: 10_000 });
    await page.waitForTimeout(60_000);
    const snapshot = await page.evaluate(() => window.__echoTownReady.autonomousLife.snapshot());
    const cycles = verifySnapshot(snapshot, { requireRules: forceRules });
    assert.deepEqual(externalRequests, [], "自主生活不应依赖外部请求");
    assert.equal(await page.evaluate(() => window.__echoTown.directControl), false);
    assert.equal(await page.evaluate(() => typeof window.__echoTown.moveTo), "undefined");
    const completedBeforeInputCheck = await page.evaluate(() => window.__echoTownReady.autonomousLife.snapshot().cycles
      .filter((cycle) => cycle.stage === "completed").length);
    await page.waitForFunction((count) => {
      const snapshot = window.__echoTownReady.autonomousLife.snapshot();
      return snapshot.status === "idle" && snapshot.cycles.filter((cycle) => cycle.stage === "completed").length > count;
    }, completedBeforeInputCheck);
    const beforeInput = await page.evaluate(() => window.__echoTown.position());
    await page.keyboard.down("KeyW");
    await page.mouse.click(140, 110);
    await page.waitForTimeout(300);
    await page.keyboard.up("KeyW");
    const afterInput = await page.evaluate(() => window.__echoTown.position());
    assert.deepEqual(afterInput, beforeInput, "键盘或地图点击仍能直接移动角色");
    await browser.close();
    return {
      forceRules,
      completeCycles: cycles.length,
      firstDecisionMs: cycles[0].startedAtMs,
      uniquePositions: new Set(cycles.map((cycle) => `${cycle.projectedPosition.x},${cycle.projectedPosition.y}`)).size,
      changedHashes: cycles.filter((cycle) => cycle.beforeStateHash !== cycle.afterStateHash).length,
      memories: new Set(cycles.flatMap((cycle) => cycle.memoryRecordIds)).size,
      relationshipChanges: new Set(cycles.flatMap((cycle) => cycle.relationshipChangeIds)).size,
      maxConcurrent: snapshot.maxConcurrent,
      externalRequests: externalRequests.length,
    };
  } finally {
    server.kill("SIGTERM");
  }
}

const baseline = await runBaseline({ forceRules: false });
const rules = await runBaseline({ forceRules: true });
console.log(JSON.stringify({ baseline, rules }, null, 2));
