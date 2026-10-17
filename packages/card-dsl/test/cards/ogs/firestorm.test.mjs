// Template scenarios: ../templates/play-effect-damage-659.test.mjs (set damage pending).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/firestorm.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL_ID = "card.hash-4f827e86263468c7ee54c70750f747df55cb193818954ea93bd73791d1bf837a";
const SOURCE_TEXT = "Deal 3 to all enemy units at a battlefield.";

const [play] = program.abilities;
const [storm] = play.body;
const battlefieldSpec = storm.targets[0];

test("ogs-002-024 Firestorm: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: the reason must name the missing primitive/form and the
  // rule basis, not merely say "unsupported".
  assert.match(program.judgeReason, /effect\.damage/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /RIFT-9/);
  assert.match(program.judgeReason, /parseArgs/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-002-024 Firestorm: the battlefield is the target, the units are a set", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // No [Action]/[Reaction] is printed: spells default to Action timing (159.2.a).
  assert.equal(play.body.length, 1);
  assert.equal(storm.id, "firestorm.deal-3-to-enemy-units");
  assert.equal(storm.op, "effect.damage");
  assert.deepEqual(storm.args.amount, { kind: "constant", value: 3 });
  // Exactly one TargetSpec: the battlefield (355.10.d's example). No TargetSpec
  // may stand in for the units, because they are never chosen (355.10.d.1).
  assert.equal(storm.targets.length, 1);
  assert.equal(battlefieldSpec.id, "firestorm.battlefield");
  assert.deepEqual(battlefieldSpec.filter, { type: "battlefield" });
  assert.equal(battlefieldSpec.min, 1);
  assert.equal(battlefieldSpec.max, 1);
  assert.equal(battlefieldSpec.selection, "one");
  assert.equal(storm.picks, undefined);
});

test("ogs-002-024 Firestorm: the damage set is recorded as the non-target query descriptor", () => {
  assert.deepEqual(storm.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        controller: "opponent",
        sameLocationAs: { target: "firestorm.battlefield" }
      }
    }
  });
  // The set is not a targeting selection: effect.damage currently consumes only
  // ctx.targets(specId), which is exactly the missing form named in judgeReason.
  assert.equal(storm.args.target, undefined);
});

test("ogs-002-024 Firestorm: the recorded set narrows to enemy units by controller and location", () => {
  // The descriptor is data for the pending non-target damage form, so it is
  // checked as a selector shape: the sameLocationAs anchor names the declared
  // battlefield target and the controller selector marks the opponent.
  const filter = storm.args.objects.value.filter;
  assert.equal(filter.type, "unit");
  assert.equal(filter.controller, "opponent");
  assert.deepEqual(filter.sameLocationAs, { target: "firestorm.battlefield" });
  assert.equal(filter.zone, undefined);

  // The battlefield identity is a first-class Board location, so a plain
  // type filter over the merged vocabulary selects it without extra keys.
  const battlefield = {
    ref: { id: "bf-1", zoneEntryId: 1 },
    cardId: "card:bf-1",
    name: "bf-1",
    types: ["battlefield"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: null,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  assert.equal(matchesObjectFilter({ type: "battlefield" }, battlefield), true);
  const unit = { ...battlefield, types: ["unit"], ref: { id: "u", zoneEntryId: 1 } };
  assert.equal(matchesObjectFilter({ type: "battlefield" }, unit), false);
});

test("ogs-002-024 Firestorm: the enemy-unit half is not approximated with a TargetSpec", () => {
  // A TargetSpec here would fire "become a target" for every enemy unit at the
  // battlefield (355.7 / 754); the recorded set stays a query descriptor until
  // the non-target damage form exists.
  assert.equal(storm.targets.some((spec) => spec.filter.type === "unit"), false);
  assert.equal(storm.targets.length, 1);
});

test("ogs-002-024 Firestorm golden: the merged effect.damage rejects this card's objects set verbatim", () => {
  // 复核 2026-10-17: RIFT-9's non-target damage set is still open. The card's
  // own args fail the merged primitive's schema before any action is planned.
  const kernel = world().unit("enemy-here", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } }).build();
  assert.throws(
    () => runInstruction(damage, storm.args, {
      world: kernel,
      targets: { "firestorm.battlefield": [kernel.ref("enemy-here")] }
    }),
    /effect\.damage args\.target must be a TargetSpec id string/
  );
  assert.equal(kernel.getObject("enemy-here").damage, 0);
});

test("ogs-002-024 Firestorm golden: driving the card's own body stops at the same missing set form", () => {
  // The battlefield half is routable today: the declared TargetSpec resolves
  // through the merged interpreter. Only the units set has no consumer, so the
  // instruction must not silently become a per-unit targeting effect.
  const kernel = world()
    .unit("bf", { owner: "A", controller: "A", types: ["battlefield"], location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" }, might: 9 })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" }, might: 9 })
    .build();
  kernel.setTargets("firestorm.battlefield", [kernel.ref("bf")]);
  assert.throws(
    () => resolveChainBody(play.body, kernel),
    /effect\.damage args\.target must be a TargetSpec id string/
  );
  assert.equal(kernel.getObject("enemy-here").damage, 0);
  assert.equal(kernel.getObject("enemy-elsewhere").damage, 0);
});

test.todo(
  "Firestorm full chain play: pay 6 energy + 1 Fury power and lock the battlefield at Finalize " +
    "— the printed cost is represented, but the card cannot resolve as printed until the non-target " +
    "damage set form lands"
);
