import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import flurryOfBlades from "../../../dist/cards/ogn/flurry-of-blades.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

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
  assert.equal(
    flurryOfBlades.canonicalCardId,
    "card.hash-14e2d9254f7779335e58a4346dc54ef0c51478cb00d0785b533c821957b9b044"
  );
  assert.equal(
    flurryOfBlades.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Deal 1 to all units at battlefields."
  );
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
  // The intended set is recorded with the merged query descriptor shape.
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

test("Flurry of Blades golden: balanced damage dealing 1 to each unit in the set", () => {
  // The set is supplied directly (the DSL has no non-target set form for
  // effect.damage yet): the golden run proves the merged primitive deals the
  // printed 1 to every member of the set, once each, and leaves objects outside
  // the set untouched.
  const kernel = world()
    .unit("bf-ally", { owner: "A", might: 3, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("bf-enemy", { owner: "B", might: 3, location: { type: "battlefield", id: "battlefield-2" } })
    .base("base-unit", { owner: "B", might: 3 })
    .build();
  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: "flurry-of-blades.units-at-battlefields" },
    {
      world: kernel,
      targets: {
        "flurry-of-blades.units-at-battlefields": [
          kernel.ref("bf-ally"),
          kernel.ref("bf-enemy")
        ]
      }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 2);
  assert.equal(run.linked.dealtCount, 2);
  assert.equal(kernel.getObject("bf-ally").damage, 1);
  assert.equal(kernel.getObject("bf-enemy").damage, 1);
  assert.equal(kernel.getObject("base-unit").damage, 0);
  assert.deepEqual(run.events.map((event) => event.action), ["damage", "damage"]);
});

test("Flurry of Blades golden: an empty set negates the damage as impossible", () => {
  const kernel = world().base("base-unit", { owner: "B", might: 3 }).build();
  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: "flurry-of-blades.units-at-battlefields" },
    { world: kernel, targets: { "flurry-of-blades.units-at-battlefields": [] } }
  );
  // Contract 3.6 primitive rule 2: no still-legal objects -> ignored, so no
  // damage is dealt when no unit is at a battlefield.
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("base-unit").damage, 0);
});

