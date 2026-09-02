import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "README.md",
  "LICENSE",
  "LICENSE-CONTENT.md",
  "ATTRIBUTIONS.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  ".github/CODEOWNERS",
];

const failures = [];

for (const file of requiredFiles) {
  try {
    await access(file);
  } catch {
    failures.push(`缺少文件：${file}`);
  }
}

const forbiddenWorkflowPaths = [
  ".github/workflows/pr.yml",
  ".github/workflows/pages.yml",
];

for (const file of forbiddenWorkflowPaths) {
  try {
    await access(file);
    failures.push(`当前授权边界内不应存在：${file}`);
  } catch {
    // 文件不存在符合当前授权边界。
  }
}

if (!failures.length) {
  const readme = await readFile("README.md", "utf8");
  const contributing = await readFile("CONTRIBUTING.md", "utf8");
  const contentLicense = await readFile("LICENSE-CONTENT.md", "utf8");

  if (!readme.includes("只给开端，永不写剧本")) {
    failures.push("README.md 缺少非剧本化原则");
  }
  if (!contributing.includes("预定结局")) {
    failures.push("CONTRIBUTING.md 缺少剧情控制禁令");
  }
  if (!contentLicense.includes("CC BY 4.0")) {
    failures.push("LICENSE-CONTENT.md 缺少 CC BY 4.0 声明");
  }
}

if (failures.length) {
  console.error(`治理骨架检查失败，共 ${failures.length} 项：`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`治理骨架检查通过：${requiredFiles.length}/${requiredFiles.length} 个必需文件存在；未配置 GitHub Actions 或 Pages。`);
