import { createGameServer } from "./server.js";
import { DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY } from "./duel/authoritative-runtime-p4.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const storageDirectory = process.env.RIFTBOUND_STORAGE_DIRECTORY;
const duelRoomProfile = process.env.RIFTBOUND_DUEL_PROFILE ?? "p4";
if (duelRoomProfile !== "v1" && duelRoomProfile !== "p4") throw new TypeError("RIFTBOUND_DUEL_PROFILE 必须是 v1 或 p4");

const requestedRuntimeProfile = process.env.RIFTBOUND_DUEL_RUNTIME_PROFILE;
if (requestedRuntimeProfile !== undefined && requestedRuntimeProfile !== "public-chain-v1" &&
    requestedRuntimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK &&
    requestedRuntimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN &&
    requestedRuntimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY)
  throw new TypeError("RIFTBOUND_DUEL_RUNTIME_PROFILE 必须是 public-chain-v1、optional-unit-choice-clock-v4、optional-unit-physical-chain-v4 或 optional-unit-resolved-history-v5");
if (duelRoomProfile !== "p4" && requestedRuntimeProfile !== undefined)
  throw new TypeError("RIFTBOUND_DUEL_RUNTIME_PROFILE 仅适用于 p4 房间");
const duelRuntimeProfile = duelRoomProfile === "p4" && requestedRuntimeProfile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY
  ? DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY
  : duelRoomProfile === "p4" && requestedRuntimeProfile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN
  ? DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN
  : duelRoomProfile === "p4" && requestedRuntimeProfile !== "public-chain-v1"
    ? DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK : undefined;
const server = createGameServer({ host, port, storageDirectory, duelRoomProfile,
  ...(duelRuntimeProfile ? { duelRuntimeProfile } : {}) });

server.httpServer.on("listening", () => {
  const address = server.httpServer.address();
  const listeningPort = address && typeof address === "object" ? address.port : port;
  console.log(`Riftbound game server`);
  console.log(`Health: http://${host}:${listeningPort}/health`);
  console.log(`Cards: http://${host}:${listeningPort}/api/cards`);
  console.log(`WebSocket: ws://${host}:${listeningPort}/ws`);
});

await server.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.stop().finally(() => process.exit(0));
  });
}
