import { describe, expect, test } from "vitest";
import { projectFor } from "../../../../../packages/engine-core/src/projection/v2/index.js";
import { projectOptionalUnitChoiceP6 } from "../../../src/duel/optional-unit-choice-projection-p6.js";
import { legacyFlow, routes } from "./legacy-flow.js";
import { optionalUnits } from "./scenarios.js";

/** Partial parity of the pure projector; this does not execute a new CardProgram. */
describe("optional Unit choice projection primitive parity", () => {
  test.each(optionalUnits)("$printingId: preserves owner options and non-owner secrecy", async unit => {
    const flow = await legacyFlow(unit, routes[0], "projection");
    const before = flow.views();
    const [pay, decline] = flow.prompt.options;
    if (!pay || !decline) throw new Error("Both actual optional cost options required");
    const issued = { choiceId: flow.choice.choiceId, payOptionId: pay.id, declineOptionId: decline.id };
    // Read-only shape translation of a REAL issued choice. It neither issues a
    // choice nor makes a new runtime executable. In particular no test callback
    // supplies a cost, entry fact, ready action or replacement effect.
    const input = {
      players: [{ id: "alice" }, { id: "bob" }],
      stateVersion: flow.playing().match.stateVersion,
      pendingChoices: [{ id: flow.choice.choiceId, chooser: "alice", type: "optional" as const,
        visibility: "chooser-only" as const, options: flow.prompt.options.map(option => option.id),
        min: flow.prompt.minSelections, max: flow.prompt.maxSelections }],
    };
    for (const viewer of ["alice", "bob", null]) {
      const legacy = flow.playing(viewer).match.frame.pendingChoice;
      expect(projectOptionalUnitChoiceP6({ prompt: issued, ownerPlayerId: "alice", viewerPlayerId: viewer,
        opaquePromptId: flow.prompt.promptId })).toEqual(legacy);
      const projected = projectFor(input, viewer);
      if (viewer === "alice") {
        expect(legacy).toEqual(flow.choice);
        expect(projected.choices).toHaveLength(1);
        expect(projected.choice).toMatchObject({ id: flow.choice.choiceId, chooser: "alice",
          options: flow.prompt.options.map(option => option.id), min: 1, max: 1 });
        expect(projected.choices[0]).toEqual(projected.choice);
      } else {
        expect(legacy).toEqual({ active: true });
        expect(projected.choices).toEqual([]);
        for (const privateToken of [flow.choice.choiceId, flow.prompt.promptId, pay.id, decline.id,
          flow.target.uid, unit.canonicalCardId]) expect(JSON.stringify(projected)).not.toContain(privateToken);
      }
    }
    // v2 has no public {active:true} wire wrapper. E01 remains TODO for that
    // wrapper and the genuine new-kernel play path; this only proves secrecy.
    expect(flow.views()).toEqual(before);
  // The legacyFlow trace has exceeded 30s under heavy shared-runner load;
  // give the runner clock headroom without touching any assertion.
  }, 120_000);
});
