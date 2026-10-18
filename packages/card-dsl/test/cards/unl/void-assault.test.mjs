import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/void-assault.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { queryLocationCandidates } from "../../../../engine-core/dist/target/location/candidates.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-0dde19360e49952c6ec4a5b094d28bc2fde4ec115f51db8aa98e331b73edae1e";
const SOURCE_TEXT =
  "Move a friendly unit, then move an enemy unit. " +
  "(If they both move to a battlefield you don't control, you're the attacker.)";

const [play] = program.abilities;
const [moveFriendly, moveEnemy] = play.body;

test("unl-202-219 Void Assault: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-202-219 Void Assault: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The destination is a Finalize-time Location choice with no merged runtime
  // candidate predicate yet (355.4.a): the current location is not excluded and
  // the "allowed to be present" limit (451.2) has no consumer.
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /355\.4\.a/);
  assert.match(program.judgeReason, /451\.2/);
  assert.match(program.judgeReason, /LocationTargetSpec/);
  assert.match(program.judgeReason, /LocationCandidateOptions\.exclude/);
  // The reminder is the combat procedure, not a third instruction.
  assert.match(program.judgeReason, /466\.2\.c\.1/);
});

test("unl-202-219 Void Assault: two independent effect.move instructions, friendly then enemy", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  // No printed [Action]/[Reaction] line: spells default to Action timing
  // (159.2.a), so no speed keyword is declared.
  assert.equal(program.abilities.some((ability) => ability.kind === "keyword"), false);
  assert.deepEqual(
    play.body.map((instruction) => instruction.id),
    ["void-assault.move-friendly-unit", "void-assault.move-enemy-unit"]
  );

  // "then" only orders the two Moves (055 / 359.3.e.11): no instruction
  // references the other's result, so neither is linked (README section 4).
  assert.equal(moveFriendly.linkedTo, undefined);
  assert.equal(moveEnemy.linkedTo, undefined);
  for (const instruction of [moveFriendly, moveEnemy]) {
    assert.equal(instruction.op, "effect.move");
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  }
  // The printed destination is absent, so each Move chooses its own destination
  // through the merged runtime location surface (355.4 / 355.4.a): a
  // LocationTargetSpec supplies the candidate set and target-location reads the
  // binding; the IR never pins a battlefield.
  assert.deepEqual(moveFriendly.args.to, {
    kind: "location",
    value: { kind: "target-location", target: "void-assault.destination-1" }
  });
  assert.deepEqual(moveFriendly.locations, [
    { id: "void-assault.destination-1", type: "any", min: 1, max: 1, selection: "one" }
  ]);
  assert.deepEqual(moveEnemy.args.to, {
    kind: "location",
    value: { kind: "target-location", target: "void-assault.destination-2" }
  });
  assert.deepEqual(moveEnemy.locations, [
    { id: "void-assault.destination-2", type: "any", min: 1, max: 1, selection: "one" }
  ]);
  // Two separate destination specs: the second Move is not bound to the first's
  // battlefield (355.4 asks for a destination per Move).
  assert.notEqual(moveFriendly.locations[0].id, moveEnemy.locations[0].id);

  // 355.7 / 355.9.a.1 / 355.10: each moved unit is a target with its own
  // controller restriction.
  assert.deepEqual(moveFriendly.targets, [
    {
      id: "void-assault.friendly-unit",
      filter: { type: "unit", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.deepEqual(moveEnemy.targets, [
    {
      id: "void-assault.enemy-unit",
      filter: { type: "unit", controller: "opponent" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("unl-202-219 Void Assault golden: both Moves really relocate their units", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const friendly = runInstruction(
    move,
    {
      objects: moveFriendly.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } },
      amount: moveFriendly.args.amount
    },
    { world: kernel, targets: { "void-assault.friendly-unit": [kernel.ref("friendly")] } }
  );
  assert.equal(friendly.result.status, "executed");
  assert.deepEqual(kernel.getObject("friendly").location, { type: "battlefield", id: "bf-2" });

  const enemy = runInstruction(
    move,
    {
      objects: moveEnemy.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } },
      amount: moveEnemy.args.amount
    },
    { world: kernel, targets: { "void-assault.enemy-unit": [kernel.ref("enemy")] } }
  );
  assert.equal(enemy.result.status, "executed");
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "bf-2" });

  // Both units ended up at the same battlefield; the attacker designation the
  // reminder describes is the combat procedure's outcome (466.2.c.1-c.3), not
  // something the card sets.
  assert.deepEqual(kernel.getObject("friendly").location, kernel.getObject("enemy").location);
  assert.deepEqual(
    [...friendly.events, ...enemy.events].map((event) => event.action),
    ["move-location", "move-location"]
  );
  // Neither Move changed ownership.
  assert.equal(kernel.getObject("friendly").owner, "A");
  assert.equal(kernel.getObject("enemy").owner, "B");
});

test("unl-202-219 Void Assault golden: a Move to the unit's current location moves nothing", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    move,
    {
      objects: moveEnemy.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-1" } },
      amount: moveEnemy.args.amount
    },
    { world: kernel, targets: { "void-assault.enemy-unit": [kernel.ref("enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.moved.count, 0);
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(run.events, []);
});

test("unl-202-219 Void Assault golden: a stale enemy reference is mistargeted instead of moved", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 2 }).build();
  const stale = kernel.ref("enemy");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const run = runInstruction(
    move,
    {
      objects: moveEnemy.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } },
      amount: moveEnemy.args.amount
    },
    { world: kernel, targets: { "void-assault.enemy-unit": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.deepEqual(run.events, []);
});

test("unl-202-219 Void Assault golden: each printed Move picks its own destination from the runtime location surface", () => {
  // 355.4 / 355.4.a: the printed destination is absent, so each Move chooses at
  // resolution. The card's own LocationTargetSpec feeds the merged
  // chooseLocations path and target-location reads that binding; both moves are
  // executed by the real interpreter, not by a hand-written relocation.
  const kernel = world()
    .unit("friendly", { owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("anchor-a", { owner: "A", location: { type: "battlefield", id: "bf-2" } })
    .unit("anchor-b", { owner: "B", location: { type: "battlefield", id: "bf-3" } })
    .build();
  const context = kernel.clone({
    sourceSnapshot: kernel.getObject("friendly"),
    controller: "A"
  });
  context.setTargets("void-assault.friendly-unit", [kernel.ref("friendly")]);
  context.setTargets("void-assault.enemy-unit", [kernel.ref("enemy")]);
  // The interpreter prefixes each instruction's location choice with its id.
  context.setAnswers({
    "void-assault.move-friendly-unit/location%3Avoid-assault.destination-1": {
      type: "battlefield",
      id: "bf-2"
    },
    "void-assault.move-enemy-unit/location%3Avoid-assault.destination-2": {
      type: "battlefield",
      id: "bf-3"
    }
  });

  const { targets: _friendlyTargets, ...friendlyMove } = moveFriendly;
  const { targets: _enemyTargets, ...enemyMove } = moveEnemy;
  const outcome = resolveChainBody([friendlyMove, enemyMove], context);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["void-assault.move-friendly-unit", "executed"],
    ["void-assault.move-enemy-unit", "executed"]
  ]);
  assert.deepEqual(context.getObject("friendly").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(context.getObject("enemy").location, { type: "battlefield", id: "bf-3" });
  assert.deepEqual(context.events.map(event => event.action), ["move-location", "move-location"]);
});

test("unl-202-219 Void Assault gap: the destination candidates still offer the moved unit's current location (355.4.a)", () => {
  // 355.4.a requires a Location other than the Units' current Location. The
  // merged candidate query does not exclude it, and the interpreter accepts
  // that answer: the move is executed as a zero-length move instead of being
  // rejected. Pinned so the reason's first gap cannot silently disappear.
  const kernel = world()
    .unit("friendly", { owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const context = kernel.clone({
    sourceSnapshot: kernel.getObject("friendly"),
    controller: "A"
  });
  context.setTargets("void-assault.friendly-unit", [kernel.ref("friendly")]);
  context.setAnswers({
    "void-assault.move-friendly-unit/location%3Avoid-assault.destination-1": {
      type: "battlefield",
      id: "bf-1"
    }
  });
  const { targets: _targets, ...lockedMove } = moveFriendly;
  const outcome = resolveChainBody([lockedMove], context);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["void-assault.move-friendly-unit", "executed"]
  ]);
  assert.deepEqual(context.getObject("friendly").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(context.events, []);
});

test("unl-202-219 Void Assault gap: the destination candidates ignore 355.4.a's presence limit (451.2)", () => {
  // CR 451.2: a Unit cannot Move to a Battlefield that already has units from two
  // other players. The merged candidate query the card's LocationTargetSpec feeds
  // has no such predicate, so that battlefield is offered as a legal destination.
  const kernel = world()
    .player("C", { energy: 0 })
    .unit("mover", { owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("their-unit", { owner: "B", location: { type: "battlefield", id: "bf-2" } })
    .unit("third-unit", { owner: "C", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const context = kernel.clone({
    sourceSnapshot: kernel.getObject("mover"),
    controller: "A"
  });
  const candidates = queryLocationCandidates(context, { type: "battlefield" }, {
    players: ["A", "B", "C"],
    opponent: "B"
  });

  assert.deepEqual(candidates, [
    { type: "battlefield", id: "bf-1" },
    { type: "battlefield", id: "bf-2" }
  ]);
  // The current location is offered too, which is the other half of the gap.
  assert.deepEqual(queryLocationCandidates(context, { type: "any" }, { players: ["A", "B", "C"], opponent: "B" })[0],
    { type: "battlefield", id: "bf-1" });
});

test.todo(
  "unl-202-219 Void Assault: exclude the moved unit's current location from each destination's candidate set (CR 355.4.a; chooseLocations does not inject LocationCandidateOptions.exclude, so the current battlefield is offered and accepted)"
);
test.todo(
  "unl-202-219 Void Assault: enforce 355.4.a's 'allowed to be present' limit for the chosen destination, including 451.2 (a Battlefield already holding units from two other players) — effect.move performs the move regardless"
);
test.todo(
  "unl-202-219 Void Assault: emit the Contested/attacker-defender designations and the ensuing Showdown or Combat for the moves (CR 452-455, 466.2.c.1-c.3; the reminder is the combat procedure, not a card instruction - engine turn/combat batches)"
);
