import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/isolate.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { resolveLocationSelector } from "../../../../engine-core/dist/target/location/ref.js";
import { queryLocationCandidates } from "../../../../engine-core/dist/target/location/candidates.js";

const CANONICAL_ID =
  "card.hash-8d444ce0c06f1ce192099e9e5c3536c1206c31baf2024d38fce35cd459545efc";
const SOURCE_TEXT =
  "Move an enemy unit from a battlefield to its base. " +
  "Then, if there's an enemy unit alone at that battlefield, draw 1.";

const [play] = program.abilities;
const [moveInstruction, drawInstruction] = play.body;
const targetSpec = moveInstruction.targets[0];

const executableMove = (({ targets, ...rest }) => rest)(moveInstruction);

test("unl-124-219 Isolate: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-124-219 Isolate: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /740\.2\.a/);
  assert.match(program.judgeReason, /ObjectFilter|movements\.from/);
  assert.doesNotMatch(program.judgeReason, /RIFT-89|RIFT-90|RIFT-120/);
  // The reason must name the live gaps: the missing filter anchors and the
  // linked-location shape that does not read the move receipt's origin.
  assert.match(program.judgeReason, /sameLocationAs|exclude/);
  assert.match(program.judgeReason, /linked-location/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-124-219 Isolate: printed 2 energy, a battlefield-restricted enemy target and a linked draw", () => {
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["isolate.move-enemy-unit", "effect.move"],
      ["isolate.draw-if-alone", "effect.draw"]
    ]
  );

  // "Move an enemy unit from a battlefield": the unit is the target and "from a
  // battlefield" only restricts which units are legal (355.10.b).
  assert.deepEqual(targetSpec, {
    id: "isolate.enemy-unit-at-battlefield",
    filter: {
      type: "unit",
      controller: "opponent",
      zone: "board",
      location: "battlefield"
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "isolate.enemy-unit-at-battlefield" }
  });
  // "to its base" is the moved unit's own base (107.1 / 152.1), i.e. the merged
  // controller-base destination; this is a Move (421.1), not a Recall.
  assert.deepEqual(moveInstruction.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });

  // "Then, if there's an enemy unit alone at that battlefield, draw 1": the
  // draw truthfully references the move's battlefield ("that battlefield"), so
  // it is linked (359.3.e.14.a). The printed gate itself has no evaluator and is
  // deliberately not replaced with an always-true condition (see judgeReason).
  assert.equal(drawInstruction.op, "effect.draw");
  assert.equal(drawInstruction.linkedTo, "isolate.move-enemy-unit");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.condition, undefined);
});

test("unl-124-219 Isolate golden: the enemy unit is moved from its battlefield to its base", () => {
  const kernel = world()
    .unit("enemy", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "bf1" }
    })
    .unit("bystander", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "bf1" }
    })
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("enemy")]);

  const outcome = resolveChainBody([executableMove], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // 421.1: a successful Move changed the unit's location to its own base; the
  // bystander was not touched (it is not part of the selected object list).
  assert.deepEqual(kernel.getObject("enemy").location, { type: "base", player: "B" });
  assert.deepEqual(kernel.getObject("bystander").location, {
    type: "battlefield",
    id: "bf1"
  });
  assert.equal(kernel.getObject("enemy").zone, "board");
  assert.equal(outcome.results[0].result.linkedValues.moved.count, 1);
  assert.deepEqual(outcome.events.map((event) => event.action), ["move-location"]);
});

test("unl-124-219 Isolate golden: a stale target ignores the move and the linked draw (359.3.e.14.a)", () => {
  const kernel = world()
    .unit("enemy", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "bf1" }
    })
    .deck(["top"], { owner: "A" })
    .build();
  const stale = kernel.ref("enemy");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets(targetSpec.id, [stale]);

  // The draw keeps its printed linkedTo (359.3.e.14.a is exactly what this case
  // exercises); only the move's TargetSpecs are provisioned through the kernel.
  const outcome = resolveChainBody([executableMove, drawInstruction], kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  // 359.3.e.14.a: because the move is ignored, the linked draw is ignored too.
  assert.deepEqual(outcome.results[1].result, { status: "ignored", reason: "linked-ignored" });
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

test("unl-124-219 Isolate golden: the Draw 1 half runs through the merged primitive (414.1/414.3)", () => {
  const kernel = world().deck(["top", "second"], { owner: "A" }).build();

  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top"]);
});

test("unl-124-219 Isolate: the merged target filter has no candidate-relative alone counting", () => {
  // 740.2.a / 740.1.a: "alone" counts the candidate's own location and friendly
  // units. programs/filters.ts rejects both merged object-valued anchors, so a
  // card-declared filter cannot express either half of the predicate.
  for (const filter of [
    { type: "unit", zone: "board", controller: "opponent", sameLocationAs: "self" },
    { type: "unit", zone: "board", controller: "opponent", exclude: "self" }
  ]) {
    assert.throws(
      () => translateObjectFilter(filter),
      error => {
        assert.equal(error.name, "ProgramBindingError");
        assert.match(error.message, /Unsupported filter field (sameLocationAs|exclude)/);
        return true;
      }
    );
  }
  // The card keeps its printed gate absent rather than asserting an always-true
  // condition that would draw even when the battlefield is not cleared.
  assert.equal(drawInstruction.condition, undefined);
});

test("unl-124-219 Isolate: the move receipt records the real origin but linked-location cannot read it", () => {
  // effect.move links { count, objects, movements: [{ object, from, to }] }. The
  // linked-location selector reads only location/to/destination/there keys, so the
  // departure site is present in the receipt but unreachable from a condition.
  const kernel = world()
    .unit("enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf1" } })
    .player("B")
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("enemy")]);
  const outcome = resolveChainBody([executableMove], kernel);
  const receipt = outcome.linkedValues["isolate.move-enemy-unit.moved"];
  assert.deepEqual(receipt.movements, [
    {
      object: { id: "enemy", zoneEntryId: 1 },
      from: { type: "battlefield", id: "bf1" },
      to: { type: "base", player: "B" }
    }
  ]);

  assert.throws(
    () => resolveLocationSelector(
      { kind: "linked-location", instructionId: "isolate.move-enemy-unit", key: "moved" },
      {
        context: kernel,
        linked: (id, key) => outcome.linkedValues[key === undefined ? id : `${id}.${key}`]
      }
    ),
    /Linked value has no runtime location/
  );
});

test("unl-124-219 Isolate: target.location enumerates every battlefield seen by the context", () => {
  // 355.10.b / 449.2: the merged location machinery does enumerate the board's
  // battlefields, which is what a dynamic "that battlefield" filter would need to
  // compare against; the missing half is feeding the receipt's origin into it.
  const kernel = world()
    .unit("enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf1" } })
    .unit("other", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf2" } })
    .build();
  const candidates = queryLocationCandidates(kernel, { type: "battlefield" });
  assert.deepEqual(candidates, [
    { type: "battlefield", id: "bf1" },
    { type: "battlefield", id: "bf2" }
  ]);
});
