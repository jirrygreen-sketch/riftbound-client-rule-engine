// Execution evidence for the merged effect.damage / [Reaction] halves of
// Flurry of Blades lives in the RIFT-652 template suite:
//   ../templates/keyword-play-effect-damage-652.test.mjs
// The card stays judge-required: "all units at battlefields" is a programmatic
// set (355.10.d), not a target, and effect.damage only consumes a
// Finalize-locked TargetSpec. This file keeps validation, identity and the key
// structure only.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import flurryOfBlades from "../../../dist/cards/ogn/flurry-of-blades.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CANONICAL = "card.hash-14e2d9254f7779335e58a4346dc54ef0c51478cb00d0785b533c821957b9b044";

const [speed, play] = flurryOfBlades.abilities;
const [damageInstruction] = play.body;

test("Flurry of Blades program is structurally valid and judge-required", () => {
  const result = validateCardProgram(flurryOfBlades);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(flurryOfBlades.status, "judge-required");
  assert.match(flurryOfBlades.judgeReason, /355\.10\.d/);
  assert.match(flurryOfBlades.judgeReason, /effect\.damage/);
  assert.equal(flurryOfBlades.rulesetVersion, "core-1.5");
  assert.equal(flurryOfBlades.canonicalCardId, CANONICAL);
  assert.equal(
    flurryOfBlades.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Deal 1 to all units at battlefields."
  );
  assert.equal(cardRegistryById.get(CANONICAL), flurryOfBlades);
});

test("Flurry of Blades structure: [Reaction] keyword + one untargeted set damage", () => {
  assert.equal(flurryOfBlades.abilities.length, 2);
  // [Reaction] (813) is a speed keyword ability expanded by the keyword registry.
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(damageInstruction.op, "effect.damage");
  assert.deepEqual(damageInstruction.args.amount, { kind: "constant", value: 1 });
  // "all units at battlefields" is a programmatic set (355.10.d), so the
  // instruction declares NO TargetSpec: units chosen by criteria are not
  // targets and must not fire "becomes a target" triggers (355.7, 754).
  assert.equal(damageInstruction.targets, undefined);
  assert.equal(damageInstruction.picks, undefined);
  // The intended set is recorded with the merged query descriptor shape that
  // effect.ready / effect.heal consume; effect.damage has no such consumer,
  // which is the judgeReason gap.
  assert.deepEqual(damageInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: { type: "unit", zone: "board", location: "battlefield" }
    }
  });
});

test("Flurry of Blades: the recorded filter selects only units at battlefields", () => {
  const recorded = damageInstruction.args.objects.value.filter;
  const atBattlefield = {
    ref: { id: "bf-unit", zoneEntryId: 1 },
    controller: "B",
    owner: "B",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    types: ["unit"],
    tags: [],
    keywords: []
  };
  const atBase = { ...atBattlefield, ref: { id: "base-unit", zoneEntryId: 1 }, location: { type: "base", player: "B" } };
  assert.equal(matchesObjectFilter(recorded, atBattlefield), true);
  assert.equal(matchesObjectFilter(recorded, atBase), false);
});
