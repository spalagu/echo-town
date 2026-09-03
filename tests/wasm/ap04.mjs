import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const encoder = new TextEncoder();
const wasmBytes = await readFile(new URL("../../crates/world-core/pkg/echo_town_world_core_bg.wasm", import.meta.url));
const leftModule = await import("../../crates/world-core/pkg/echo_town_world_core.js?left");
const rightModule = await import("../../crates/world-core/pkg/echo_town_world_core.js?right");
leftModule.initSync({ module: wasmBytes });
rightModule.initSync({ module: wasmBytes });

const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const publicKeyHex = Array.from(publicKey, (byte) => byte.toString(16).padStart(2, "0")).join("");
const config = JSON.stringify({
  worldId: "echo-town-wasm-test",
  zoneId: "center",
  authorityId: "authority-fixture",
  actors: [{ actorId: "actor-fixture", publicKeyHex, x: 0, y: 0 }],
});
const left = new leftModule.WasmWorldCore(config);
const right = new rightModule.WasmWorldCore(config);

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function intent(seq, observedStateHash, dx, dy) {
  const unsigned = {
    schemaVersion: 1,
    worldId: "echo-town-wasm-test",
    zoneId: "center",
    actorId: "actor-fixture",
    seq,
    observedStateHash,
    intentType: "move",
    payload: { dx, dy },
    budget: 1,
    createdAtLogical: seq - 1,
    modelClass: "rules",
    publicKeyHex,
  };
  const signature = await crypto.subtle.sign(
    "Ed25519", pair.privateKey, encoder.encode(JSON.stringify(unsigned)),
  );
  return JSON.stringify({ ...unsigned, signatureHex: hex(signature) });
}

let checkpoints = 0;
let baselineMutationCheckpoint = "";
for (let seq = 1; seq <= 10_000; seq += 1) {
  const signed = await intent(seq, left.state_hash(), seq % 3 === 0 ? -1 : 1, seq % 5 === 0 ? 1 : 0);
  const leftEvent = left.apply_intent(signed);
  const rightEvent = right.apply_intent(signed);
  assert.equal(leftEvent, rightEvent);
  if (seq % 100 === 0) {
    assert.equal(left.state_hash(), right.state_hash());
    checkpoints += 1;
  }
  if (seq === 5_001) baselineMutationCheckpoint = left.state_hash();
}
assert.equal(checkpoints, 100);

const mutationModule = await import("../../crates/world-core/pkg/echo_town_world_core.js?mutation");
mutationModule.initSync({ module: wasmBytes });
const mutation = new mutationModule.WasmWorldCore(config);
for (let seq = 1; seq <= 5_001; seq += 1) {
  const signed = await intent(seq, mutation.state_hash(), seq === 5_000 ? -1 : (seq % 3 === 0 ? -1 : 1), seq % 5 === 0 ? 1 : 0);
  mutation.apply_intent(signed);
}
assert.notEqual(mutation.state_hash(), baselineMutationCheckpoint);

const replay = await intent(10_000, left.state_hash(), 1, 0);
assert.throws(() => left.apply_intent(replay), /sequence/);
console.log(JSON.stringify({ ticks: 10_000, checkpoints, finalHash: left.state_hash(), mutationDetected: true }));
