import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectWorld } from "../../scripts/compile-world.mjs";
import {
  assessFictionalContent,
  fictionBoundaryDeclaration,
  FICTION_NOTICE,
  validateFictionBoundary,
} from "../../packages/fiction-boundary/src/index.js";
import { verifyFictionUi } from "../../scripts/verify-fiction-ui.mjs";

const EXPECTED_NOTICE = "回声镇、其中的角色与事件均为虚构 AI 世界，不对应、仿冒或预测任何真实个人；如有相似，纯属巧合。";
const EXPECTED_POLICY_ID = "echo-town-fiction-boundary-v1";

const root = path.resolve(".");
const basePack = JSON.parse(await readFile(path.join(root, "world/packs/echo-town-core.json"), "utf8"));
const fixtures = JSON.parse(await readFile(new URL("./ap12-fixtures.json", import.meta.url), "utf8"));
const codeowners = await readFile(path.join(root, ".github/CODEOWNERS"), "utf8");
assert.match(codeowners, /^\/world\/\s+@spalagu\s*$/mu, "命名实体人工复核缺少 /world/ CODEOWNER");

function setPath(target, segments, value) {
  let cursor = target;
  for (const segment of segments.slice(0, -1)) cursor = cursor[segment];
  cursor[segments.at(-1)] = value;
}

const outcomes = [];
for (const fixture of fixtures) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "echo-town-ap12-"));
  try {
    await mkdir(path.join(temporary, "packs"), { recursive: true });
    const pack = structuredClone(basePack);
    for (const mutation of fixture.mutations ?? [fixture.mutation]) setPath(pack, mutation.path, mutation.value);
    await writeFile(path.join(temporary, "packs/fixture.json"), `${JSON.stringify(pack, null, 2)}\n`, "utf8");
    let result = "green";
    let reason = null;
    try {
      const assessment = assessFictionalContent(pack, fixture.id);
      await inspectWorld(temporary);
      if (assessment.humanReviewRequired) result = "review";
    } catch (error) {
      result = "red";
      reason = error.message;
    }
    const expected = fixture.expected === "accept" ? "green" : fixture.expected === "reject" ? "red" : "review";
    assert.equal(result, expected, `${fixture.id}: ${reason ?? `意外得到 ${result}`}`);
    if (result === "red") assert.match(reason, /真实个人/u, fixture.id);
    if (result === "review") assert.match(fixture.humanDecision ?? "", /^(?:accept|reject)$/u, `${fixture.id} 缺少人工决定`);
    outcomes.push({ id: fixture.id, result, humanDecision: fixture.humanDecision ?? null });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const declaration = fictionBoundaryDeclaration();
assert.equal(FICTION_NOTICE, EXPECTED_NOTICE);
assert.equal(declaration.policyId, EXPECTED_POLICY_ID);
assert.equal(validateFictionBoundary(declaration).notice, EXPECTED_NOTICE);
for (const mutation of [
  { ...declaration, fictional: false },
  { ...declaration, mapsRealPerson: true },
  { ...declaration, predictsRealPerson: true },
  { ...declaration, notice: "仅供娱乐。" },
]) assert.throws(() => validateFictionBoundary(mutation), /不符合/u);

const uiResult = await verifyFictionUi(path.join(root, "apps/web"));
const uiTemporary = await mkdtemp(path.join(os.tmpdir(), "echo-town-ap12-ui-"));
try {
  await writeFile(path.join(uiTemporary, "index.html"), `<p>${EXPECTED_NOTICE}</p><aside>这个角色就是现实中的个人。</aside>`, "utf8");
  await assert.rejects(() => verifyFictionUi(uiTemporary), /仿冒、映射或预测/u);
} finally {
  await rm(uiTemporary, { recursive: true, force: true });
}

console.log(JSON.stringify({
  policyId: declaration.policyId,
  normalFiction: outcomes.filter((item) => item.result === "green").length,
  rejectedAttacks: outcomes.filter((item) => item.result === "red").length,
  humanReviews: outcomes.filter((item) => item.result === "review").length,
  humanRejects: outcomes.filter((item) => item.humanDecision === "reject").length,
  humanAccepts: outcomes.filter((item) => item.humanDecision === "accept").length,
  worldCodeowner: "@spalagu",
  frozenBoundaryMutationsRejected: 4,
  uiFilesScanned: uiResult.files,
  uiAttackRejected: true,
  outcomes,
}, null, 2));
