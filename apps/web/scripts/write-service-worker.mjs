import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const rootUrl = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("version-manifest.json", rootUrl), "utf8"));
const fingerprint = createHash("sha256")
  .update(JSON.stringify(manifest.assets.map(({ path, sha256 }) => [path, sha256])))
  .digest("hex")
  .slice(0, 16);
const resources = ["./", "./index.html", "./version-manifest.json", ...manifest.assets.map(({ path }) => `./${path}`)]
  .filter((value, index, values) => values.indexOf(value) === index);
const source = `const CACHE_NAME = "echo-town-${fingerprint}";
const RESOURCES = ${JSON.stringify(resources, null, 2)};
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(RESOURCES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("echo-town-") && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(event.request, { ignoreVary: true }).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
`;
await writeFile(new URL("sw.js", rootUrl), source);
console.log(`离线 Service Worker 已生成：echo-town-${fingerprint}，${resources.length} 项资源`);
