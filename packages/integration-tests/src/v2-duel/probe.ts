import { runV2Duel } from "./runner.js";

const seed = process.argv[2] ?? "RIFT-955-v2-08";
const creator = process.argv[3] === "first" ? "first" : "second";
const result = await runV2Duel({
  seed,
  port: Number(process.env.SWARM_PORT_BASE ?? "31800"),
  creator,
  maxActions: 500,
  actionTimeoutMs: 45_000,
  acknowledgementTimeoutMs: 60_000,
  totalTimeoutMs: 900_000,
  outputDirectory: `/tmp/${process.env.SWARM_TASK ?? "RIFT-955-v2-two-client-duel"}/probe`
});

console.log(JSON.stringify({
  termination: result.termination,
  blockedReason: result.blockedReason,
  score: result.score,
  turns: result.turnCount,
  elapsedMs: result.elapsedMs,
  trace: result.trace,
  coverage: result.coverage
}, null, 2));
