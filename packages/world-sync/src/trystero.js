import { validatePublicNodeRegistry } from "./index.js";

const ACTION = "echo-sync-v1";

async function moduleFor(protocol) {
  if (protocol === "nostr") return import("trystero/nostr");
  if (protocol === "webtorrent") return import("@trystero-p2p/torrent");
  throw new Error("未知公共信令策略");
}

export async function openPublicRendezvous({
  registry,
  roomId,
  onMessage,
  onPeerJoin = () => {},
  onPeerLeave = () => {},
  appId = "echo-town-world-sync-v1",
  moduleLoader = moduleFor,
}) {
  const checked = validatePublicNodeRegistry(registry);
  if (typeof roomId !== "string" || roomId.length === 0 || roomId.length > 128
    || typeof onMessage !== "function" || typeof moduleLoader !== "function") throw new Error("公共 rendezvous 参数非法");
  const opened = [];
  const seenMessages = new Set();
  const peersByStrategy = new Map();
  for (const strategy of checked.strategies) {
    const implementation = await moduleLoader(strategy.protocol);
    if (typeof implementation.joinRoom !== "function") throw new Error("公共 rendezvous 模块缺少 joinRoom");
    const room = implementation.joinRoom({
      appId,
      relayConfig: {
        urls: strategy.endpoints.map((endpoint) => endpoint.url),
        redundancy: strategy.endpoints.length,
        warnOnRelayFailure: false,
      },
    }, roomId);
    const action = room.makeAction(ACTION);
    action.onMessage = (message, context = {}) => {
      const key = message?.signature ?? JSON.stringify(message);
      if (seenMessages.has(key)) return;
      seenMessages.add(key);
      onMessage(message, { peerId: context.peerId ?? "unknown", strategy: strategy.protocol });
    };
    peersByStrategy.set(strategy.protocol, new Set());
    room.onPeerJoin = (peerId) => {
      peersByStrategy.get(strategy.protocol).add(peerId);
      onPeerJoin(peerId, strategy.protocol);
    };
    room.onPeerLeave = (peerId) => {
      peersByStrategy.get(strategy.protocol).delete(peerId);
      onPeerLeave(peerId, strategy.protocol);
    };
    opened.push({ strategy, room, action, implementation });
  }
  return {
    strategies: opened.map(({ strategy }) => ({
      id: strategy.id,
      protocol: strategy.protocol,
      endpoints: strategy.endpoints.map((endpoint) => endpoint.url),
    })),
    strategyStatus() {
      return opened.map(({ strategy, implementation }) => ({
        id: strategy.id,
        protocol: strategy.protocol,
        endpoints: strategy.endpoints.map((endpoint) => endpoint.url),
        relaySockets: typeof implementation.getRelaySockets === "function"
          ? Object.entries(implementation.getRelaySockets()).map(([url, socket]) => ({ url, readyState: socket.readyState }))
          : [],
        peerCount: peersByStrategy.get(strategy.protocol).size,
      }));
    },
    async send(message, target) {
      const results = await Promise.allSettled(opened.map(({ action }) => action.send(message, target ? { target } : undefined)));
      if (results.every((result) => result.status === "rejected")) throw new Error("所有公共信令策略发送失败");
      return results;
    },
    close() {
      opened.forEach(({ room }) => room.leave());
    },
  };
}
