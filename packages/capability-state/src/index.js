const CAPABILITIES = Object.freeze(["render", "localMind", "network", "persistence"]);
const STATUSES = new Set(["ready", "degraded", "unavailable"]);
const STATE_KEYS = new Set(["schemaVersion", ...CAPABILITIES]);

export const FAULT_FIXTURES = Object.freeze([
  Object.freeze({ code: "webgpu_missing", capability: "localMind", status: "degraded", fallback: "规则 AI", message: "WebGPU 不可用，角色改用规则 AI。" }),
  Object.freeze({ code: "model_corrupt", capability: "localMind", status: "degraded", fallback: "规则 AI", message: "本地模型损坏，角色改用规则 AI。" }),
  Object.freeze({ code: "wasm_load_failure", capability: "localMind", status: "unavailable", fallback: "世界暂停", message: "世界核心未能加载，角色行动已暂停。" }),
  Object.freeze({ code: "storage_denied", capability: "persistence", status: "unavailable", fallback: "仅当前会话", message: "浏览器拒绝本地存储，本次进度仅保留在当前页面。" }),
  Object.freeze({ code: "storage_quota", capability: "persistence", status: "degraded", fallback: "减少缓存", message: "本地空间不足，系统已减少非关键缓存。" }),
  Object.freeze({ code: "browser_offline", capability: "network", status: "unavailable", fallback: "离线单人", message: "浏览器已离线，回声镇进入离线单人模式。" }),
  Object.freeze({ code: "network_partition", capability: "network", status: "degraded", fallback: "仅本地可合并活动", message: "世界连接发生分区，排他活动已暂停确认。" }),
  Object.freeze({ code: "public_node_failed", capability: "network", status: "degraded", fallback: "切换公共节点", message: "一个公共节点不可用，正在尝试其他运营者。" }),
  Object.freeze({ code: "all_public_nodes_failed", capability: "network", status: "unavailable", fallback: "离线单人", message: "公共连接全部不可用，回声镇进入离线单人模式。" }),
  Object.freeze({ code: "webrtc_direct_failed", capability: "network", status: "unavailable", fallback: "离线单人", message: "浏览器直连失败，回声镇保持离线单人模式。" }),
  Object.freeze({ code: "render_context_lost", capability: "render", status: "unavailable", fallback: "停止渲染", message: "画面上下文已丢失，世界状态仍保留在本地。" }),
  Object.freeze({ code: "low_frame_rate", capability: "render", status: "degraded", fallback: "降低视觉负载", message: "设备渲染压力较高，视觉效果已降级。" }),
]);

const faultByCode = new Map(FAULT_FIXTURES.map((fault) => [fault.code, fault]));

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

export function validateCapabilityState(value) {
  if (!exactObject(value, STATE_KEYS) || value.schemaVersion !== 1
    || CAPABILITIES.some((capability) => !STATUSES.has(value[capability]))) {
    throw new Error("CapabilityState 非法");
  }
  return structuredClone(value);
}

function makeState(initial = {}) {
  const value = { schemaVersion: 1 };
  for (const capability of CAPABILITIES) value[capability] = initial[capability] ?? "ready";
  return validateCapabilityState(value);
}

function defaultDetail(capability, status) {
  if (status === "ready") return { reason: "ready", fallback: "完整能力", message: `${capability} 已就绪。`, recoveryStreak: 0 };
  if (capability === "network") return { reason: "network_not_started", fallback: "离线单人", message: "实时连接尚未启动，回声镇保持离线单人模式。", recoveryStreak: 0 };
  return { reason: "initial_unavailable", fallback: "能力暂停", message: `${capability} 当前不可用。`, recoveryStreak: 0 };
}

export class CapabilityController {
  constructor(initial = {}) {
    this.initial = makeState(initial);
    this.listeners = new Set();
    this.reset();
  }

  reset() {
    this.current = structuredClone(this.initial);
    this.revision = 0;
    this.details = Object.fromEntries(CAPABILITIES.map((capability) => [capability, defaultDetail(capability, this.current[capability])]));
    this.transitions = [];
    this.notify();
    return this.snapshot();
  }

  state() {
    return validateCapabilityState(this.current);
  }

  snapshot() {
    return {
      state: this.state(),
      revision: this.revision,
      details: structuredClone(this.details),
      transitions: structuredClone(this.transitions),
    };
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new Error("Capability listener 非法");
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  injectFault(code, logicalTime = 0) {
    const fault = faultByCode.get(code);
    if (!fault) throw new Error("未知 Capability 故障");
    this.transition(fault.capability, fault.status, fault.code, fault.fallback, fault.message, logicalTime);
    return this.snapshot();
  }

  reportRecovery(capability, logicalTime = 0) {
    if (!CAPABILITIES.includes(capability)) throw new Error("未知 Capability");
    const detail = this.details[capability];
    if (this.current[capability] === "ready") return this.snapshot();
    detail.recoveryStreak += 1;
    if (detail.recoveryStreak < 2) {
      detail.message = "检测到能力恢复，等待第二次稳定确认。";
      this.notify();
      return this.snapshot();
    }
    this.transition(capability, "ready", "recovered", "完整能力", "能力已稳定恢复。", logicalTime);
    return this.snapshot();
  }

  transition(capability, status, reason, fallback, message, logicalTime) {
    if (!Number.isInteger(logicalTime) || logicalTime < 0) throw new Error("Capability logicalTime 非法");
    const from = this.current[capability];
    this.current[capability] = status;
    this.details[capability] = { reason, fallback, message, recoveryStreak: 0 };
    this.revision += 1;
    this.transitions.push({ revision: this.revision, capability, from, to: status, reason, logicalTime });
    if (this.transitions.length > 64) this.transitions.shift();
    this.notify();
  }

  notify() {
    if (!this.listeners) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export class PublicNodeRetry {
  constructor(nodeIds) {
    if (!Array.isArray(nodeIds) || nodeIds.length < 2 || nodeIds.length > 16
      || nodeIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 80)
      || new Set(nodeIds).size !== nodeIds.length) throw new Error("公共节点候选非法");
    this.nodeIds = [...nodeIds];
    this.backoffMs = Object.freeze([5_000, 15_000, 45_000]);
    this.reset();
  }

  reset() {
    this.failureCount = 0;
    this.nodeIndex = 0;
    this.retryDelayMs = 0;
    this.nextRetryAt = 0;
    this.exhausted = false;
    return this.snapshot();
  }

  failCurrent(now) {
    if (!Number.isInteger(now) || now < 0) throw new Error("公共节点时间非法");
    if (this.exhausted) return this.snapshot();
    this.failureCount += 1;
    if (this.failureCount > this.backoffMs.length) {
      this.exhausted = true;
      this.retryDelayMs = 0;
      this.nextRetryAt = 0;
      return this.snapshot();
    }
    this.retryDelayMs = this.backoffMs[this.failureCount - 1];
    this.nextRetryAt = now + this.retryDelayMs;
    this.nodeIndex = (this.nodeIndex + 1) % this.nodeIds.length;
    return this.snapshot();
  }

  reportSuccess() {
    return this.reset();
  }

  snapshot() {
    return {
      currentNodeId: this.nodeIds[this.nodeIndex],
      failureCount: this.failureCount,
      retryDelayMs: this.retryDelayMs,
      nextRetryAt: this.nextRetryAt,
      exhausted: this.exhausted,
    };
  }
}

const statusLabels = Object.freeze({ ready: "就绪", degraded: "降级", unavailable: "不可用" });
const capabilityLabels = Object.freeze({ render: "画面", localMind: "角色心智", network: "连接", persistence: "本地保存" });

export function describeCapabilityState(snapshot) {
  const state = validateCapabilityState(snapshot.state ?? snapshot);
  return CAPABILITIES.map((capability) => `${capabilityLabels[capability]}${statusLabels[state[capability]]}`).join(" · ");
}
