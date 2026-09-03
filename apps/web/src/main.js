import * as Phaser from "phaser";
import { CapabilityController, describeCapabilityState } from "@echo-town/capability-state";
import { CompanionSession, IndexedDbCompanionStore } from "@echo-town/companion-core";
import { buildEngagementState } from "@echo-town/engagement-director";
import { assessFictionalContent, assertVisibleFictionNotice, validateFictionBoundary } from "@echo-town/fiction-boundary";
import { IndexedDbVaultStore, loadOrCreateIdentity } from "@echo-town/identity-vault";
import { LocalMindClient } from "@echo-town/local-mind";
import { IndexedDbMemoryStore, MemoryGraph } from "@echo-town/memory-graph";
import { simulateMystery } from "@echo-town/mystery-fabric";
import { IndexedDbOfflineStore, OfflineActivityQueue, registerOfflineWorker } from "@echo-town/offline-runtime";
import { DILEMMA_FIXTURES, PERSONA_FIXTURES } from "@echo-town/persona-core";
import { createPublicActivityEnvelope, PrivacyNetworkGate, PUBLIC_WIRE_FIELD_PATHS } from "@echo-town/privacy-network";
import { simulateSociety, validateSimulationResult } from "@echo-town/public-discourse";
import { IndexedDbWorldSyncStore, PublicWorldSyncSession, validatePublicNodeRegistry, WorldSyncReplica } from "@echo-town/world-sync";
import { openPublicRendezvous } from "@echo-town/world-sync/trystero";
import initWorldCore, { WasmWorldCore } from "../../../crates/world-core/pkg/echo_town_world_core.js";
import worldCoreUrl from "../../../crates/world-core/pkg/echo_town_world_core_bg.wasm?url";
import "./styles.css";

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const TILE = 24;
const VISIBLE_ROLE_BUDGET = 20;

const places = [
  { id: "old-clocktower", name: "旧钟楼", x: 156, y: 116, color: 0xb66f45, message: "钟停在一个无人记得的时刻。有人说，雨夜里它会多响一下。" },
  { id: "glass-greenhouse", name: "玻璃温室", x: 744, y: 116, color: 0x5f9872, message: "潮湿的玻璃上总有新的手印，但没人承认来过。" },
  { id: "echo-post-office", name: "回声邮局", x: 240, y: 390, color: 0xd0a454, message: "未寄出的信会在这里停留，直到写信的人改变心意。" },
  { id: "river-market", name: "河湾市场", x: 676, y: 396, color: 0x7992aa, message: "今天的摊主们在争论一枚用途不明的旧徽章。" },
];

function applyWorldContent(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.packs)) throw new Error("世界内容清单非法");
  const entries = manifest.packs.flatMap((pack) => pack?.content?.entries ?? []);
  for (const place of places) {
    const content = entries.find((entry) => entry.kind === "place" && entry.id === place.id);
    if (content) {
      place.name = content.title;
      place.message = content.summary;
    }
  }
}

function updatePlace(name, message) {
  document.querySelector("#place-name").textContent = name;
  document.querySelector("#place-message").textContent = message;
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderBehaviorDetail(companion, behaviorId) {
  const detail = companion.explainBehavior(behaviorId);
  const container = document.querySelector("#behavior-detail");
  const eyebrow = element("p", "eyebrow", detail.behavior.type === "action" ? "行动的真实原因" : "表达的真实原因");
  const title = element("h3", "", `第 ${detail.behavior.logicalDay} 日 · ${detail.behavior.summary}`);
  const statement = element("p", "", `人格 ${detail.reason.personaProfileId} 采用策略 ${detail.reason.strategyId}，效用 ${detail.reason.utility}。以下因素来自当时的决策记录，不是事后推测。`);
  const factorList = element("ul", "factor-list");
  detail.reason.factors.slice(0, 8).forEach((factor) => {
    factorList.append(element("li", "", `${factor.path} = ${factor.value}（${factor.contribution > 0 ? "+" : ""}${factor.contribution}）`));
  });
  const sourceTitle = element("p", "", "可核对来源");
  const sourceList = element("ul", "source-list");
  detail.events.forEach((event) => sourceList.append(element("li", "", `事件 ${event.id}`)));
  detail.memories.slice(0, 4).forEach((memory) => sourceList.append(element("li", "", `记忆 ${memory.id}`)));
  detail.claims.slice(0, 4).forEach((claim) => sourceList.append(element("li", "", `表达 ${claim.id}`)));
  container.replaceChildren(eyebrow, title, statement, factorList, sourceTitle, sourceList);
}

function renderBehaviors(companion) {
  const list = document.querySelector("#behavior-list");
  list.replaceChildren();
  companion.behaviors().forEach((behavior) => {
    const item = element("li", "behavior-card");
    const meta = element("div", "behavior-meta");
    meta.append(element("span", "", `第 ${behavior.logicalDay} 日`), element("span", "", behavior.type === "action" ? "行动" : "表达"));
    const summary = element("p", "", behavior.summary);
    const button = element("button", "why-button", "查看为什么");
    button.type = "button";
    button.dataset.behaviorId = behavior.id;
    button.setAttribute("aria-label", `查看第 ${behavior.logicalDay} 日这段${behavior.type === "action" ? "行动" : "表达"}的原因`);
    button.addEventListener("click", () => renderBehaviorDetail(companion, behavior.id));
    item.append(meta, summary, button);
    list.append(item);
  });
  renderBehaviorDetail(companion, companion.behaviors()[0].id);
}

function renderReturnSummary(companion) {
  const summary = companion.returnSummary(0, 30);
  const container = document.querySelector("#return-summary");
  const list = element("ul", "return-highlights");
  summary.highlights.forEach((highlight) => list.append(element("li", "", `第 ${highlight.logicalDay} 日 · ${highlight.summary}`)));
  container.replaceChildren(
    element("p", "eyebrow", "离开之后 / 只读摘要"),
    element("h3", "", summary.title),
    list,
  );
}

function renderEngagementHooks(state) {
  const labels = {
    relationship: "关系", mystery: "未解现象", controversy: "分歧", scarcity: "变化窗口",
    social_change: "小镇变化", contribution: "你的影响",
  };
  const list = document.querySelector("#engagement-hook-list");
  list.replaceChildren(...state.hooks.map((hookState) => {
    const item = element("li", `engagement-hook hook-${hookState.kind}`);
    const meta = element("div", "hook-meta");
    meta.append(
      element("span", "hook-kind", labels[hookState.kind]),
      element("span", "hook-score", `信号 ${hookState.score}`),
    );
    const sourceCount = hookState.sourceEventIds.length + hookState.sourceClaimIds.length
      + hookState.sourcePlanIds.length + hookState.sourceInfluenceIds.length;
    item.append(
      meta,
      element("h3", "", hookState.title),
      element("p", "", hookState.summary),
      element("small", "hook-source", `${sourceCount} 个可核对来源${hookState.expiresAtTick === null ? "" : ` · 有效至逻辑时刻 ${hookState.expiresAtTick}`}`),
    );
    return item;
  }));
  document.querySelector("#engagement-status").textContent = state.coverageGaps.includes("influence")
    ? "当前没有已回应的陪伴影响；其余牵挂均来自已经发生的世界记录。"
    : "你的影响已被角色回应，并作为一种真实但非强制的牵挂保留。";
}

function renderHeartRoom(companion) {
  const container = document.querySelector("#heart-log");
  const entries = companion.heartRoom();
  if (entries.length === 0) {
    container.replaceChildren(element("p", "empty-state", "还没有说过话。可以从今天过得怎么样开始。"));
    return;
  }
  container.replaceChildren(...entries.map((entry) => {
    const item = element("article", `heart-entry${entry.role === "user" ? " is-user" : ""}`, entry.text);
    item.append(element("small", "", entry.role === "user" ? "你 · 本地私人" : "角色 · 本地私人 · 非世界事实"));
    return item;
  }));
}

function influenceStatusLabel(status) {
  return ({ pending: "等待角色回应", accepted_as_influence: "角色愿意把它当作参考", refused: "角色选择不接受" })[status];
}

function renderInfluences(companion, companionStore, refreshEngagement) {
  const list = document.querySelector("#influence-list");
  list.replaceChildren(...companion.influenceLog().map((influence) => {
    const item = element("li", "influence-item");
    item.append(
      element("span", "influence-status", `${({ letter: "信件", wish: "愿望", gift: "礼物" })[influence.kind]} · ${influenceStatusLabel(influence.status)}`),
      element("p", "", influence.text),
    );
    if (influence.status === "pending") {
      const button = element("button", "respond-button", "让角色回应");
      button.type = "button";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const considered = companion.considerInfluence(influence.id);
          await companionStore.set(companion.snapshot());
          document.querySelector("#influence-feedback").textContent = influenceStatusLabel(considered.status);
          renderInfluences(companion, companionStore, refreshEngagement);
          refreshEngagement();
        } catch (error) {
          button.disabled = false;
          document.querySelector("#influence-feedback").textContent = `回应失败：${error.message}`;
        }
      });
      item.append(button);
    }
    return item;
  }));
}

function renderMemoryAlbum(companion) {
  const album = document.querySelector("#memory-album");
  const memories = companion.memoryAlbum();
  if (memories.length === 0) {
    album.replaceChildren(element("li", "empty-state", "角色还没有形成带来源的生活记忆。"));
    return;
  }
  album.replaceChildren(...memories.map((memory) => {
    const item = element("li", "memory-item");
    item.append(
      element("span", "memory-source", `第 ${memory.logicalTime} 日 · ${memory.kind}`),
      element("p", "", memory.summary),
      element("span", "memory-source", `来源：${memory.sourceEventIds.join("、")}`),
    );
    return item;
  }));
}

function setupCompanionTabs() {
  const tabs = [...document.querySelectorAll("[role=tab]")];
  const activate = (tab) => {
    tabs.forEach((candidate) => {
      const active = candidate === tab;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-selected", String(active));
      candidate.tabIndex = active ? 0 : -1;
      document.querySelector(`#${candidate.getAttribute("aria-controls")}`).hidden = !active;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[nextIndex]);
      tabs[nextIndex].focus();
    });
  });
}

function setupCompanionUi(companion, companionStore, refreshEngagement) {
  renderReturnSummary(companion);
  renderBehaviors(companion);
  renderHeartRoom(companion);
  renderInfluences(companion, companionStore, refreshEngagement);
  renderMemoryAlbum(companion);
  setupCompanionTabs();

  document.querySelector("#heart-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const input = form.elements.message;
    button.disabled = true;
    try {
      companion.sendHeartMessage({ text: input.value, logicalDay: 30 });
      await companionStore.set(companion.snapshot());
      input.value = "";
      document.querySelector("#heart-feedback").textContent = "已保存在本机心室，未写入公开世界。";
      renderHeartRoom(companion);
    } catch (error) {
      document.querySelector("#heart-feedback").textContent = `发送失败：${error.message}`;
      input.focus();
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#influence-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      companion.submitInfluence({ kind: form.elements.kind.value, text: form.elements.text.value, logicalDay: 30 });
      await companionStore.set(companion.snapshot());
      form.elements.text.value = "";
      document.querySelector("#influence-feedback").textContent = "已留在本机，等待角色回应。";
      renderInfluences(companion, companionStore, refreshEngagement);
    } catch (error) {
      document.querySelector("#influence-feedback").textContent = `未能留下：${error.message}`;
      form.elements.text.focus();
    } finally {
      button.disabled = false;
    }
  });
}

class EchoTownScene extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor(0x13231d);
    this.drawTown();
    this.player = this.add.circle(480, 270, 10, 0xf0d184).setDepth(5).setName("player-role");
    this.player.setStrokeStyle(3, 0x283a33);
    this.target = new Phaser.Math.Vector2(this.player.x, this.player.y);
    this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,E,SPACE");
    this.input.on("pointerdown", (pointer) => this.target.set(pointer.worldX, pointer.worldY));
    window.__echoTown = {
      interact: () => this.interact(),
      moveTo: (x, y) => this.target.set(x, y),
      position: () => ({ x: this.player.x, y: this.player.y }),
      visibleRoleCount: () => VISIBLE_ROLE_BUDGET,
    };
  }

  drawTown() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x1e392e).fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    graphics.fillStyle(0x365a45);
    for (let x = 0; x < WORLD_WIDTH; x += TILE) {
      for (let y = 0; y < WORLD_HEIGHT; y += TILE) {
        if ((x / TILE + y / TILE) % 5 === 0) graphics.fillRect(x + 5, y + 5, 2, 2);
      }
    }
    graphics.fillStyle(0xa58a61).fillRect(0, 250, WORLD_WIDTH, 52).fillRect(444, 0, 72, WORLD_HEIGHT);
    graphics.fillStyle(0x7593a0).fillRect(0, 476, WORLD_WIDTH, 64);
    graphics.lineStyle(2, 0xb7d0d6, 0.22).lineBetween(0, 492, WORLD_WIDTH, 492);
    places.forEach((place) => {
      graphics.fillStyle(place.color).fillRoundedRect(place.x - 42, place.y - 32, 84, 64, 8);
      graphics.fillStyle(0x18241f).fillRect(place.x - 9, place.y + 7, 18, 25);
      this.add.text(place.x, place.y - 47, place.name, {
        color: "#f1eadb", fontFamily: 'Georgia, "Songti SC", serif', fontSize: "14px",
      }).setOrigin(0.5);
    });
    for (let index = 0; index < VISIBLE_ROLE_BUDGET - 1; index += 1) {
      const x = 90 + ((index * 113) % 780);
      const y = 70 + ((index * 67) % 360);
      this.add.circle(x, y, 7, 0x8fae9f, 0.85).setName(`resident-role-${index + 1}`);
    }
  }

  update(_, delta) {
    const speed = 0.19 * delta;
    const horizontal = Number(this.keys.D.isDown || this.keys.RIGHT.isDown) - Number(this.keys.A.isDown || this.keys.LEFT.isDown);
    const vertical = Number(this.keys.S.isDown || this.keys.DOWN.isDown) - Number(this.keys.W.isDown || this.keys.UP.isDown);
    if (horizontal || vertical) this.target.set(this.player.x + horizontal * speed, this.player.y + vertical * speed);
    const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.target.x, this.target.y);
    if (distance > 2) {
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.target.x, this.target.y);
      this.player.x = Phaser.Math.Clamp(this.player.x + Math.cos(angle) * Math.min(speed, distance), 12, WORLD_WIDTH - 12);
      this.player.y = Phaser.Math.Clamp(this.player.y + Math.sin(angle) * Math.min(speed, distance), 12, WORLD_HEIGHT - 76);
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.E) || Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.interact();
  }

  interact() {
    const nearest = places
      .map((place) => ({ place, distance: Phaser.Math.Distance.Between(this.player.x, this.player.y, place.x, place.y) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (nearest.distance > 96) {
      updatePlace("路途中", "这里没有明确的任务箭头。靠近一处地点，再听听它今天留下了什么。 ");
      return { place: null };
    }
    updatePlace(nearest.place.name, nearest.place.message);
    return { place: nearest.place.name };
  }
}

async function bootstrap() {
  const memoryStore = new IndexedDbMemoryStore();
  const offlineStore = new IndexedDbOfflineStore();
  const companionStore = new IndexedDbCompanionStore();
  const worldSyncStore = new IndexedDbWorldSyncStore();
  const [identity, manifest, worldContent, publicNodes, memorySnapshot, offlineSnapshot, companionSnapshot, worldSyncSnapshot, offlineWorker] = await Promise.all([
    loadOrCreateIdentity(new IndexedDbVaultStore()),
    fetch("./version-manifest.json").then((response) => {
      if (!response.ok) throw new Error("版本清单不可用");
      return response.json();
    }),
    fetch("./world-content-manifest.json").then((response) => {
      if (!response.ok) throw new Error("世界内容清单不可用");
      return response.json();
    }),
    fetch("./public-nodes.json").then((response) => {
      if (!response.ok) throw new Error("公共节点清单不可用");
      return response.json();
    }).then(validatePublicNodeRegistry),
    memoryStore.get(),
    offlineStore.get(),
    companionStore.get(),
    worldSyncStore.get(),
    registerOfflineWorker(),
  ]);
  applyWorldContent(worldContent);
  const fictionBoundary = validateFictionBoundary(worldContent.fictionBoundary);
  const verifyFictionBoundary = () => assertVisibleFictionNotice(document.querySelector("#fiction-boundary"));
  const verifyFictionUi = () => assessFictionalContent(document.body.innerText, "浏览器可见 UI");
  verifyFictionBoundary();
  verifyFictionUi();
  window.__echoTownFictionReady = { fictionBoundary, verifyFictionBoundary, verifyFictionUi };
  const socialFoundation = {
    initialStatePacks: worldContent.packs.filter((pack) => pack.packType === "initial-state").length,
    situationSeeds: worldContent.packs.filter((pack) => pack.packType === "situation-seed").length,
  };
  const initialStatePacks = worldContent.packs.filter((pack) => pack.packType === "initial-state").map((pack) => pack.content);
  const situationSeeds = worldContent.packs.filter((pack) => pack.packType === "situation-seed").map((pack) => pack.content);
  const mysterySeeds = worldContent.packs.filter((pack) => pack.packType === "mystery-seed").map((pack) => pack.content);
  if (initialStatePacks.length === 0 || situationSeeds.length === 0 || mysterySeeds.length === 0) throw new Error("社会运行时缺少初态、情境或悬疑来源");
  const societySeed = Array.from(identity.actorId).reduce((sum, character) => (sum * 33 + character.codePointAt(0)) % 1_000_001, 0);
  const societySimulation = simulateSociety(initialStatePacks[0], situationSeeds, societySeed);
  const societyValidation = validateSimulationResult(societySimulation, initialStatePacks[0], situationSeeds);
  if (!societyValidation.ok) throw new Error(`社会运行时不变量失败：${societyValidation.reason}`);
  window.__echoTownSocietyReady = { societySimulation, societyValidation };
  document.querySelector("#actor-name").textContent = identity.profile.name;
  document.querySelector("#actor-id").textContent = identity.actorId.slice(0, 18);
  document.querySelector("#identity-mark").style.background = identity.profile.appearance.primaryColor;
  await initWorldCore({ module_or_path: worldCoreUrl });
  const publicKeyRaw = Uint8Array.from(atob(identity.publicKeyRaw), (character) => character.charCodeAt(0));
  const publicKeyHex = Array.from(publicKeyRaw, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const worldCore = new WasmWorldCore(JSON.stringify({
    worldId: "echo-town-local",
    zoneId: "center",
    authorityId: identity.actorId,
    actors: [{ actorId: identity.actorId, publicKeyHex, x: 0, y: 0 }],
  }));
  const localMind = new LocalMindClient();
  const capabilityController = new CapabilityController({ network: "unavailable" });
  capabilityController.subscribe((snapshot) => {
    const activeFallbacks = ["render", "localMind", "network", "persistence"]
      .filter((capability) => snapshot.state[capability] !== "ready")
      .map((capability) => snapshot.details[capability].fallback)
      .filter((fallback, index, values) => values.indexOf(fallback) === index);
    document.querySelector("#capability-status").textContent = `能力状态：${describeCapabilityState(snapshot)} · ${activeFallbacks.join(" / ")}`;
  });
  const personaIndex = Array.from(identity.actorId).reduce((sum, character) => sum + character.codePointAt(0), 0) % PERSONA_FIXTURES.length;
  const personaProfile = PERSONA_FIXTURES[personaIndex];
  const companionInputs = {
    ownerActorId: identity.actorId,
    sourceActorId: `${personaProfile.id}-${societySeed}`,
    personaProfile,
    events: societySimulation.events,
    claims: societySimulation.claims,
    memories: societySimulation.memories,
    acquaintances: societySimulation.acquaintances,
  };
  let companion = new CompanionSession(companionInputs);
  if (companionSnapshot) {
    try {
      companion = new CompanionSession({ ...companionInputs, snapshot: companionSnapshot });
    } catch {
      await companionStore.clear();
    }
  }
  const mysteryRuns = mysterySeeds.map((mystery, index) => simulateMystery(mystery, personaProfile, societySeed + index));
  const engagementInput = () => ({
    actorId: companionInputs.sourceActorId,
    generatedAtTick: 30,
    events: societySimulation.events,
    claims: societySimulation.claims,
    relationships: societySimulation.acquaintances,
    resources: societySimulation.resources,
    plans: situationSeeds,
    mysteryRuns,
    influences: companion.influenceLog().filter((item) => item.status !== "pending").map((item) => ({
      id: item.id,
      status: item.status,
      sourceEventIds: [...new Set([
        ...item.sourceRelationshipEventIds,
        ...item.sourceBehaviorIds.flatMap((id) => companion.explainBehavior(id).behavior.sourceEventIds),
      ])],
    })),
  });
  let engagementState = buildEngagementState(engagementInput());
  const refreshEngagement = () => {
    engagementState = buildEngagementState(engagementInput());
    renderEngagementHooks(engagementState);
    if (window.__echoTownReady) window.__echoTownReady.engagementState = engagementState;
    return engagementState;
  };
  const memoryGraph = new MemoryGraph(memorySnapshot || undefined);
  const offlineQueue = new OfflineActivityQueue(offlineSnapshot || undefined);
  const privacyNetwork = new PrivacyNetworkGate({ endpoint: "./__echo-town-sync" });
  const worldSyncReplica = new WorldSyncReplica({
    worldId: "echo-town-local",
    zoneId: "center",
    initialStateHash: worldContent.contentHash,
    committee: [identity.actorId],
    snapshot: worldSyncSnapshot,
  });
  const syncRoom = new URLSearchParams(location.search).get("syncRoom") || "echo-town-public-v1";
  const worldSync = new PublicWorldSyncSession({
    identity,
    registry: publicNodes,
    replica: worldSyncReplica,
    roomId: syncRoom,
    openTransport: openPublicRendezvous,
    onSnapshot: (snapshot) => worldSyncStore.set(snapshot),
    onStatus: (status) => {
      const connected = status.strategies.some((strategy) => strategy.peerCount > 0) && status.received.length > 0;
      if (connected && capabilityController.state().network !== "ready") {
        capabilityController.reportRecovery("network", status.received.length);
        capabilityController.reportRecovery("network", status.received.length + 1);
      } else if (!connected && capabilityController.state().network === "ready") {
        capabilityController.injectFault("network_partition", status.received.length + 1);
      }
    },
  });
  const connectWorldSync = async () => {
    await worldSync.start();
    return worldSync.status();
  };
  const prepareWorldSyncResync = () => offlineQueue.prepareResync().activities.map((activity) => createPublicActivityEnvelope({
        worldId: "echo-town-local",
        zoneId: "center",
        senderActorId: identity.actorId,
        messageId: `resync:${activity.id}`,
        logicalTime: activity.logicalTime,
        activity,
        privateContext: {},
      }));
  if (!memorySnapshot) {
    memoryGraph.remember({
      id: `identity-${identity.actorId}`,
      ownerActorId: identity.actorId,
      kind: "identity",
      summary: `${identity.profile.name} 在回声镇醒来。`,
      sourceEventIds: [`identity-created-${identity.actorId}`],
      subjects: [identity.actorId],
      logicalTime: 0,
      salience: 100,
      emotionalValence: 0,
      confidence: 100,
      visibility: "private",
      consolidationParentIds: [],
      decayClass: "protected",
    });
    memoryGraph.consolidate(0);
    await memoryStore.set(memoryGraph.snapshot());
  }
  const localMindStatus = await localMind.status();
  const firstDecision = await localMind.decide({
    actorId: identity.actorId,
    logicalTime: 0,
    position: { x: 0, y: 0 },
    nearbyPlaces: [
      { id: "old-clocktower", dx: -1, dy: -1, tags: ["curiosity"] },
      { id: "river-market", dx: 1, dy: 1, tags: ["social"] },
    ],
    needs: [{ kind: "social", level: 62 }],
    visibleEvents: [],
  }, { personaProfile, dilemma: DILEMMA_FIXTURES[0] });
  const chosen = firstDecision.personaDecision.candidates[0];
  const strongestReasons = chosen.factors.slice(0, 3)
    .map((factor) => `${factor.path}=${factor.value}（${factor.contribution > 0 ? "+" : ""}${factor.contribution}）`)
    .join("；");
  document.querySelector("#mind-status").textContent = `角色心智：${localMindStatus.mode} · ${localMindStatus.execution} · 人格 ${personaProfile.id} 选择“${chosen.label}” · 理由：${strongestReasons} · 语气：${chosen.voice} · ${memoryGraph.allMemories().length} 条有来源记忆`;
  const offlineLabel = offlineWorker.controlled ? "离线缓存就绪" : "离线缓存未接管";
  document.querySelector("#runtime-status").textContent = `本地身份、AI Worker、Wasm 核心与${offlineLabel} · 社会运行时 ${societySimulation.events.length} 个事件 / ${societySimulation.claims.length} 个观点 · ${socialFoundation.initialStatePacks} 个初态 / ${socialFoundation.situationSeeds} 个情境 · ${manifest.version} · ${manifest.assets.length} 项静态资源`;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    scene: EchoTownScene,
    banner: false,
    render: { antialias: false, pixelArt: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  });
  renderEngagementHooks(engagementState);
  setupCompanionUi(companion, companionStore, refreshEngagement);
  verifyFictionUi();
  window.__echoTownReady = {
    identity,
    fictionBoundary,
    verifyFictionBoundary,
    verifyFictionUi,
    manifest,
    worldContent,
    socialFoundation,
    societySimulation,
    societyValidation,
    game,
    worldCore,
    localMind,
    capabilityController,
    offlineQueue,
    offlineStore,
    offlineWorker,
    privacyNetwork,
    publicNodes,
    worldSync,
    worldSyncStore,
    connectWorldSync,
    prepareWorldSyncResync,
    privacyWireFields: PUBLIC_WIRE_FIELD_PATHS,
    firstDecision,
    personaProfile,
    companion,
    companionStore,
    engagementState,
    refreshEngagement,
    mysteryRuns,
    personaFixtures: PERSONA_FIXTURES,
    dilemmaFixtures: DILEMMA_FIXTURES,
    memoryGraph,
    memoryStore,
    stateHash: worldCore.state_hash(),
  };
  if (new URLSearchParams(location.search).get("sync") === "1") {
    connectWorldSync().catch((error) => worldSync.errors.push(error.message));
  }
}

bootstrap().catch((error) => {
  document.querySelector("#runtime-status").textContent = `启动失败：${error.message}`;
  window.__echoTownBootError = error;
});
