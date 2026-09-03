import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { FAULT_FIXTURES } from "../../packages/capability-state/src/index.js";

const port = await availablePort();
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
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady?.capabilityController));
  const outcomes = await page.evaluate(async (faults) => {
    const controller = window.__echoTownReady.capabilityController;
    const results = [];
    for (const fault of faults) {
      controller.reset();
      const injected = controller.injectFault(fault.code, results.length + 1);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const ui = document.querySelector("#capability-status").textContent;
      const firstRecovery = controller.reportRecovery(fault.capability, 100);
      const secondRecovery = controller.reportRecovery(fault.capability, 101);
      results.push({
        code: fault.code,
        actual: injected.state[fault.capability],
        expected: fault.status,
        fallbackVisible: ui.includes(fault.fallback),
        degradedVisible: ui.includes("降级") || ui.includes("不可用"),
        firstRecovery: firstRecovery.state[fault.capability],
        secondRecovery: secondRecovery.state[fault.capability],
      });
    }
    controller.reset();
    return results;
  }, FAULT_FIXTURES);
  assert.equal(outcomes.length, 12);
  assert.ok(outcomes.every((item) => item.actual === item.expected));
  assert.ok(outcomes.every((item) => item.fallbackVisible && item.degradedVisible));
  assert.ok(outcomes.every((item) => item.firstRecovery === item.expected && item.secondRecovery === "ready"));
  await page.screenshot({ path: process.env.ECHO_TOWN_SCREENSHOT || "ap08-capability-state.png", fullPage: true });
  console.log(JSON.stringify({ faults: outcomes.length, explicitUi: outcomes.filter((item) => item.fallbackVisible).length, stableRecovery: outcomes.filter((item) => item.secondRecovery === "ready").length }));
  await browser.close();
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
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`静态预览未就绪：${serverOutput}`);
}
