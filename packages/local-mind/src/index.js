export { MindCapability } from "./capability.js";
export { gateIntentProposals, sanitizeObservation, validateIntentProposal } from "./contracts.js";
export { decideByRules } from "./rules.js";

export class LocalMindClient {
  constructor(worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module", name: "echo-town-local-mind" })) {
    this.worker = worker;
    this.sequence = 0;
    this.pending = new Map();
    this.progress = [];
    this.worker.onmessage = ({ data }) => {
      if (data.type === "progress") {
        this.progress.push(data.item);
        if (this.progress.length > 100) this.progress.shift();
        return;
      }
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.type === "error") pending.reject(Object.assign(new Error(data.error.message), { name: data.error.name }));
      else pending.resolve(data.result);
    };
    this.worker.onerror = (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  request(type, payload = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  decide(observation) { return this.request("decide", { observation }); }
  configureCpu() { return this.request("configure-cpu"); }
  status() { return this.request("status"); }
  gate(intents) { return this.request("gate", { intents }); }
  terminate() { this.worker.terminate(); }
}
