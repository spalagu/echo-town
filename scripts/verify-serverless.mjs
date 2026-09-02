import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePublicNodeRegistry } from "../packages/world-sync/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set([".git", "node_modules", "dist", "target", "pkg"]);
const forbiddenNames = new Set(["Dockerfile", "docker-compose.yml", "docker-compose.yaml", "serverless.yml", "serverless.yaml"]);
const forbiddenDirectories = new Set(["k8s", "kubernetes", "terraform", "helm", "backend", "server"]);

async function walk(directory, relative = "") {
  const hits = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const childRelative = path.join(relative, entry.name);
    if (forbiddenNames.has(entry.name) || (entry.isDirectory() && forbiddenDirectories.has(entry.name))) hits.push(childRelative);
    if (entry.isDirectory()) hits.push(...await walk(path.join(directory, entry.name), childRelative));
  }
  return hits;
}

export async function verifyServerlessBoundary(repository = root) {
  const [sourceText, publishedText, pagesWorkflow, prWorkflow] = await Promise.all([
    readFile(path.join(repository, "config/public-nodes.json"), "utf8"),
    readFile(path.join(repository, "apps/web/public/public-nodes.json"), "utf8"),
    readFile(path.join(repository, ".github/workflows/pages.yml"), "utf8"),
    readFile(path.join(repository, ".github/workflows/pr.yml"), "utf8"),
  ]);
  if (sourceText !== publishedText) throw new Error("公共节点 registry 与 Pages 静态副本不一致");
  const registry = validatePublicNodeRegistry(JSON.parse(sourceText));
  const forbidden = await walk(repository);
  if (forbidden.length > 0) throw new Error(`仓库出现项目服务端部署对象：${forbidden.join(", ")}`);
  if (!/actions\/upload-pages-artifact/u.test(pagesWorkflow) || !/actions\/deploy-pages/u.test(pagesWorkflow)
    || /deploy-pages/u.test(prWorkflow) || /pull_request_target|workflow_run|secrets\./u.test(`${pagesWorkflow}\n${prWorkflow}`)) {
    throw new Error("GitHub Pages 唯一部署面或权限边界非法");
  }
  return {
    schemaVersion: 1,
    deploymentObjects: ["GitHub Pages 静态 artifact"],
    projectOperatedServices: 0,
    serverAiEndpoints: 0,
    serverTickEndpoints: 0,
    privatePersistenceEndpoints: 0,
    publicStrategies: registry.strategies.map((strategy) => ({
      protocol: strategy.protocol,
      operators: strategy.endpoints.length,
      projectOperated: false,
    })),
    directFailure: registry.policy.directFailure,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyServerlessBoundary(), null, 2));
}
