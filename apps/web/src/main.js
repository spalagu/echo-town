import * as Phaser from "phaser";
import { IndexedDbVaultStore, loadOrCreateIdentity } from "@echo-town/identity-vault";
import { LocalMindClient } from "@echo-town/local-mind";
import { IndexedDbMemoryStore, MemoryGraph } from "@echo-town/memory-graph";
import { DILEMMA_FIXTURES, PERSONA_FIXTURES } from "@echo-town/persona-core";
import initWorldCore, { WasmWorldCore } from "../../../crates/world-core/pkg/echo_town_world_core.js";
import worldCoreUrl from "../../../crates/world-core/pkg/echo_town_world_core_bg.wasm?url";
import "./styles.css";

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const TILE = 24;

const places = [
  { name: "旧钟楼", x: 156, y: 116, color: 0xb66f45, message: "钟停在一个无人记得的时刻。有人说，雨夜里它会多响一下。" },
  { name: "玻璃温室", x: 744, y: 116, color: 0x5f9872, message: "潮湿的玻璃上总有新的手印，但没人承认来过。" },
  { name: "回声邮局", x: 240, y: 390, color: 0xd0a454, message: "未寄出的信会在这里停留，直到写信的人改变心意。" },
  { name: "河湾市场", x: 676, y: 396, color: 0x7992aa, message: "今天的摊主们在争论一枚用途不明的旧徽章。" },
];

function updatePlace(name, message) {
  document.querySelector("#place-name").textContent = name;
  document.querySelector("#place-message").textContent = message;
}

class EchoTownScene extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor(0x13231d);
    this.drawTown();
    this.player = this.add.circle(480, 270, 10, 0xf0d184).setDepth(5);
    this.player.setStrokeStyle(3, 0x283a33);
    this.target = new Phaser.Math.Vector2(this.player.x, this.player.y);
    this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,E,SPACE");
    this.input.on("pointerdown", (pointer) => this.target.set(pointer.worldX, pointer.worldY));
    window.__echoTown = {
      interact: () => this.interact(),
      moveTo: (x, y) => this.target.set(x, y),
      position: () => ({ x: this.player.x, y: this.player.y }),
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
    for (let index = 0; index < 18; index += 1) {
      const x = 90 + ((index * 113) % 780);
      const y = 70 + ((index * 67) % 360);
      this.add.circle(x, y, 7, 0x8fae9f, 0.85);
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
  const [identity, manifest, memorySnapshot] = await Promise.all([
    loadOrCreateIdentity(new IndexedDbVaultStore()),
    fetch("./version-manifest.json").then((response) => {
      if (!response.ok) throw new Error("版本清单不可用");
      return response.json();
    }),
    memoryStore.get(),
  ]);
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
  const personaIndex = Array.from(identity.actorId).reduce((sum, character) => sum + character.codePointAt(0), 0) % PERSONA_FIXTURES.length;
  const personaProfile = PERSONA_FIXTURES[personaIndex];
  const memoryGraph = new MemoryGraph(memorySnapshot || undefined);
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
  document.querySelector("#mind-status").textContent = `角色心智：${localMindStatus.mode} · ${localMindStatus.execution} · 人格已就绪 · ${memoryGraph.allMemories().length} 条有来源记忆`;
  document.querySelector("#runtime-status").textContent = `本地身份、AI Worker 与 Wasm 核心就绪 · ${manifest.version} · ${manifest.assets.length} 项静态资源`;

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
  window.__echoTownReady = {
    identity,
    manifest,
    game,
    worldCore,
    localMind,
    firstDecision,
    personaProfile,
    personaFixtures: PERSONA_FIXTURES,
    dilemmaFixtures: DILEMMA_FIXTURES,
    memoryGraph,
    memoryStore,
    stateHash: worldCore.state_hash(),
  };
}

bootstrap().catch((error) => {
  document.querySelector("#runtime-status").textContent = `启动失败：${error.message}`;
  window.__echoTownBootError = error;
});
