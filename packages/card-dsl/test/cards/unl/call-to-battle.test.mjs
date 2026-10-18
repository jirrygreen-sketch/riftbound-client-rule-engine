import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/call-to-battle.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { queryLocationCandidates } from "../../../../engine-core/dist/target/location/candidates.js";

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
  assert.match(program.judgeReason, /355\.4\.a/);
  assert.match(program.judgeReason, /target\.player/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(90|91|120|257)/);
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
  // "to a battlefield you control": the resolution-time location choice
  // (355.4 / 355.4.a) is declared by the instruction's own LocationTargetSpec
  // and read back through the merged Expr.kind "location" bridge; the 355.4.a
  // current-location exclusion is still missing (see judgeReason).
  assert.deepEqual(moveOwn.locations, [
    {
      id: "call-to-battle.destination",
      type: "battlefield",
      controller: "controller",
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.deepEqual(moveOwn.args.to, {
    kind: "location",
    value: { kind: "target-location", target: "call-to-battle.destination" }
  });
  assert.equal(moveOwn.linkedTo, undefined);

  // "Then, choose an opponent": 355.7 / 355.9.a lists players as choosable;
  // the merged IR has no player-target form (see judgeReason).
  assert.equal(chooseOpponent.op, "target.player");
  assert.deepEqual(chooseOpponent.args.filter, {
    kind: "constant",
    value: { player: "opponent" }
  });

  // "They move a unit they control to the same battlefield": the second move
  // reuses the first instruction's LocationTargetSpec binding (359.3.f.3). Its
  // unit selection belongs to the chosen opponent, which still needs the
  // unmerged target.player (see judgeReason).
  assert.equal(moveOpponent.linkedTo, "call-to-battle.choose-opponent");
  assert.deepEqual(moveOpponent.args.objects, {
    kind: "constant",
    value: { pick: "call-to-battle.opponent-unit" }
  });
  assert.equal(moveOpponent.locations, undefined);
  assert.deepEqual(moveOpponent.args.to, {
    kind: "location",
    value: { kind: "target-location", target: "call-to-battle.destination" }
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

test("unl-101-219 Call to Battle golden: the merged destination choice resolves through a real candidate list", () => {
  // 355.4 / 355.4.a: the card's own LocationTargetSpec feeds the merged
  // location-choice path (queryLocationCandidates + ctx.choose), so the golden
  // executes the card's real instruction with the production candidate list for
  // a battlefield that currently holds a unit of the controller.
  const kernel = world()
    .unit("friendly", { owner: "A", location: { type: "base", player: "A" } })
    .unit("anchor", { owner: "A", location: { type: "battlefield", id: "bf-2" } })
    .object("bf-2", { owner: "A", controller: "A", types: ["battlefield"], zone: "board", location: null })
    .build();
  const context = kernel.clone({ source: kernel.ref("friendly"), sourceSnapshot: kernel.getObject("friendly") });
  context.setTargets(friendlySpec.id, [kernel.ref("friendly")]);
  context.setAnswers({
    "call-to-battle.move-own-unit/location%3Acall-to-battle.destination": { type: "battlefield", id: "bf-2" }
  });

  // The reference kernel compares filter values literally, so the Finalize-locked
  // target set is supplied by the caller (the pit-rookie convention); the card's
  // own TargetSpec is asserted structurally above.
  const { targets: _targets, ...lockedMove } = moveOwn;
  const outcome = resolveChainBody([lockedMove], context);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["call-to-battle.move-own-unit", "executed"]
  ]);
  assert.deepEqual(context.getObject("friendly").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(context.events.map(event => event.action), ["move-location"]);
});

test("unl-101-219 Call to Battle golden: both Moves reuse the one battlefield binding (359.3.f.3)", () => {
  // 355.4: the destination is chosen once; 359.3.f.3: the opponent's unit moves
  // to that same battlefield. Both instructions declare the same spec id, and
  // the interpreter keeps the first binding in scope, so the second move reads
  // the already-chosen LocationRef instead of asking twice.
  const kernel = world()
    .unit("friendly", { owner: "A", controller: "A", location: { type: "base", player: "A" } })
    .unit("their-unit", { owner: "B", controller: "B", location: { type: "base", player: "B" } })
    .unit("anchor", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-2" } })
    .object("bf-2", { owner: "A", controller: "A", types: ["battlefield"], zone: "board", location: null })
    .build();
  const context = kernel.clone({ source: kernel.ref("friendly"), sourceSnapshot: kernel.getObject("friendly") });
  context.setTargets(friendlySpec.id, [kernel.ref("friendly")]);
  context.setTargets("call-to-battle.opponent-unit", [kernel.ref("their-unit")]);
  context.setAnswers({
    "call-to-battle.move-own-unit/location%3Acall-to-battle.destination": { type: "battlefield", id: "bf-2" }
  });

  // The unmerged target.player instruction and the chooser-linked pick are not
  // part of this scenario: the opponent's unit is locked through the target set
  // and the card's own first move acts as the preceding instruction, the same
  // convention the merged goldens use for unmerged player choices.
  const secondMove = {
    ...moveOpponent,
    linkedTo: "call-to-battle.move-own-unit",
    args: {
      ...moveOpponent.args,
      objects: { kind: "constant", value: { target: "call-to-battle.opponent-unit" } }
    },
    picks: undefined
  };
  const { targets: _targets2, ...lockedMove } = moveOwn;
  const outcome = resolveChainBody([lockedMove, secondMove], context);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["call-to-battle.move-own-unit", "executed"],
    ["call-to-battle.opponent-moves-unit", "executed"]
  ]);
  assert.deepEqual(context.getObject("friendly").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(context.getObject("their-unit").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(context.events.map(event => event.action), ["move-location", "move-location"]);
});

test("unl-101-219 Call to Battle fail-closed: the location candidate surface still offers the unit's current location", () => {
  // 355.4.a: a valid destination is one other than the units' current location.
  // The merged candidate surface has no exclusion predicate, so the card must
  // not pretend its candidate list is 355.4.a-complete.
  const kernel = world()
    .unit("friendly", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .object("bf-1", { owner: "A", controller: "A", types: ["battlefield"], zone: "board", location: null })
    .build();
  assert.deepEqual(
    queryLocationCandidates(kernel, moveOwn.locations[0]).map(location => location.id),
    ["bf-1"],
    "the current location is still a candidate, so 355.4.a is not satisfied"
  );
});

test.todo(
  "unl-101-219 Call to Battle: exclude the moved unit's current location from a Move destination (CR 355.4.a) — " +
    "chooseLocations injects no LocationCandidateOptions.exclude and the location filter has no current-location predicate"
);

test.todo(
  "unl-101-219 Call to Battle: 'choose an opponent' needs a player target/choice form (CR 355.7/355.9.a) and the " +
    "chosen player must control the second move's selection and chooser — target.player is unregistered"
);
