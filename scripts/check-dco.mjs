import { execFileSync } from "node:child_process";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const head = process.env.GITHUB_HEAD_SHA || "HEAD";
const base = process.env.GITHUB_BASE_SHA || git("merge-base", "origin/main", head);
if (!/^(?:[0-9a-f]{40}|HEAD)$/.test(head) || !/^[0-9a-f]{40}$/.test(base)) throw new Error("DCO 检查只接受 Git SHA");
const output = git("log", "--format=%H%x1f%an%x1f%ae%x1f%B%x1e", `${base}..${head}`);
const commits = output.split("\x1e").map((item) => item.trim()).filter(Boolean);
if (commits.length === 0) throw new Error("DCO 检查范围没有提交");
const failures = [];
for (const record of commits) {
  const [sha, author, email, ...messageParts] = record.split("\x1f");
  const message = messageParts.join("\x1f");
  const expected = `Signed-off-by: ${author} <${email}>`;
  if (!message.split("\n").some((line) => line.trim() === expected)) failures.push(`${sha.slice(0, 12)} 缺少 ${expected}`);
}
if (failures.length) throw new Error(`DCO 检查失败：\n${failures.join("\n")}`);
console.log(`DCO 检查通过：${commits.length} 个提交`);
