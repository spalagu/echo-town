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

async function actorId(page) {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__echoTownReady));
  return page.evaluate(() => window.__echoTownReady.identity.actorId);
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  const first = await actorId(firstPage);
  const second = await actorId(secondPage);
  assert.notEqual(first, second, "两个独立浏览器 profile 不得合并身份");
  const reopened = await actorId(firstPage);
  assert.equal(reopened, first, "同一 profile 重开必须保持身份");
  await firstPage.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("echo-town-identity");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }));
  const replacement = await actorId(firstPage);
  assert.notEqual(replacement, first, "显式清除后必须生成新身份");
  await browser.close();
  console.log(JSON.stringify({ profiles: 2, stableReopen: true, isolated: true, clearCreatesNewIdentity: true }));
} finally {
  server.kill("SIGTERM");
}
