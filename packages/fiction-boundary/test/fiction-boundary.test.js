import assert from "node:assert/strict";
import test from "node:test";
import {
  assessFictionalContent,
  assertFictionalContent,
  fictionBoundaryDeclaration,
  FICTION_NOTICE,
  validateFictionBoundary,
} from "../src/index.js";

const EXPECTED_NOTICE = "回声镇、其中的角色与事件均为虚构 AI 世界，不对应、仿冒或预测任何真实个人；如有相似，纯属巧合。";

test("冻结的虚构边界声明可被严格验证", () => {
  const declaration = fictionBoundaryDeclaration();
  assert.equal(FICTION_NOTICE, EXPECTED_NOTICE);
  assert.equal(declaration.notice, EXPECTED_NOTICE);
  assert.deepEqual(validateFictionBoundary(declaration), declaration);
  assert.throws(() => validateFictionBoundary({ ...declaration, predictsRealPerson: true }), /不符合/u);
  assert.throws(() => validateFictionBoundary({ ...declaration, notice: "这是一段故事。" }), /不符合/u);
});

test("普通虚构设定、传说与开放悬疑保持可贡献", () => {
  assert.doesNotThrow(() => assertFictionalContent({
    title: "旧钟楼的第十三声",
    summary: "有人声称雨夜会多听见一次钟声，但没有人知道原因，也没有标准答案。",
  }));
});

test("真实个人映射字段无论拼写分隔和真假值都判红", () => {
  for (const field of ["realPersonId", "real_person_name", "real-person-profile", "digitalTwinOf", "mapsRealPerson", "predicts-real-person"]) {
    assert.throws(() => assertFictionalContent({ [field]: false }), /禁止的真实个人/u, field);
  }
});

test("明确的真实个人仿冒与预测文案判红", () => {
  for (const text of [
    "这个角色就是现实中的个人",
    "该角色映射真实世界中的居民",
    "系统将预测现实中的个人下一步会去哪里",
    "该角色取材于现\u200b实中的个人",
    "系统将推演真实居民明天的行为",
    "这个角色以现实演员埃隆·马斯克为原型，并复现其公开生活。",
    "系统会推测王小明明天会去哪里；王小明是本市可识别的真实居民。",
    "This character is a digital twin of an identifiable person",
    "This character is based on a real person",
  ]) assert.throws(() => assertFictionalContent({ summary: text }), /仿冒、映射或预测/u, text);
});

test("仅有姓名线索的映射进入人工复核，不由机器猜测真人身份", () => {
  for (const text of [
    "镇长就是埃隆·马斯克本人。",
    "This character is Elon Musk's digital twin.",
    "This character impersonates Elon Musk.",
    "The agent predicts Taylor Swift’s next location.",
    "这是埃隆·马斯克在回声镇的化身。",
    "系统复刻了埃隆·马斯克的公开人格。",
    "医生按埃隆·马斯克的生平塑造。",
    "This character copies Elon Musk.",
    "镇长阿岚·回声是旧钟楼记忆的化身；阿岚·回声是本项目原创虚构角色。",
    "医生复刻了阿岚·回声的虚构舞台人格，作为节庆演出。",
    "This fictional character is based on Mira Vale, another original fictional character in Echo Town.",
    "This character copies Mira Vale in a fictional festival play; both are invented characters.",
  ]) {
    assert.doesNotThrow(() => assertFictionalContent({ summary: text }), text);
    const assessment = assessFictionalContent({ summary: text });
    assert.equal(assessment.automatedDecision, "accept", text);
    assert.equal(assessment.humanReviewRequired, true, text);
    assert.ok(assessment.reviewSignals.length > 0, text);
  }
});

test("命名声明同时含明确真实个人证据时仍由机器判红", () => {
  assert.throws(() => assertFictionalContent({
    summary: "系统将估计王小明明日的行踪；王小明是真实居民。",
  }), /仿冒、映射或预测/u);
});

test("扮演现实职业或个人困境但明确保持虚构不会误伤", () => {
  for (const text of [
    "这个角色扮演现实中的居民职业，例如木匠；角色和事件均为虚构。",
    "该角色扮演现实中的个人困境，但人物与事件均为虚构。",
    "守望者预测明天会下雨。",
    "角色推测下一步应该调查钟楼。",
    "有人说镜中镇是回声镇的数字孪生，但线索矛盾且没有标准答案。",
    "The actor impersonates a ghost in the festival play.",
    "The agent predicts where the bell sound comes from.",
  ]) assert.doesNotThrow(() => assertFictionalContent({ summary: text }), text);
});

test("冻结免责声明和明确否定语境不会被内容 gate 误伤", () => {
  for (const text of [
    EXPECTED_NOTICE,
    "系统不会预测现实中的个人。",
    "角色不得映射真实居民，也不能仿冒真实人物。",
    "该角色不得冒充现实中的可识别个人。",
    "该角色不冒充可识别个人。",
    "该角色不得假扮可识别人物。",
    "该角色不会预测可识别个人的下一步。",
    "该角色禁止预测现实中的可识别个人。",
    "该人物并非真实人物，所有经历都是虚构的。",
    "This character does not impersonate a real person.",
  ]) assert.doesNotThrow(() => assertFictionalContent({ summary: text }), text);
});

test("双重否定和固定反转表达不能伪装成安全声明", () => {
  for (const text of [
    "系统不得不预测真实居民的下一步行动。",
    "系统不能不复刻真实人物的行为。",
    "This character does not avoid impersonating a real person.",
    "It is not prohibited to predict a real resident’s next action.",
  ]) assert.throws(() => assertFictionalContent({ summary: text }), /仿冒、映射或预测/u, text);
});

test("显式真人仿冒与预测的中英文同义动作判红", () => {
  for (const text of [
    "该角色将冒充现实中的可识别个人。",
    "该角色假扮真实人物。",
    "This character masquerades as an identifiable person.",
    "This agent forecasts a real person's next location.",
    "该角色冒充现实中的可识别个人张伟。",
  ]) assert.throws(() => assertFictionalContent({ summary: text }), /仿冒、映射或预测/u, text);
  assert.throws(() => assertFictionalContent({
    summary: "该角色将冒",
    observableFacts: ["充现实中的可识别个人。"],
  }), /聚合文本.*仿冒、映射或预测/u);
});

test("跨字段和数组拆分的真实个人声明仍会被聚合 gate 判红", () => {
  for (const value of [
    { summary: "这个角色就是现实中的", observableFacts: ["个人，并会复刻其生活。"] },
    { summary: "This character is based on", observableFacts: ["a real person."] },
    { summary: "系统将预测现实中的", observableFacts: ["个人下一步会去哪里。"] },
  ]) assert.throws(() => assertFictionalContent(value), /聚合文本.*仿冒、映射或预测/u);
});
