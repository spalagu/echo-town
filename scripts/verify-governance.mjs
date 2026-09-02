import { access, readFile } from "node:fs/promises";
import { verifyPagesRepository } from "./verify-pages-security.mjs";
import { verifyRepository } from "./verify-pr-security.mjs";

const requiredFiles = [
  "README.md",
  "LICENSE",
  "LICENSE-CONTENT.md",
  "ATTRIBUTIONS.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  ".github/CODEOWNERS",
  ".github/workflows/pages.yml",
  "config/public-nodes.json",
];

const failures = [];

for (const file of requiredFiles) {
  try {
    await access(file);
  } catch {
    failures.push(`缺少文件：${file}`);
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

  try {
    failures.push(...await verifyRepository("."));
    failures.push(...await verifyPagesRepository("."));
  } catch (error) {
    failures.push(`治理安全候选缺失或无法读取：${error.message}`);
  }
}

if (failures.length) {
  console.error(`治理骨架检查失败，共 ${failures.length} 项：`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`治理骨架检查通过：${requiredFiles.length}/${requiredFiles.length} 个必需文件存在；PR 与 Pages 安全候选均通过；未执行外部部署。`);
