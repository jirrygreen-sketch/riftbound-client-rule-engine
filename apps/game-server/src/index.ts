import { createGameServer } from "./server.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const storageDirectory = process.env.RIFTBOUND_STORAGE_DIRECTORY;

const server = createGameServer({ host, port, storageDirectory });

server.httpServer.on("listening", () => {
  console.log(`Riftbound game server`);
  console.log(`Health: http://${host}:${port}/health`);
  console.log(`Cards: http://${host}:${port}/api/cards`);
  console.log(`WebSocket: ws://${host}:${port}/ws`);
});

await server.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.stop().finally(() => process.exit(0));
  });
}
