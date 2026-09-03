import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MemoryVaultStore,
  createIdentity,
  exportEncrypted,
  importEncrypted,
  loadOrCreateIdentity,
  sign,
  verify,
} from "../src/index.js";

test("100 个独立身份零碰撞且具有随机角色资料", async () => {
  const identities = await Promise.all(Array.from({ length: 100 }, () => createIdentity()));
  assert.equal(new Set(identities.map((identity) => identity.actorId)).size, 100);
  assert.ok(identities.every((identity) => identity.profile.name && identity.profile.personalitySeed.length === 5));
});

test("同一存储重进稳定，清除后生成新身份", async () => {
  for (let scenario = 0; scenario < 100; scenario += 1) {
    const store = new MemoryVaultStore();
    const first = await loadOrCreateIdentity(store);
    const reopened = await loadOrCreateIdentity(store);
    assert.equal(reopened.actorId, first.actorId);
    await store.clear();
    const replacement = await loadOrCreateIdentity(store);
    assert.notEqual(replacement.actorId, first.actorId);
  }
});

test("签名可验证且篡改会失败", async () => {
  const identity = await createIdentity();
  const payload = { actorId: identity.actorId, intentType: "move", seq: 1 };
  const signature = await sign(identity, payload);
  assert.equal(await verify(identity, payload, signature), true);
  assert.equal(await verify(identity, { ...payload, seq: 2 }, signature), false);
});

test("加密导出可恢复同一身份，错误口令失败", async () => {
  const identity = await createIdentity();
  const backup = await exportEncrypted(identity, "echo-town-test-passphrase");
  const restored = await importEncrypted(backup, "echo-town-test-passphrase");
  assert.equal(restored.actorId, identity.actorId);
  await assert.rejects(() => importEncrypted(backup, "wrong-passphrase"));
});

test("实现不读取浏览器指纹信号", async () => {
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  const forbiddenSignals = [
    "navigator.userAgent", "navigator.platform", "navigator.languages", "navigator.deviceMemory",
    "navigator.hardwareConcurrency", "navigator.mediaDevices", "screen.width", "screen.height",
    "devicePixelRatio", "canvas.toDataURL", "AudioContext", "WEBGL_debug_renderer_info",
  ];
  assert.deepEqual(forbiddenSignals.filter((signal) => source.includes(signal)), []);
});
