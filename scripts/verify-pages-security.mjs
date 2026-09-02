import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PAGE_ACTIONS = Object.freeze({
  upload: "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9",
  deploy: "actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
});

function jobBlock(text, name) {
  const start = text.search(new RegExp(`^  ${name}:\\s*$`, "mu"));
  if (start < 0) return "";
  const tail = text.slice(start + 1);
  const next = tail.search(/^  [a-zA-Z0-9_-]+:\s*$/mu);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
}

export function validatePagesWorkflow(text) {
  const problems = [];
  const triggerStart = text.search(/^on:\s*$/mu);
  const permissionsStart = text.search(/^permissions:\s*$/mu);
  const trigger = triggerStart >= 0 && permissionsStart > triggerStart ? text.slice(triggerStart, permissionsStart).trim() : "";
  if (trigger !== "on:\n  push:\n    branches:\n      - main") problems.push("Pages workflow 必须只由 main push 触发");
  if (/pull_request|pull_request_target|workflow_run|workflow_dispatch|schedule|repository_dispatch/u.test(trigger)) {
    problems.push("Pages workflow 含非可信或人工绕过触发器");
  }
  if (!/^permissions:\s*\n  contents:\s*read\s*$/mu.test(text)
    || /write-all|read-all|\$\{\{\s*secrets\.|\$\{\{\s*github\.token|\bGITHUB_TOKEN\b/u.test(text)) {
    problems.push("Pages workflow 全局权限必须只有 contents: read 且不得读取 secret/token");
  }
  if (!/^concurrency:\s*\n  group:\s*pages\s*\n  cancel-in-progress:\s*false\s*$/mu.test(text)) {
    problems.push("Pages concurrency 必须保留正在执行的生产部署");
  }
  if (/self-hosted|continue-on-error:\s*true|\|\|\s*true|if:\s*always\(\)/u.test(text)) {
    problems.push("Pages workflow 不得使用特权 runner 或吞掉失败");
  }
  for (const match of text.matchAll(/^\s*-\s+(?:name:\s+[^\n]+\n\s+)?(?:id:\s+[^\n]+\n\s+)?uses:\s*([^\s#]+)/gmu)) {
    const revision = match[1].split("@")[1] || "";
    if (!/^[0-9a-f]{40}$/u.test(revision)) problems.push(`Pages Action 未固定完整 SHA：${match[1]}`);
  }
  const build = jobBlock(text, "build");
  const deploy = jobBlock(text, "deploy");
  if (!build || !deploy) problems.push("Pages workflow 必须分离 build 与 deploy job");
  if (!/^    permissions:\s*\n      contents:\s*read\s*$/mu.test(build)
    || /pages:\s*write|id-token:\s*write/u.test(build)) problems.push("build job 只能读取 contents");
  if (!/ref:\s*\$\{\{\s*github\.sha\s*\}\}/u.test(build) || !/persist-credentials:\s*false/u.test(build)) {
    problems.push("build job 必须精确检出合并 SHA 且不持久化凭证");
  }
  if (!/npm run ci:pages/u.test(build) || !/npm run build/u.test(build)
    || !/pages-release\.mjs write apps\/web\/dist --commit "\$GITHUB_SHA"/u.test(build)
    || !/pages-release\.mjs verify apps\/web\/dist --commit "\$GITHUB_SHA"/u.test(build)) {
    problems.push("build job 缺少安全自检、全量构建或发布清单对账");
  }
  if (!build.includes(`uses: ${PAGE_ACTIONS.upload}`) || !/path:\s*apps\/web\/dist/u.test(build)) {
    problems.push("Pages artifact 上传 Action、SHA 或路径非法");
  }
  if (!/^    needs:\s*build\s*$/mu.test(deploy)
    || !/if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u.test(deploy)) {
    problems.push("deploy job 必须严格依赖 main push 的 build");
  }
  if (!/^    permissions:\s*\n      pages:\s*write\s*\n      id-token:\s*write\s*$/mu.test(deploy)
    || !/^    environment:\s*\n      name:\s*github-pages\s*\n      url:\s*\$\{\{\s*steps\.deployment\.outputs\.page_url\s*\}\}\s*$/mu.test(deploy)) {
    problems.push("deploy job 缺少最小 Pages/OIDC 权限或受保护环境");
  }
  if (!deploy.includes(`uses: ${PAGE_ACTIONS.deploy}`)) problems.push("deploy-pages Action 或 SHA 非冻结值");
  const pagesWrites = [...text.matchAll(/pages:\s*write/gu)].length;
  const idWrites = [...text.matchAll(/id-token:\s*write/gu)].length;
  if (pagesWrites !== 1 || idWrites !== 1) problems.push("Pages 写权限只能出现于 deploy job 一次");
  const timeouts = [...text.matchAll(/timeout-minutes:\s*(\d+)/gu)].map((match) => Number(match[1]));
  if (timeouts.length !== 2 || timeouts.some((value) => value < 1 || value > 30)) problems.push("build/deploy 都必须设置不超过 30 分钟的超时");
  return problems;
}

export async function verifyPagesRepository(root) {
  const text = await readFile(path.join(root, ".github/workflows/pages.yml"), "utf8");
  return validatePagesWorkflow(text);
}

async function main() {
  const root = path.resolve(process.argv[2] || ".");
  const problems = await verifyPagesRepository(root);
  if (problems.length) throw new Error(problems.join("\n"));
  console.log("Pages 安全契约通过：仅 main push、构建/部署权限分离、合并 SHA 清单对账、受保护环境、Action 完整 SHA 固定");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
