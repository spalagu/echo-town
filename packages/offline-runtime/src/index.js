const ACTIVITY_KEYS = new Set(["schemaVersion", "id", "actorId", "kind", "sourceEventIds", "logicalTime", "publicProjection"]);
const PROJECTION_KEYS = new Set(["eventType", "placeId"]);

function exactObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function text(value, maximum = 96) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

export function validatePendingActivity(value) {
  if (!exactObject(value, ACTIVITY_KEYS) || value.schemaVersion !== 1 || !text(value.id)
    || !text(value.actorId) || value.kind !== "mergeable_local" || !Number.isInteger(value.logicalTime) || value.logicalTime < 0
    || !Array.isArray(value.sourceEventIds) || value.sourceEventIds.length === 0 || value.sourceEventIds.length > 8
    || value.sourceEventIds.some((id) => !text(id)) || !exactObject(value.publicProjection, PROJECTION_KEYS)
    || !text(value.publicProjection.eventType, 48) || !text(value.publicProjection.placeId, 80)) {
    throw new Error("PendingActivity 非法");
  }
  return structuredClone(value);
}

export class OfflineActivityQueue {
  constructor(snapshot = []) {
    if (!Array.isArray(snapshot) || snapshot.length > 256) throw new Error("离线活动快照非法");
    this.activities = snapshot.map(validatePendingActivity);
    if (new Set(this.activities.map((item) => item.id)).size !== this.activities.length) throw new Error("离线活动重复");
  }

  record(activity) {
    const value = validatePendingActivity(activity);
    if (this.activities.some((item) => item.id === value.id)) throw new Error("离线活动重复");
    this.activities.push(value);
    if (this.activities.length > 256) this.activities.shift();
    return this.snapshot();
  }

  acknowledge(ids) {
    if (!Array.isArray(ids) || ids.some((id) => !text(id))) throw new Error("离线确认非法");
    const accepted = new Set(ids);
    this.activities = this.activities.filter((item) => !accepted.has(item.id));
    return this.snapshot();
  }

  prepareResync() {
    return {
      schemaVersion: 1,
      activities: this.activities.map((item) => structuredClone(item)),
      containsPrivatePayload: false,
    };
  }

  snapshot() {
    return this.activities.map((item) => structuredClone(item));
  }
}

export class IndexedDbOfflineStore {
  constructor({ databaseName = "echo-town-offline", storeName = "queue", key = "pending-v1" } = {}) {
    this.databaseName = databaseName;
    this.storeName = storeName;
    this.key = key;
  }

  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) request.result.createObjectStore(this.storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get() {
    const database = await this.open();
    try {
      return await transaction(database, this.storeName, "readonly", (store) => store.get(this.key));
    } finally {
      database.close();
    }
  }

  async set(snapshot) {
    const validated = new OfflineActivityQueue(snapshot).snapshot();
    const database = await this.open();
    try {
      await transaction(database, this.storeName, "readwrite", (store) => store.put(validated, this.key));
    } finally {
      database.close();
    }
  }
}

function transaction(database, storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode);
    const request = operation(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function registerOfflineWorker() {
  if (!("serviceWorker" in navigator)) return { supported: false, controlled: false, registration: null };
  let registration;
  try {
    registration = await navigator.serviceWorker.register(new URL("./sw.js", document.baseURI), { scope: "./" });
  } catch {
    return { supported: true, controlled: false, registration: null };
  }
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3_000);
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }
  return { supported: true, controlled: Boolean(navigator.serviceWorker.controller), registration };
}
