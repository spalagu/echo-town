const VAULT_KEY = "owner-identity-v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const familyNames = ["林", "沈", "岑", "闻", "白", "时", "叶", "江", "陆", "顾", "陶", "温"];
const givenNames = ["雾生", "遥川", "知禾", "弥音", "栖迟", "望舒", "青砚", "微澜", "星野", "予安", "见夏", "停云"];
const colors = ["#d4a55d", "#6e9b81", "#b36f65", "#7c8fb8", "#a57baf", "#6f9da8"];
const silhouettes = ["round", "tall", "soft", "angular"];

function bytesToBase64(bytes) {
  let value = "";
  for (const byte of new Uint8Array(bytes)) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomIndex(length, cryptoApi = globalThis.crypto) {
  const value = new Uint32Array(1);
  cryptoApi.getRandomValues(value);
  return value[0] % length;
}

function randomProfile(cryptoApi = globalThis.crypto) {
  const traits = new Uint8Array(5);
  cryptoApi.getRandomValues(traits);
  return {
    name: `${familyNames[randomIndex(familyNames.length, cryptoApi)]}${givenNames[randomIndex(givenNames.length, cryptoApi)]}`,
    appearance: {
      primaryColor: colors[randomIndex(colors.length, cryptoApi)],
      silhouette: silhouettes[randomIndex(silhouettes.length, cryptoApi)],
    },
    personalitySeed: Array.from(traits, (value) => 20 + (value % 61)),
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

async function actorIdFromPublicKey(publicKey, cryptoApi = globalThis.crypto) {
  const digest = await cryptoApi.subtle.digest("SHA-256", publicKey);
  return `echo_${Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function createIdentity(cryptoApi = globalThis.crypto) {
  const pair = await cryptoApi.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const [publicKey, publicKeyRaw, privateKey] = await Promise.all([
    cryptoApi.subtle.exportKey("spki", pair.publicKey),
    cryptoApi.subtle.exportKey("raw", pair.publicKey),
    cryptoApi.subtle.exportKey("pkcs8", pair.privateKey),
  ]);
  return {
    version: 1,
    actorId: await actorIdFromPublicKey(publicKey, cryptoApi),
    profile: randomProfile(cryptoApi),
    publicKey: bytesToBase64(publicKey),
    publicKeyRaw: bytesToBase64(publicKeyRaw),
    privateKey: bytesToBase64(privateKey),
    createdAt: new Date().toISOString(),
  };
}

export async function sign(identity, payload, cryptoApi = globalThis.crypto) {
  const privateKey = await cryptoApi.subtle.importKey(
    "pkcs8",
    base64ToBytes(identity.privateKey),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await cryptoApi.subtle.sign("Ed25519", privateKey, encoder.encode(canonicalJson(payload)));
  return bytesToBase64(signature);
}

export async function verify(identity, payload, signature, cryptoApi = globalThis.crypto) {
  const publicKey = await cryptoApi.subtle.importKey(
    "spki",
    base64ToBytes(identity.publicKey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return cryptoApi.subtle.verify("Ed25519", publicKey, base64ToBytes(signature), encoder.encode(canonicalJson(payload)));
}

export class MemoryVaultStore {
  constructor() { this.value = null; }
  async get() { return structuredClone(this.value); }
  async set(value) { this.value = structuredClone(value); }
  async clear() { this.value = null; }
}

export class IndexedDbVaultStore {
  constructor(name = "echo-town-identity") { this.name = name; }

  async database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("vault");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async transact(mode, operation) {
    const database = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("vault", mode);
        const request = operation(transaction.objectStore("vault"));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }

  get() { return this.transact("readonly", (store) => store.get(VAULT_KEY)); }
  set(value) { return this.transact("readwrite", (store) => store.put(value, VAULT_KEY)); }
  clear() { return this.transact("readwrite", (store) => store.delete(VAULT_KEY)); }
}

export async function loadOrCreateIdentity(store, cryptoApi = globalThis.crypto) {
  const existing = await store.get();
  if (existing) return existing;
  const identity = await createIdentity(cryptoApi);
  await store.set(identity);
  return identity;
}

export async function exportEncrypted(identity, passphrase, cryptoApi = globalThis.crypto) {
  if (passphrase.length < 8) throw new Error("恢复口令至少需要 8 个字符");
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const material = await cryptoApi.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await cryptoApi.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(identity)),
  );
  return JSON.stringify({ version: 1, kdf: "PBKDF2-SHA256", iterations: 210_000, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) });
}

export async function importEncrypted(serialized, passphrase, cryptoApi = globalThis.crypto) {
  const envelope = JSON.parse(serialized);
  if (envelope.version !== 1 || envelope.kdf !== "PBKDF2-SHA256" || envelope.iterations !== 210_000) throw new Error("不支持的身份备份版本");
  const material = await cryptoApi.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await cryptoApi.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(envelope.salt), iterations: envelope.iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plaintext = await cryptoApi.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv) }, key, base64ToBytes(envelope.ciphertext),
  );
  const identity = JSON.parse(decoder.decode(plaintext));
  const expectedActorId = await actorIdFromPublicKey(base64ToBytes(identity.publicKey), cryptoApi);
  if (identity.actorId !== expectedActorId) throw new Error("身份备份校验失败");
  return identity;
}
