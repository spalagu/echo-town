import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../dist/", import.meta.url);
const root = fileURLToPath(rootUrl);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.name !== "version-manifest.json") files.push(path);
  }
  return files;
}

const paths = await walk(root);
const assets = [];
for (const path of paths.sort()) {
  const content = await readFile(path);
  assets.push({
    path: relative(root, path),
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
}

await writeFile(new URL("version-manifest.json", rootUrl), `${JSON.stringify({
  version: "m2-foundation.1",
  sourceCommit: process.env.SOURCE_COMMIT || process.env.GITHUB_SHA || "local-uncommitted",
  assets,
}, null, 2)}\n`);
console.log(`版本清单已生成：${assets.length} 项静态资源`);
