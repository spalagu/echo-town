import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  projectLatentZoneForLocalMind,
  validateLatentZonePack,
} from "../src/index.js";

const pack = JSON.parse(await readFile(new URL("../../../world/latent-zones/unregistered-interval.json", import.meta.url), "utf8"));

test("潜层内容包提供两条多因素替代路径且 Local Mind 零阈值字段", () => {
  const value = validateLatentZonePack(pack);
  assert.equal(value.thresholdAlternatives.length, 2);
  const projection = projectLatentZoneForLocalMind(pack);
  const serialized = JSON.stringify(projection);
  assert.equal(pack.publicProjection.phenomena.some((item) => serialized.includes(item)), false);
  for (const hidden of ["zoneId", "thresholdAlternatives", "onSatisfied", "artifactStates", "worldPredicates", "socialPredicates", "actionSequence"]) {
    assert.equal(serialized.includes(hidden), false);
  }
});

test("显现后事件池引用闭合且继续提供可行动生活", () => {
  const value = validateLatentZonePack(pack);
  assert.ok(value.onSatisfied.eventPoolAdds.every((id) => value.eventPool.some((event) => event.id === id)));
  assert.ok(value.eventPool.every((event) => event.actionAffordances.length >= 2));
});

test("答案、钥匙、进度、单路径、重复路径和隐藏投影 mutation 全部判红", () => {
  for (const mutation of [
    (value) => { value.canonicalAnswer = "固定解法"; },
    (value) => { value.keyItem = "quiet-token"; },
    (value) => { value.progress = 50; },
    (value) => { value.publicProjection.phenomena[0] = "唯一解法是依次完成所有动作"; },
    (value) => { value.publicProjection.phenomena = ["唯一", "答案是先 compare_marks 再 wait_in_silence"]; },
    (value) => { value.publicProjection.phenomena[0] = "当 clouded-vial:mist-retained、weather:morning-fog、witnesses:two-present 后 compare_marks 和 wait_in_silence 时会显现。"; },
    (value) => { value.publicProjection.feedbackClasses = ["faint-missing-clouded-vial", "ambiguous", "resonant-mist-ledger"]; },
    (value) => { value.evidenceAffordances[0].publicFeedback = "还缺有雾的瓶子和两位见证者。"; },
    (value) => { value.publicProjection.phenomena[0] = "清晨雾起时，两位见证者带着留雾的瓶子，先比较记号再静默等待，区域便会显现。"; },
    (value) => { value.evidenceAffordances[0].publicFeedback = "瓶壁若没有残留薄雾，回声不会靠近。"; },
    (value) => { value.publicProjection.phenomena[0] = "区域显现后，镇民最终都会迁居钟楼，故事在此收束。"; },
    (value) => { value.publicProjection.phenomena[0] = "区域显现后，所有镇民进入终章并永久留在钟楼。"; },
    (value) => replaceAction(value, "compare_marks", "insert_key"),
    (value) => replaceAction(value, "compare_marks", "next_step"),
    (value) => replaceAction(value, "compare_marks", "finish_quest"),
    (value) => { value.thresholdAlternatives.splice(1); },
    (value) => {
      value.thresholdAlternatives[1] = { ...structuredClone(value.thresholdAlternatives[0]), id: "duplicate-path" };
    },
    (value) => {
      const first = structuredClone(value.thresholdAlternatives[0]);
      first.artifactStates.push("quiet-tuning-token:warm");
      value.thresholdAlternatives[0] = first;
      value.thresholdAlternatives[1] = {
        ...structuredClone(first),
        id: "reordered-duplicate",
        artifactStates: [...first.artifactStates].reverse(),
      };
    },
    (value) => { value.onSatisfied.eventPoolAdds = ["dangling-event"]; },
  ]) {
    const value = structuredClone(pack);
    mutation(value);
    assert.throws(() => validateLatentZonePack(value));
  }
});

function replaceAction(value, previous, next) {
  value.thresholdAlternatives[0].actionSequence = value.thresholdAlternatives[0].actionSequence
    .map((action) => action === previous ? next : action);
  value.evidenceAffordances.find((item) => item.factorValue === previous).factorValue = next;
  value.publicProjection.observableActions = value.publicProjection.observableActions
    .map((action) => action === previous ? next : action);
}
