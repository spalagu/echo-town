const MODEL_ID = "onnx-community/SmolLM2-135M-Instruct-ONNX";
const MODEL_REVISION = "b8a5c0f183b78c55955a5364f610c36668b5e681";

let generatorPromise;

export async function loadCpuLanguageModel(progress) {
  if (!generatorPromise) {
    generatorPromise = import("@huggingface/transformers")
      .then(async ({ env, pipeline }) => {
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        env.backends.onnx.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);
        return pipeline("text-generation", MODEL_ID, {
          device: "wasm",
          dtype: "q4",
          revision: MODEL_REVISION,
          progress_callback: progress,
        });
      })
      .catch((error) => {
        generatorPromise = undefined;
        throw error;
      });
  }
  return generatorPromise;
}

export async function generateLanguageCandidate(observation, intent, progress) {
  const generator = await loadCpuLanguageModel(progress);
  const needs = observation.needs.map((need) => `${need.kind} ${need.level}`).join(", ") || "none";
  const prompt = `A town resident has these needs: ${needs}. They move (${intent.payload.dx}, ${intent.payload.dy}) for ${intent.reasonCode}. Write one short plain-English reason without JSON or Markdown. Reason:`;
  const result = await generator(prompt, {
    max_new_tokens: 24,
    do_sample: false,
    repetition_penalty: 1.15,
    return_full_text: false,
  });
  const text = String(result?.[0]?.generated_text ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 6 || !/[A-Za-z\u3400-\u9fff]/.test(text) || text.includes("```")) {
    throw new Error("CPU/Wasm 语言候选未通过质量 gate");
  }
  return text.slice(0, 160);
}

export const cpuLanguageModel = Object.freeze({ id: MODEL_ID, revision: MODEL_REVISION, device: "wasm", dtype: "q4" });
