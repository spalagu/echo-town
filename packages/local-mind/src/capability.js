export class MindCapability {
  constructor({ now = () => Date.now(), cooldownMs = 60_000 } = {}) {
    this.now = now;
    this.cooldownMs = cooldownMs;
    this.requestedMode = "rules";
    this.mode = "rules";
    this.consecutiveFailures = 0;
    this.cooldownUntil = 0;
    this.probeUsed = false;
    this.lastFailure = null;
  }

  requestCpu() {
    this.requestedMode = "cpu-wasm";
    if (this.now() >= this.cooldownUntil) this.mode = "cpu-wasm";
    return this.snapshot();
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.cooldownUntil = 0;
    this.probeUsed = false;
    this.lastFailure = null;
    this.mode = this.requestedMode;
    return this.snapshot();
  }

  recordFailure(reason) {
    this.consecutiveFailures += 1;
    this.lastFailure = String(reason || "unknown");
    if (this.consecutiveFailures >= 3) {
      this.mode = "rules";
      this.cooldownUntil = this.now() + this.cooldownMs;
      this.probeUsed = false;
    }
    return this.snapshot();
  }

  canProbe() {
    if (this.requestedMode !== "cpu-wasm" || this.mode !== "rules" || this.probeUsed || this.now() < this.cooldownUntil) return false;
    this.probeUsed = true;
    return true;
  }

  snapshot() {
    return {
      requestedMode: this.requestedMode,
      mode: this.mode,
      consecutiveFailures: this.consecutiveFailures,
      cooldownUntil: this.cooldownUntil,
      probeUsed: this.probeUsed,
      lastFailure: this.lastFailure,
    };
  }
}
