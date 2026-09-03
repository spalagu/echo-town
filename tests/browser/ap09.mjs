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

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function validateBudget(report) {
  assert.equal(report.visibleRoles, 20, "最终候选必须显示 20 个角色（含 owner）");
  assert.ok(report.frameCount >= 180, "8 秒采样必须产生足够帧");
  assert.ok(report.p95Fps >= 30, `P95 FPS 不得低于 30，实际 ${report.p95Fps.toFixed(2)}`);
  assert.ok(report.maxLongTaskMs <= 250, `单个主线程长任务不得超过 250 ms，实际 ${report.maxLongTaskMs.toFixed(2)}`);
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__echoTownLongTasks = [];
    if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes("longtask")) {
      new PerformanceObserver((list) => {
        window.__echoTownLongTasks.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ type: "longtask", buffered: true });
    }
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady));
  await page.waitForTimeout(2_000);

  const sample = await page.evaluate(async ({ runCpu }) => {
    const observation = {
      actorId: window.__echoTownReady.identity.actorId,
      logicalTime: 909,
      position: { x: 0, y: 0 },
      nearbyPlaces: [
        { id: "old-clocktower", dx: -1, dy: -1, tags: ["curiosity"] },
        { id: "river-market", dx: 1, dy: 1, tags: ["social"] },
      ],
      needs: [{ kind: "social", level: 73 }],
      visibleEvents: [],
    };
    if (runCpu) await window.__echoTownReady.localMind.configureCpu();
    const warmupStartedAt = performance.now();
    const warmupDecision = await window.__echoTownReady.localMind.decide(observation);
    const warmupMs = performance.now() - warmupStartedAt;
    const frameTimes = [];
    const startedAt = performance.now();
    const frames = new Promise((resolve) => {
      let previous;
      const collect = (now) => {
        if (previous !== undefined) frameTimes.push(now - previous);
        previous = now;
        if (now - startedAt < 8_000) requestAnimationFrame(collect);
        else resolve();
      };
      requestAnimationFrame(collect);
    });
    const inferenceStartedAt = performance.now();
    const decision = await window.__echoTownReady.localMind.decide(observation);
    const inferenceMs = performance.now() - inferenceStartedAt;
    await frames;
    return {
      visibleRoles: window.__echoTown.visibleRoleCount(),
      frameTimes,
      longTasks: window.__echoTownLongTasks,
      inferenceMs,
      warmupMs,
      warmupModel: warmupDecision.model,
      model: decision.model,
      execution: decision.execution,
      languageCandidate: decision.languageCandidate,
      heap: performance.memory ? {
        usedBytes: performance.memory.usedJSHeapSize,
        totalBytes: performance.memory.totalJSHeapSize,
        limitBytes: performance.memory.jsHeapSizeLimit,
      } : null,
    };
  }, { runCpu: process.env.ECHO_TOWN_AP09_CPU === "1" });

  const p95FrameMs = percentile(sample.frameTimes, 0.95);
  const p95Fps = 1_000 / p95FrameMs;
  const averageFps = 1_000 / (sample.frameTimes.reduce((sum, value) => sum + value, 0) / sample.frameTimes.length);
  const longTaskBudget = {
    count: sample.longTasks.length,
    totalMs: sample.longTasks.reduce((sum, value) => sum + value, 0),
    maxMs: sample.longTasks.length ? Math.max(...sample.longTasks) : 0,
  };
  const budgetReport = { visibleRoles: sample.visibleRoles, frameCount: sample.frameTimes.length, p95Fps, maxLongTaskMs: longTaskBudget.maxMs };
  validateBudget(budgetReport);
  assert.throws(() => validateBudget({ ...budgetReport, visibleRoles: 21 }), /20 个角色/, "预算外角色数 mutation 必须判红");
  assert.throws(() => validateBudget({ ...budgetReport, p95Fps: 29.99 }), /不得低于 30/, "低帧率 mutation 必须判红");
  assert.throws(() => validateBudget({ ...budgetReport, maxLongTaskMs: 250.01 }), /不得超过 250/, "主线程阻塞 mutation 必须判红");
  assert.equal(sample.execution, "dedicated-worker");
  if (process.env.ECHO_TOWN_AP09_CPU === "1") {
    assert.equal(sample.model, "cpu-wasm");
    assert.ok(sample.languageCandidate, "CPU/Wasm 本地模型必须生成非空语言候选");
  }
  if (process.env.ECHO_TOWN_AP09_SCREENSHOT) await page.screenshot({ path: process.env.ECHO_TOWN_AP09_SCREENSHOT, fullPage: true });
  await browser.close();
  console.log(JSON.stringify({
    referenceDevice: "Apple M3 / 16 GB / Playwright Chromium",
    sampleSeconds: 8,
    visibleRoles: sample.visibleRoles,
    frames: sample.frameTimes.length,
    p95FrameMs,
    p95Fps,
    averageFps,
    longTasks: longTaskBudget,
    heap: sample.heap,
    inference: { model: sample.model, execution: sample.execution, latencyMs: sample.inferenceMs, generated: Boolean(sample.languageCandidate) },
    warmup: { model: sample.warmupModel, latencyMs: sample.warmupMs },
    mutationsRejected: 3,
  }));
} finally {
  server.kill("SIGTERM");
}
