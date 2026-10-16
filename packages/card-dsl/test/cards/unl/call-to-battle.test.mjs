import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/call-to-battle.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-1d05a8db288bc071a9e9736106ed0815284bac8ec41b7795f5d4b43e4a75217c";
const SOURCE_TEXT =
  "Move a unit you control to a battlefield you control. Then, choose an opponent. " +
  "They move a unit they control to the same battlefield.";

const [play] = program.abilities;
const [moveOwn, chooseOpponent, moveOpponent] = play.body;
const [friendlySpec] = moveOwn.targets;

test("unl-101-219 Call to Battle: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-101-219 Call to Battle: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /355\.9\.a/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("unl-101-219 Call to Battle: own-unit move, opponent choice and the second move are kept as shapes", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["call-to-battle.move-own-unit", "effect.move"],
      ["call-to-battle.choose-opponent", "target.player"],
      ["call-to-battle.opponent-moves-unit", "effect.move"]
    ]
  );

  // "Move a unit you control": one chosen friendly target (355.5 / 355.7).
  assert.deepEqual(friendlySpec, {
    id: "call-to-battle.friendly-unit",
    filter: { zone: "board", type: "unit", controller: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // "to a battlefield you control": a Finalize-time location choice (355.4 /
  // 355.4.a); the options list is runtime-derived (see judgeReason).
  assert.deepEqual(moveOwn.args.to, {
    kind: "constant",
    value: {
      kind: "choose",
      id: "call-to-battle.destination",
      options: ["battlefields-you-control"]
    }
  });
  assert.equal(moveOwn.linkedTo, undefined);

  // "Then, choose an opponent": 355.7 / 355.9.a lists players as choosable;
  // the merged IR has no player-target form (see judgeReason).
  assert.equal(chooseOpponent.op, "target.player");
  assert.deepEqual(chooseOpponent.args.filter, {
    kind: "constant",
    value: { player: "opponent" }
  });

  // "They move a unit they control to the same battlefield": the second move's
  // selection belongs to the chosen opponent and its destination must be the
  // first move's destination; both bindings are missing (see judgeReason).
  assert.equal(moveOpponent.linkedTo, "call-to-battle.choose-opponent");
  assert.deepEqual(moveOpponent.args.objects, {
    kind: "constant",
    value: { pick: "call-to-battle.opponent-unit" }
  });
  assert.deepEqual(moveOpponent.picks, [
    {
      id: "call-to-battle.opponent-unit",
      options: ["dynamic:units-controlled-by-the-chosen-opponent"],
      filter: { zone: "board", type: "unit", controller: "opponent" },
      min: 1,
      max: 1,
      selection: "one",
      chooser: "call-to-battle.chosen-opponent"
    }
  ]);
});

test("unl-101-219 Call to Battle golden: the merged move primitive relocates the chosen friendly unit", () => {
  const kernel = world()
    .unit("friendly-unit", {
      owner: "A",
      controller: "A",
      location: { type: "base", player: "A" }
    })
    .build();
  const run = runInstruction(
    move,
    {
      objects: moveOwn.args.objects,
      // The reference kernel resolves concrete LocationRefs; the printed
      // "a battlefield you control" placeholder is supplied by the caller the
      // same way Ride the Wind supplies its chosen destination.
      to: { kind: "constant", value: { type: "battlefield", id: "bf-1" } }
    },
    { world: kernel, targets: { [friendlySpec.id]: [kernel.ref("friendly-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(run.linked.moved.movements[0].to, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(kernel.getObject("friendly-unit").location, {
    type: "battlefield",
    id: "bf-1"
  });
});

test("unl-101-219 Call to Battle golden: a stale chosen unit ignores the move (359.3.e.6)", () => {
  const kernel = world().unit("friendly-unit", { owner: "A" }).build();
  const stale = kernel.ref("friendly-unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const run = runInstruction(
    move,
    {
      objects: moveOwn.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-1" } }
    },
    { world: kernel, targets: { [friendlySpec.id]: [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test.todo(
  "unl-101-219 Call to Battle: 'to a battlefield you control' needs the runtime location-selection lifecycle " +
    "(CR 355.4/355.4.a, RIFT-90/RIFT-91) — effect.move only takes static LocationRefs or a static candidate list"
);

test.todo(
  "unl-101-219 Call to Battle: 'choose an opponent' needs a player target/choice form (CR 355.7/355.9.a) and the " +
    "chosen player must control the second move's selection and chooser — target.player is unmerged"
);

test.todo(
  "unl-101-219 Call to Battle: the second unit must move to the FIRST move's destination (CR 359.3.f.3 result binding) — " +
    "no location result selector exists"
);
