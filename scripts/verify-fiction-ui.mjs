import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assessFictionalContent, FICTION_NOTICE } from "../packages/fiction-boundary/src/index.js";

const UI_EXTENSIONS = new Set([".css", ".html", ".js", ".json"]);

async function listUiFiles(root, current = root, output = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules" || entry.name === "public") continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) await listUiFiles(root, absolute, output);
    else if (entry.isFile() && UI_EXTENSIONS.has(path.extname(entry.name))) output.push(absolute);
  }
  return output.sort();
}

export async function verifyFictionUi(root) {
  const files = await listUiFiles(root);
  let noticeCount = 0;
  const reviewSignals = [];
  for (const absolute of files) {
    const source = await readFile(absolute, "utf8");
    if (path.extname(absolute) === ".html") noticeCount += source.split(FICTION_NOTICE).length - 1;
    const assessment = assessFictionalContent(source.replaceAll(FICTION_NOTICE, ""), path.relative(root, absolute));
    reviewSignals.push(...assessment.reviewSignals);
  }
  if (noticeCount !== 1) throw new Error(`UI 必须且只能包含一份冻结虚构边界文案，当前为 ${noticeCount} 份`);
  return { files: files.length, noticeCount, humanReviewRequired: reviewSignals.length > 0, reviewSignals };
}

async function main() {
  const root = path.resolve(process.argv[2] ?? "apps/web");
  const result = await verifyFictionUi(root);
  console.log(`fiction-ui 通过：${result.files} 个 UI 源文件，${result.noticeCount} 份冻结边界文案，${result.reviewSignals.length} 个人工复核信号`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
