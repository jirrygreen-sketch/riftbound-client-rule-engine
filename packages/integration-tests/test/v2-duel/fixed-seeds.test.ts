import { mkdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runV2Duel } from "../../src/v2-duel/runner.js";
import { V2_DUEL_FIXED_SEEDS } from "../../src/v2-duel/types.js";

const outputDirectory = `/tmp/${process.env.SWARM_TASK ?? "RIFT-955-v2-two-client-duel"}/v2-duel`;
const portBase = Number(process.env.SWARM_PORT_BASE ?? "31800");
const portSpan = Number(process.env.SWARM_PORT_SPAN ?? "20");

describe("RIFT-955 V2 two-client duel", () => {
  for (const [index, seed] of V2_DUEL_FIXED_SEEDS.entries()) {
    it(`runs private protocol clients for ${seed}`, async () => {
      await mkdir(outputDirectory, { recursive: true });
      const creator = index % 2 === 0 ? "first" : "second";
      const result = await runV2Duel({ seed, port: portBase + (index % portSpan), outputDirectory,
        maxActions: 500, creator, actionTimeoutMs: 45_000,
        acknowledgementTimeoutMs: 60_000, totalTimeoutMs: 780_000 });
      expect(["player-1", "player-2"]).toContain(result.firstPlayerSeat);
      expect(result.firstPlayerSeat).toBe(creator === "first" ? "player-1" : "player-2");
      expect(result.privacy.violations).toEqual([]);
      expect(result.privacy.checkedProjections).toBeGreaterThan(0);
      // The fixed acceptance line requires a natural authoritative result.
      // A command timeout or no-op guard is evidence for the parent/owner, not
      // an acceptable terminal state for this gate.
      expect(result.termination, result.blockedReason ?? undefined).toBe("winner");
      expect(result.winnerPlayerId).not.toBeNull();
    }, 850_000);
  }
});
