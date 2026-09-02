import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_CHECKS = Object.freeze([
  "quality", "world-schema", "deterministic-replay", "asset-budget", "license-policy", "content-safety", "build",
]);

export function validateWorkflow(text) {
  const problems = [];
  if (!/^on:\s*\n\s{2}pull_request:\s*$/mu.test(text)) problems.push("workflow 必须只以 pull_request 为入口");
  if (/\bpull_request_target\b|\bworkflow_run\b|^\s{2}(?:push|workflow_dispatch|schedule):/mu.test(text)) problems.push("workflow 含特权或非 PR 触发器");
  if (!/^permissions:\s*\n\s{2}contents:\s*read\s*$/mu.test(text) || /\bwrite-all\b|\bread-all\b|^\s{2}(?:pages|id-token|contents|actions|checks|pull-requests):\s*write\s*$/mu.test(text)) problems.push("GITHUB_TOKEN 权限不是唯一 contents: read");
  if (/\$\{\{\s*secrets\.|\$\{\{\s*github\.token|\bGITHUB_TOKEN\b/u.test(text)) problems.push("workflow 不得读取 secret 或 token");
  if (/self-hosted|continue-on-error:\s*true|\|\|\s*true|if:\s*always\(\)/u.test(text)) problems.push("workflow 不得使用特权 runner 或吞掉失败");
  if (/upload-pages-artifact|deploy-pages|pages:\s*write|id-token:\s*write|\benvironment:\s*github-pages/u.test(text)) problems.push("PR workflow 不得发布 Pages");
  for (const match of text.matchAll(/^\s*-\s+uses:\s*([^\s#]+).*$/gmu)) {
    const revision = match[1].split("@")[1] || "";
    if (!/^[0-9a-f]{40}$/.test(revision)) problems.push(`Action 未固定完整 SHA：${match[1]}`);
  }
  const checkoutCount = [...text.matchAll(/uses:\s*actions\/checkout@/gu)].length;
  const noCredentialCount = [...text.matchAll(/persist-credentials:\s*false/gu)].length;
  if (checkoutCount === 0 || checkoutCount !== noCredentialCount) problems.push("每次 checkout 都必须关闭凭证持久化");
  const headCheckoutCount = [...text.matchAll(/ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/gu)].length;
  if (headCheckoutCount !== checkoutCount) problems.push("每次 checkout 都必须固定到贡献者 Pull Request head SHA");
  if (!/^\s{2}SOURCE_COMMIT:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}\s*$/mu.test(text)
    || !/pages-release\.mjs write apps\/web\/dist --commit "\$SOURCE_COMMIT"/u.test(text)
    || !/pages-release\.mjs verify apps\/web\/dist --commit "\$SOURCE_COMMIT"/u.test(text)
    || /pages-release\.mjs (?:write|verify) apps\/web\/dist --commit "\$GITHUB_SHA"/u.test(text)) {
    problems.push("PR artifact 必须绑定贡献者 head SHA，不能绑定 GitHub 合成 merge SHA");
  }
  for (const job of REQUIRED_CHECKS) if (!new RegExp(`^  ${job}:\\s*$`, "mu").test(text)) problems.push(`缺少必需检查 job：${job}`);
  const timeouts = [...text.matchAll(/timeout-minutes:\s*(\d+)/gu)].map((match) => Number(match[1]));
  if (timeouts.length < REQUIRED_CHECKS.length || timeouts.some((value) => value < 1 || value > 30)) problems.push("每个 job 必须设置不超过 30 分钟的超时");
  return problems;
}

export function validateCodeowners(text) {
  const problems = [];
  for (const rule of ["/.github/ @spalagu", "/schemas/ @spalagu", "/world/ @spalagu", "/crates/world-core/ @spalagu"]) {
    if (!text.split("\n").some((line) => line.trim() === rule)) problems.push(`CODEOWNERS 缺少：${rule}`);
  }
  return problems;
}

export function validateRuleset(value) {
  const problems = [];
  if (value?.target !== "branch" || value?.enforcement !== "active" || value?.bypass_actors?.length !== 0) problems.push("Ruleset 必须 active 且无 bypass actor");
  if (!value?.conditions?.ref_name?.include?.includes("~DEFAULT_BRANCH")) problems.push("Ruleset 未覆盖默认分支");
  const byType = new Map((value?.rules || []).map((rule) => [rule.type, rule]));
  for (const type of ["deletion", "non_fast_forward", "pull_request", "required_status_checks"]) if (!byType.has(type)) problems.push(`Ruleset 缺少 ${type}`);
  const review = byType.get("pull_request")?.parameters;
  if (!review || review.required_approving_review_count < 1 || !review.dismiss_stale_reviews_on_push
    || !review.require_code_owner_review || !review.require_last_push_approval || !review.required_review_thread_resolution) {
    problems.push("Ruleset 评审参数未闭合");
  }
  const checks = byType.get("required_status_checks")?.parameters;
  const contexts = new Set((checks?.required_status_checks || []).map((item) => item.context));
  if (!checks?.strict_required_status_checks_policy || REQUIRED_CHECKS.some((check) => !contexts.has(check))) problems.push("Ruleset 必需检查不完整或不严格");
  return problems;
}

export async function verifyRepository(root) {
  const [workflow, codeowners, rulesetText] = await Promise.all([
    readFile(path.join(root, ".github/workflows/pr.yml"), "utf8"),
    readFile(path.join(root, ".github/CODEOWNERS"), "utf8"),
    readFile(path.join(root, ".github/rulesets/main.json"), "utf8"),
  ]);
  return [
    ...validateWorkflow(workflow),
    ...validateCodeowners(codeowners),
    ...validateRuleset(JSON.parse(rulesetText)),
  ];
}

async function main() {
  const root = path.resolve(process.argv[2] || ".");
  const problems = await verifyRepository(root);
  if (problems.length) throw new Error(problems.join("\n"));
  console.log(`PR 安全契约通过：${REQUIRED_CHECKS.length} 个必需检查，token 只读，零 secret，零部署，Ruleset 无 bypass`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
