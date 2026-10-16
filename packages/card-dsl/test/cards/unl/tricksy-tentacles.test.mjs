import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/tricksy-tentacles.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-a7dc7d29f0a8ac49b8977b2261f476c440c7c3025285bd5e6a7250b52981b37d";
const SOURCE_TEXT =
  "Move any number of enemy units with the same controller and a total Might of 8 " +
  "or less to a single location.";

const [play] = program.abilities;
const [moveInstruction] = play.body;
const [groupTarget] = moveInstruction.targets;

test("unl-054-219 Tricksy Tentacles: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("unl-054-219 Tricksy Tentacles: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /355\.11/);
  assert.match(program.judgeReason, /total Might/i);
  assert.match(program.judgeReason, /355\.4/);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-054-219 Tricksy Tentacles: printed cost and one effect.move instruction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // Catalog printing: 4 energy + 1 Calm power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [["tricksy-tentacles.move-group", "effect.move"]]
  );
  assert.equal(moveInstruction.args.objects.kind, "constant");
  assert.deepEqual(moveInstruction.args.objects.value, {
    target: "tricksy-tentacles.enemy-unit-group"
  });
});

test("unl-054-219 Tricksy Tentacles: 'any number of enemy units' is a group target with a 0 minimum (355.11 / 355.13)", () => {
  assert.equal(groupTarget.id, "tricksy-tentacles.enemy-unit-group");
  // "any number" may be zero (355.13), so the group target's minimum is 0 and
  // it is selected as an "up-to" set; the group is a single target group
  // (355.11) rather than one target per unit.
  assert.equal(groupTarget.min, 0);
  assert.equal(groupTarget.max, null);
  assert.equal(groupTarget.selection, "up-to");
  assert.equal(groupTarget.filter.type, "unit");
  assert.equal(groupTarget.filter.controller, "opponent");
  assert.equal(groupTarget.filter.zone, "board");
});

test("unl-054-219 Tricksy Tentacles: both group-wide requirements stay recorded, and neither is approximated away", () => {
  // 355.11: "with the same controller" is a targeting requirement on the group
  // as a whole; 355.11.a/b make the "total Might of 8 or less" bound part of
  // group legality, including the resolution-time legal-subset reselection.
  // No merged filter evaluates either key, which is exactly why the card is
  // judge-required: dropping them would silently allow an over-Might or
  // mixed-controller group.
  assert.equal(groupTarget.filter.sameController, true);
  assert.equal(groupTarget.filter.totalMightAtMost, 8);
});

test("unl-054-219 Tricksy Tentacles: 'to a single location' is the runtime location choice, kept descriptive (355.4)", () => {
  // 355.4 / 355.4.a: one valid destination for the whole Move Effect, chosen at
  // Finalize. The merged IR has no runtime Location selector, so the card keeps
  // a descriptive marker (not a fabricated LocationRef) — effect.move rejects
  // it fail-closed, as the probe below shows.
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: { kind: "destination-selector", filter: { type: "location" } }
  });
});

test("unl-054-219 Tricksy Tentacles: the whole group moves with one amount read off the locked group", () => {
  // "any number of enemy units … to a single location": one Move Effect covers
  // the whole locked group, so the amount is the group's own size (count over
  // the locked TargetSpec selector) and every unit shares the one destination.
  assert.deepEqual(moveInstruction.args.amount, {
    kind: "count",
    subject: "unit",
    filter: { target: { target: "tricksy-tentacles.enemy-unit-group" } }
  });
  assert.equal(moveInstruction.args.amount.filter.target.target, groupTarget.id);
  assert.equal(moveInstruction.targets.length, 1);
});

test("unl-054-219 Tricksy Tentacles fail-closed: the descriptive destination is rejected, never turned into a move", () => {
  const kernel = world()
    .unit("enemy-one", { owner: "B", might: 3 })
    .unit("enemy-two", { owner: "B", might: 4 })
    .build();
  const before = kernel.snapshot();
  // effect.move's destination() accepts only a static LocationRef,
  // controller-base or a location choice; the marker throws instead of moving
  // the locked group to a location the card never printed.
  assert.throws(
    () => runInstruction(
      move,
      {
        objects: moveInstruction.args.objects,
        to: moveInstruction.args.to,
        amount: { kind: "constant", value: 2 }
      },
      {
        world: kernel,
        targets: {
          "tricksy-tentacles.enemy-unit-group": [kernel.ref("enemy-one"), kernel.ref("enemy-two")]
        }
      }
    ),
    /effect\.move to must be a location/
  );
  assert.deepEqual(kernel.snapshot(), before);
});

test("unl-054-219 Tricksy Tentacles fail-closed: no merged consumer enforces the group requirements", () => {
  // A live check that the recorded group bounds are data, not enforced rules: a
  // unit whose Might exceeds the printed total still satisfies the filter keys
  // the engine actually reads. This is the evidence for the judge-required
  // status — the group requirements cannot be silently mistaken for enforced.
  const kernel = world()
    .unit("huge-one", { owner: "B", controller: "B", might: 6 })
    .unit("huge-two", { owner: "B", controller: "B", might: 6 })
    .build();
  const plain = kernel.query({ type: "unit", zone: "board", controller: "B" });
  assert.deepEqual(plain.map((object) => object.ref.id), ["huge-one", "huge-two"]);
  // The descriptive group keys are not part of the filter vocabulary the engine
  // consumes: the same two 6-Might units (total 12, over the printed 8) still
  // satisfy the filter, so nothing rejects an over-Might group today.
  const withBounds = kernel.query({
    type: "unit",
    zone: "board",
    controller: "B",
    sameController: true,
    totalMightAtMost: 8
  });
  assert.deepEqual(withBounds.map((object) => object.ref.id), ["huge-one", "huge-two"]);
  const total = withBounds.reduce((sum, object) => sum + (object.might ?? 0), 0);
  assert.equal(total, 12);
});

test.todo(
  "unl-054-219 Tricksy Tentacles: the group targeting requirement — 'with the same controller' and " +
    "'a total Might of 8 or less' (CR 355.11 / 355.11.a / 355.11.b, including the resolution-time legal " +
    "subset) — needs group-level target constraints in the target system (RIFT-90); no merged filter " +
    "evaluates them"
);

test.todo(
  "unl-054-219 Tricksy Tentacles: 'to a single location' is the one runtime destination of the Move " +
    "Effect (CR 355.4 / 355.4.a / 451.1) and needs the runtime Location selector (RIFT-90 / RIFT-91); " +
    "today's program is rejected fail-closed rather than pinning a wrong location"
);
