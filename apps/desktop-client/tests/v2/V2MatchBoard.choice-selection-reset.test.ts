import { describe, expect, it } from "vitest";
import { v2BoardSceneKey } from "../../src/full-product/v2/V2MatchBoard";
import type { V2PendingChoice, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

// RIFT-1080: found in a real two-browser M1 run on macOS (integration
// cf76aa86). Ordering three simultaneous triggers raised order:0 then order:1
// at the same stateVersion. Local selections were reset only when the
// stateVersion changed, so order:0's selection leaked into order:1, the answer
// could not be built and "提交选择" silently did nothing.

function at(stateVersion: number, pendingChoice: V2PendingChoice): V2Projection {
  return { matchId: "match-v2", stateVersion, pendingChoice } as unknown as V2Projection;
}

const order = (n: number): V2PendingChoice => ({
  status: "pending", choiceId: `trigger:622:A:order:${n}`, ownerPlayerId: "player-1", stateVersion: 38, kind: "mode",
  options: [{ id: `opt-${n}`, label: `opt-${n}` }]
}) as V2PendingChoice;

describe("RIFT-1080 board selections reset per pending choice", () => {
  it("changes when a new choice is raised at the same stateVersion", () => {
    expect(v2BoardSceneKey(at(38, order(0)))).not.toBe(v2BoardSceneKey(at(38, order(1))));
  });

  it("still changes with the stateVersion and is stable otherwise", () => {
    expect(v2BoardSceneKey(at(38, order(1)))).toBe(v2BoardSceneKey(at(38, order(1))));
    expect(v2BoardSceneKey(at(38, { status: "none" }))).not.toBe(v2BoardSceneKey(at(39, { status: "none" })));
    expect(v2BoardSceneKey(null)).toBe("none");
  });
});
