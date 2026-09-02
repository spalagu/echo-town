import { NEED_NAMES, TRAIT_NAMES, validatePersonaProfile } from "./contracts.js";

const archetypes = [
  ["explorer", [94, 42, 58, 52, 38], ["冒险", "自由", "真相"], "亲眼看见未知之处", "一生困在熟悉的路上", "向往远方却珍惜熟人的牵挂", ["清晨绕远路", "收集陌生地名"], "短句，常用方向比喻", [12, 62], [55, 42, 30, 78, 48, 92], "curiosity", "先去看一眼"],
  ["guardian", [30, 94, 36, 64, 55], ["传统", "共同体", "关怀"], "让邻里在风雨里有依靠", "疏忽伤到信任自己的人", "守规矩却会替弱者破例", ["睡前检查门窗", "记下物资余量"], "稳重，先说风险", [-8, 35], [62, 70, 94, 35, 72, 28], "safety", "先把风险隔开"],
  ["connector", [62, 48, 96, 74, 44], ["共同体", "关怀", "自由"], "让彼此陌生的人愿意开口", "被所有圈子同时遗忘", "喜欢热闹却害怕真正袒露自己", ["午后去市场寒暄", "记住新邻居的称呼"], "热络，多用反问", [34, 78], [52, 92, 42, 60, 54, 66], "belonging", "先召集愿意帮忙的人"],
  ["caretaker", [52, 72, 46, 96, 67], ["关怀", "共同体", "公正"], "让受伤的人重新感到被接住", "善意反而剥夺他人的选择", "总想照料别人却不善求助", ["随身带创可贴", "晚饭前问候独居者"], "温和，避免命令句", [18, 40], [38, 86, 72, 44, 45, 40], "energy", "先照顾最疲惫的人"],
  ["sentinel", [68, 78, 34, 45, 95], ["真相", "公正", "共同体"], "在危险被忽视前留下证据", "自己的警觉变成伤人的猜疑", "不轻信传闻却总先想到最坏结果", ["记录异常声响", "反复核对出处"], "谨慎，区分事实和推测", [-24, 74], [44, 54, 88, 58, 64, 72], "safety", "先保存证据再示警"],
  ["maker", [86, 91, 40, 58, 32], ["创造", "成就", "共同体"], "做出能被镇民反复使用的东西", "作品华而不实", "追求完美却会偷偷留下小瑕疵", ["把废件分类", "画三版草图再动手"], "具体，爱用工艺术语", [22, 58], [66, 48, 50, 70, 90, 82], "achievement", "先做一个可逆原型"],
  ["independent", [58, 44, 28, 22, 46], ["自由", "真相", "创造"], "不欠任何人一个违心的答案", "在需要帮助时失去退路", "拒绝束缚却默默履行承诺", ["独自走河岸", "把建议写下隔夜再看"], "直接，少用敬语", [-4, 30], [48, 32, 46, 98, 55, 60], "autonomy", "先保留自己的退出路径"],
  ["achiever", [64, 96, 82, 42, 36], ["成就", "公正", "创造"], "完成一件人人以为做不到的事", "努力被当成炫耀", "渴望认可却拒绝邀功", ["给任务排优先级", "每日复盘一次"], "利落，先给结论", [26, 72], [70, 56, 58, 68, 98, 64], "achievement", "先拿下最难的环节"],
  ["mediator", [60, 70, 56, 92, 86], ["公正", "关怀", "共同体"], "让冲突双方仍能在明天见面", "妥协掩盖真正的不公", "讨厌争执却会为底线强硬", ["复述双方原话", "谈话后独处十分钟"], "耐心，常说‘我听见的是’", [-2, 46], [50, 88, 74, 54, 58, 48], "belonging", "先分别听完双方"],
  ["traditionalist", [18, 90, 44, 70, 50], ["传统", "共同体", "公正"], "把快消失的做法教给下一代", "传统被自己守成空壳", "尊重旧规矩却迷恋新工具", ["按旧历记天气", "每周擦拭祖传工具"], "慢而郑重，偶尔引用旧谚", [8, 32], [58, 76, 80, 40, 62, 30], "safety", "先查旧例和共同约定"],
  ["investigator", [98, 84, 20, 46, 72], ["真相", "创造", "自由"], "解释那些看似互不相关的痕迹", "漂亮的解释遮住反例", "追求证据却相信某些无法证明的直觉", ["给线索编号", "在结论旁写反例"], "精确，频繁标注置信度", [6, 68], [46, 34, 62, 76, 74, 100], "curiosity", "先构造能被推翻的假说"],
  ["spontaneous", [82, 18, 90, 60, 40], ["冒险", "关怀", "创造"], "让沉闷的一天突然值得记住", "冲动给别人留下残局", "讨厌计划却总能记住朋友的约定", ["临时改变回家路线", "用硬币决定小事"], "轻快，爱开无害玩笑", [48, 88], [38, 68, 34, 74, 50, 86], "energy", "先用小动作打破僵局"],
];

function numbers(names, values) {
  return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

export const PERSONA_FIXTURES = deepFreeze(archetypes.map((item) => validatePersonaProfile({
  schemaVersion: 1,
  id: item[0],
  traits: numbers(TRAIT_NAMES, item[1]),
  values: item[2],
  desire: item[3],
  fear: item[4],
  contradiction: item[5],
  habits: item[6],
  speechStyle: item[7],
  mood: { valence: item[8][0], arousal: item[8][1] },
  needs: numbers(NEED_NAMES, item[9]),
})));

const dilemmaThemes = [
  ["lost_parcel", "无人认领的包裹", [10, 10, 15, 5, 35, 0, -10, -15, 5, 10, 20, 0]],
  ["public_dispute", "市场上的公开争执", [-10, 5, 25, 15, 5, -5, -5, -10, 45, 10, 5, -20]],
  ["strange_sound", "钟楼深夜的异响", [10, 30, 0, 0, 35, 5, 10, -5, 0, 10, 25, -10]],
  ["scarce_food", "面包房原料短缺", [-10, 35, 25, 25, 5, 20, -5, 15, 15, 15, 0, -10]],
  ["broken_bridge", "河湾木桥损坏", [-10, 30, 10, 5, 5, 45, -15, 25, 10, 15, 5, -20]],
  ["new_neighbor", "沉默的新邻居", [5, 0, 40, 25, -10, 0, 5, -5, 20, 5, 10, 10]],
  ["risky_offer", "来历不明的合作", [-10, 25, 0, 0, 35, -5, 20, -25, 5, 10, 30, -15]],
  ["hidden_mark", "墙后反复出现的印记", [25, 5, 0, 0, 30, 10, 5, -10, 0, 10, 45, 5]],
  ["night_alarm", "没有火光的夜间警铃", [5, 40, 20, 10, 30, 0, -10, 15, 10, 10, 20, -20]],
  ["player_request", "守望者来信要求立即行动", [5, 5, 10, 5, 10, 5, 15, 40, 10, 0, 5, 5]],
];
const directions = [[1, 0], [0, -1], [1, -1], [-1, 0], [-1, -1], [0, 1], [-1, 1], [1, 1]];

// 这是独立于 PERSONA_FIXTURES 编写的通用应对策略库；困境选项不得从某个人格反向生成。
const strategyTemplates = [
  ["explore", "亲自探索尚未核实的方向", [90, 35, 65, 45, 40], ["冒险", "自由", "真相"], "curiosity", 1, ["未知", "远方", "线索", "亲眼"]],
  ["safeguard", "先隔离风险并保护现场", [25, 95, 35, 65, 65], ["传统", "共同体", "关怀"], "safety", -1, ["风险", "保护", "门窗", "物资"]],
  ["convene", "召集邻里交换各自所知", [60, 45, 95, 75, 45], ["共同体", "关怀", "自由"], "belonging", 1, ["邻居", "开口", "召集", "寒暄"]],
  ["care", "先照料最容易受影响的人", [50, 70, 45, 95, 65], ["关怀", "共同体", "公正"], "energy", 1, ["照料", "受伤", "帮助", "问候"]],
  ["observe", "记录异常并交叉核对出处", [70, 80, 30, 40, 95], ["真相", "公正", "共同体"], "safety", -1, ["证据", "异常", "核对", "出处"]],
  ["prototype", "制作一个可逆的小型试验", [90, 90, 40, 60, 30], ["创造", "成就", "共同体"], "achievement", 0, ["做出", "原型", "工具", "草图"]],
  ["withdraw", "保留退出路径并独自观察", [55, 40, 25, 20, 45], ["自由", "真相", "创造"], "autonomy", -1, ["退出", "独自", "违心", "退路"]],
  ["execute", "接受请求并立即完成关键一步", [65, 95, 85, 40, 35], ["成就", "公正", "创造"], "achievement", 1, ["完成", "任务", "优先级", "努力"]],
  ["mediate", "分别倾听后寻找可共存方案", [60, 70, 55, 95, 85], ["公正", "关怀", "共同体"], "belonging", 0, ["冲突", "双方", "复述", "底线"]],
  ["precedent", "查阅旧例和共同约定", [20, 90, 45, 70, 50], ["传统", "共同体", "公正"], "safety", -1, ["传统", "旧例", "约定", "教给"]],
  ["hypothesis", "提出能被反例推翻的假说", [98, 85, 20, 45, 70], ["真相", "创造", "自由"], "curiosity", 0, ["痕迹", "反例", "假说", "解释"]],
  ["improvise", "用低风险的临时行动打破僵局", [85, 20, 90, 60, 40], ["冒险", "关怀", "创造"], "energy", 1, ["临时", "小事", "打破", "冲动"]],
];

export const DILEMMA_FIXTURES = deepFreeze(dilemmaThemes.map(([id, title, contextWeights], dilemmaIndex) => {
  const options = strategyTemplates.map((strategy, strategyIndex) => {
    const [strategyId, label, traitValues, values, need, moodAxis, motifs] = strategy;
    const [dx, dy] = directions[(strategyIndex + dilemmaIndex) % directions.length];
    return {
      id: `${id}_${strategyId}`,
      label: `${title}：${label}`,
      intent: {
        schemaVersion: 1,
        intentType: "move",
        payload: { dx, dy },
        budget: 2 + ((strategyIndex + dilemmaIndex) % 4),
        reasonCode: `dilemma_${dilemmaIndex}_${strategyIndex}`,
      },
      traitVector: numbers(TRAIT_NAMES, traitValues),
      values,
      need,
      moodAxis,
      motifs,
      contextWeight: contextWeights[strategyIndex],
    };
  });
  return {
    schemaVersion: 1,
    id,
    title,
    playerSuggestionId: options[7].id,
    options,
  };
}));
