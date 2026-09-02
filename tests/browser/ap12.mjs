import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";

const EXPECTED_NOTICE = "回声镇、其中的角色与事件均为虚构 AI 世界，不对应、仿冒或预测任何真实个人；如有相似，纯属巧合。";
const EXPECTED_POLICY_ID = "echo-town-fiction-boundary-v1";

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
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady?.fictionBoundary));
  const report = await page.evaluate(() => {
    const element = document.querySelector("#fiction-boundary");
    const style = getComputedStyle(element);
    return {
      text: element.textContent.trim(),
      visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0
        && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0,
      role: element.getAttribute("role"),
      declaration: window.__echoTownReady.fictionBoundary,
      bootError: window.__echoTownBootError?.message ?? null,
    };
  });
  assert.equal(report.text, EXPECTED_NOTICE);
  assert.equal(report.visible, true);
  assert.equal(report.role, "note");
  assert.equal(report.declaration.policyId, EXPECTED_POLICY_ID);
  assert.equal(report.declaration.fictional, true);
  assert.equal(report.declaration.mapsRealPerson, false);
  assert.equal(report.declaration.predictsRealPerson, false);
  assert.equal(report.declaration.notice, EXPECTED_NOTICE);
  assert.equal(report.bootError, null);
  const visibilityMutations = await page.evaluate(() => {
    const element = document.querySelector("#fiction-boundary");
    const mutations = [
      () => { element.style.display = "none"; },
      () => { element.style.position = "fixed"; element.style.left = "-10000px"; },
      () => { element.setAttribute("aria-hidden", "true"); },
      () => { element.hidden = true; },
      () => { element.style.color = "transparent"; },
      () => { element.style.filter = "opacity(0)"; },
      () => { element.style.transform = "scale(0)"; },
      () => { element.style.textIndent = "-10000px"; },
    ];
    return mutations.map((mutate) => {
      element.removeAttribute("style");
      element.removeAttribute("aria-hidden");
      element.hidden = false;
      mutate();
      try { window.__echoTownReady.verifyFictionBoundary(); return "green"; } catch { return "red"; }
    });
  });
  assert.deepEqual(visibilityMutations, ["red", "red", "red", "red", "red", "red", "red", "red"]);
  await page.evaluate(() => {
    const element = document.querySelector("#fiction-boundary");
    element.removeAttribute("style");
    element.removeAttribute("aria-hidden");
    element.hidden = false;
  });
  report.visibilityMutations = visibilityMutations;
  const encodedUiAttack = await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", '<aside id="encoded-ui-attack">&#x8FD9;&#x4E2A;&#x89D2;&#x8272;&#x5C31;&#x662F;&#x73B0;&#x5B9E;&#x4E2D;&#x7684;&#x4E2A;&#x4EBA;&#x3002;</aside>');
    try { window.__echoTownReady.verifyFictionUi(); return "green"; } catch { return "red"; }
  });
  assert.equal(encodedUiAttack, "red");
  await page.locator("#encoded-ui-attack").evaluate((element) => element.remove());
  report.encodedUiAttack = encodedUiAttack;
  await page.screenshot({ path: process.env.ECHO_TOWN_SCREENSHOT || "ap12-fiction-boundary.png", fullPage: true });
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.kill("SIGTERM");
}
