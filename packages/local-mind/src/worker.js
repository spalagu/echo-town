import { MindCapability } from "./capability.js";
import { gateIntentProposals, sanitizeObservation } from "./contracts.js";
import { decideByRules } from "./rules.js";
import { rankIntentCandidates } from "@echo-town/persona-core";

const capability = new MindCapability();
let languageModule;
let forcedRules = false;

function post(id, type, payload) {
  self.postMessage({ id, type, ...payload });
}

async function useCpuLanguage(observation, intent, id) {
  languageModule ??= await import("./cpu-language.js");
  return languageModule.generateLanguageCandidate(observation, intent, (item) => {
    post(id, "progress", { item: { status: item.status, file: item.file, loaded: item.loaded, total: item.total } });
  });
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === "status") {
      post(id, "result", { result: { ...capability.snapshot(), ...(forcedRules ? { mode: "rules" } : {}), execution: "dedicated-worker" } });
      return;
    }
    if (type === "configure-cpu") {
      forcedRules = false;
      capability.requestCpu();
      post(id, "result", { result: { ...capability.snapshot(), execution: "dedicated-worker" } });
      return;
    }
    if (type === "force-rules") {
      forcedRules = true;
      post(id, "result", { result: { ...capability.snapshot(), mode: "rules", execution: "dedicated-worker" } });
      return;
    }
    if (type === "gate") {
      post(id, "result", { result: gateIntentProposals(data.intents) });
      return;
    }
    if (type !== "decide") throw new Error("未知 Local Mind 请求");

    const observation = sanitizeObservation(data.observation);
    const personaDecision = data.personaProfile && data.dilemma
      ? rankIntentCandidates(data.personaProfile, data.dilemma)
      : null;
    const intents = personaDecision
      ? personaDecision.candidates.map((candidate) => candidate.intent)
      : decideByRules(observation);
    let languageCandidate = null;
    let model = "rules";
    const shouldTryCpu = !forcedRules && (capability.mode === "cpu-wasm" || capability.canProbe());
    if (shouldTryCpu) {
      try {
        languageCandidate = await useCpuLanguage(observation, intents[0], id);
        capability.recordSuccess();
        model = "cpu-wasm";
      } catch (error) {
        capability.recordFailure(error.message);
      }
    }
    const gated = gateIntentProposals(intents);
    if (!gated.ok) throw new Error(`Intent gate 拒绝规则输出：${gated.reason}`);
    post(id, "result", {
      result: {
        intents: gated.intents,
        personaDecision,
        languageCandidate,
        model,
        capability: capability.snapshot(),
        execution: "dedicated-worker",
      },
    });
  } catch (error) {
    post(id, "error", { error: { name: error.name, message: error.message } });
  }
};
