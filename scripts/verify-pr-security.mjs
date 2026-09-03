import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_CHECKS = Object.freeze([
  "quality", "world-schema", "deterministic-replay", "asset-budget", "license-policy", "content-safety", "build",
]);
export const SPALAGU_ACTOR_ID = 67864814;

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

export function validateVersionManifestWriter(text) {
  return /sourceCommit:\s*process\.env\.SOURCE_COMMIT\s*\|\|\s*process\.env\.GITHUB_SHA\s*\|\|\s*"local-uncommitted"/u.test(text)
    ? []
    : ["version-manifest 必须优先绑定显式 SOURCE_COMMIT，不能优先采用 GitHub 合成 merge SHA"];
}

export function validatePagesBrowserCommit(text) {
  return /expectedCommit\s*=\s*process\.env\.SOURCE_COMMIT\s*\|\|\s*process\.env\.GITHUB_SHA/u.test(text)
    ? []
    : ["Pages 浏览器验收必须优先核对显式 SOURCE_COMMIT，不能优先采用 GitHub 合成 merge SHA"];
}

export function validateRulesets(core, reviewRuleset) {
  const problems = [];
  if (core?.name !== "Echo Town core protection" || core?.target !== "branch" || core?.enforcement !== "active" || core?.bypass_actors?.length !== 0) {
    problems.push("核心 Ruleset 必须 active 且无 bypass actor");
  }
  if (!core?.conditions?.ref_name?.include?.includes("~DEFAULT_BRANCH")) problems.push("核心 Ruleset 未覆盖默认分支");
  const coreByType = new Map((core?.rules || []).map((rule) => [rule.type, rule]));
  for (const type of ["deletion", "non_fast_forward", "pull_request", "required_status_checks"]) {
    if (!coreByType.has(type)) problems.push(`核心 Ruleset 缺少 ${type}`);
  }
  const corePullRequest = coreByType.get("pull_request")?.parameters;
  if (!corePullRequest || corePullRequest.required_approving_review_count !== 0
    || corePullRequest.dismiss_stale_reviews_on_push || corePullRequest.require_code_owner_review
    || corePullRequest.require_last_push_approval || !corePullRequest.required_review_thread_resolution) {
    problems.push("核心 Ruleset 必须只保留 PR 与讨论解决门，不得携带人工评审门");
  }
  const checks = coreByType.get("required_status_checks")?.parameters;
  const contexts = new Set((checks?.required_status_checks || []).map((item) => item.context));
  if (!checks?.strict_required_status_checks_policy || REQUIRED_CHECKS.some((check) => !contexts.has(check))) {
    problems.push("核心 Ruleset 必需检查不完整或不严格");
  }

  const bypass = reviewRuleset?.bypass_actors || [];
  if (reviewRuleset?.name !== "Echo Town human review" || reviewRuleset?.target !== "branch" || reviewRuleset?.enforcement !== "active"
    || bypass.length !== 1 || bypass[0]?.actor_id !== SPALAGU_ACTOR_ID || bypass[0]?.actor_type !== "User" || bypass[0]?.bypass_mode !== "pull_request") {
    problems.push("人工评审 Ruleset 必须仅允许 spalagu 在 Pull Request 内 bypass");
  }
  if (!reviewRuleset?.conditions?.ref_name?.include?.includes("~DEFAULT_BRANCH")) problems.push("人工评审 Ruleset 未覆盖默认分支");
  const reviewByType = new Map((reviewRuleset?.rules || []).map((rule) => [rule.type, rule]));
  if (reviewByType.size !== 1 || !reviewByType.has("pull_request")) problems.push("人工评审 Ruleset 只能包含 pull_request 规则");
  const review = reviewByType.get("pull_request")?.parameters;
  if (!review || review.required_approving_review_count < 1 || !review.dismiss_stale_reviews_on_push
    || !review.require_code_owner_review || !review.require_last_push_approval || review.required_review_thread_resolution) {
    problems.push("人工评审 Ruleset 的批准、CODEOWNER 与最后推送门未闭合");
  }
  return problems;
}

export async function verifyRepository(root) {
  const [workflow, codeowners, coreRulesetText, reviewRulesetText, versionManifestWriter, pagesBrowserTest] = await Promise.all([
    readFile(path.join(root, ".github/workflows/pr.yml"), "utf8"),
    readFile(path.join(root, ".github/CODEOWNERS"), "utf8"),
    readFile(path.join(root, ".github/rulesets/main.json"), "utf8"),
    readFile(path.join(root, ".github/rulesets/review.json"), "utf8"),
    readFile(path.join(root, "apps/web/scripts/write-manifest.mjs"), "utf8"),
    readFile(path.join(root, "tests/browser/ap15-local.mjs"), "utf8"),
  ]);
  return [
    ...validateWorkflow(workflow),
    ...validateCodeowners(codeowners),
    ...validateRulesets(JSON.parse(coreRulesetText), JSON.parse(reviewRulesetText)),
    ...validateVersionManifestWriter(versionManifestWriter),
    ...validatePagesBrowserCommit(pagesBrowserTest),
  ];
}

async function main() {
  const root = path.resolve(process.argv[2] || ".");
  const problems = await verifyRepository(root);
  if (problems.length) throw new Error(problems.join("\n"));
  console.log(`PR 安全契约通过：${REQUIRED_CHECKS.length} 个必需检查，token 只读，零 secret，零部署；核心 Ruleset 零 bypass，人工评审 Ruleset 仅允许 spalagu 在 PR 内 bypass`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
