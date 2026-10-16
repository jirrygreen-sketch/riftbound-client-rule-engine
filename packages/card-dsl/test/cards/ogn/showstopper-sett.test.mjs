import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import showstopper from "../../../dist/cards/ogn/showstopper-sett.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-b22bcf86e002f1a9a45cb4011a53cb3377c815e03ab16283a99130fec4987f95";
const BASE = player => ({ type: "base", player });
const BATTLEFIELD = id => ({ type: "battlefield", id });

const [play] = showstopper.abilities;
const [buffInstruction, moveInstruction] = play.body;
const buffSpec = buffInstruction.targets[0];

test("Showstopper program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(showstopper);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Showstopper identity, ruleset, status, printed text and judgeReason", () => {
  assert.equal(showstopper.canonicalCardId, CANONICAL);
  assert.equal(showstopper.rulesetVersion, "core-1.5");
  assert.equal(showstopper.status, "judge-required");
  assert.equal(
    showstopper.sourceText,
    "Buff a friendly unit in your base, then move it to a battlefield. " +
      "(If it doesn't have a buff, it gets a +1 :rb_might: buff.)"
  );
  // The judgeReason must name the two concrete gaps.
  assert.match(showstopper.judgeReason, /base/);
  assert.match(showstopper.judgeReason, /355\.4/);
  assert.match(showstopper.judgeReason, /effect\.move/);
  assert.equal(cardRegistryById.get(showstopper.canonicalCardId), showstopper);
});

test("Showstopper has no speed keyword on this printing", () => {
  assert.equal(showstopper.abilities.length, 1);
  assert.equal(
    showstopper.abilities.some(ability => ability.kind === "keyword"),
    false
  );
  assert.equal(play.cost, undefined);
});

test("Showstopper structure: Buff the base unit, then move that same locked unit", () => {
  assert.equal(play.body.length, 2);

  // "Buff a friendly unit in your base" — one targeted unit; 702.2.a places the
  // buff and the reminder text restates 702.3 / 427.1.c.
  assert.equal(buffInstruction.id, "buff-friendly-unit-in-base");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "friendly-unit-in-base" }
  });
  assert.deepEqual(buffSpec, {
    id: "friendly-unit-in-base",
    filter: { type: "unit", controller: "self", location: "base", locationPlayer: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(buffInstruction.linkedTo, undefined);

  // "then move it" — the same Finalize-locked unit, not a second choice; the
  // Move is linked so a lost unit ignores the follow-up too (contract 3.4).
  assert.equal(moveInstruction.id, "move-buffed-unit");
  assert.equal(moveInstruction.op, "effect.move");
  assert.equal(moveInstruction.linkedTo, "buff-friendly-unit-in-base");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "friendly-unit-in-base" }
  });
  assert.equal(moveInstruction.targets, undefined);
  // "to a battlefield" — the Destination is a Finalize-time runtime choice the
  // frozen IR can only mark (355.4.a), exactly as the merged Charm program does.
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: {
      kind: "choose",
      id: "showstopper.destination",
      options: ["runtime:legal-battlefield-destination"]
    }
  });
});

test("Showstopper: the two declared expressions really are missing today", () => {
  // Evidence for the judgeReason:
  // - the merged location predicate only knows the location TYPE, so the
  //   descriptive locationPlayer key is ignored and would admit a unit in an
  //   opponent's base if the key were dropped;
  // - effect.move rejects the placeholder Destination instead of guessing.
  const kernel = world()
    .unit("own-base", { owner: "A", location: BASE("A") })
    .unit("enemy-base", { owner: "A", location: BASE("B") })
    .build();
  // The reference kernel cannot resolve the production `controller: self` or
  // `location: base` predicates at all...
  assert.deepEqual(kernel.query({ type: "unit", controller: "self", location: "base" }), []);
  // ...while the production matcher accepts BOTH bases for the type-only
  // spelling, which is why the descriptive locationPlayer key is carried.
  const ownBase = kernel.getObject("own-base");
  const enemyBase = kernel.getObject("enemy-base");
  assert.equal(matchesObjectFilter({ type: "unit", location: "base" }, ownBase), true);
  assert.equal(matchesObjectFilter({ type: "unit", location: "base" }, enemyBase), true);
  // An exact LocationRef WOULD distinguish them, but needs the controller id —
  // which no merged predicate supplies for a card-relative "your base".
  assert.deepEqual(kernel.query({ type: "unit", location: BASE("A") }).map(object => object.ref.id), ["own-base"]);
  assert.deepEqual(kernel.query({ type: "unit", location: BASE("B") }).map(object => object.ref.id), ["enemy-base"]);
  assert.equal(instructionDefinitionsById.has("effect.move"), true);

  const moveKernel = world().unit("own-base", { owner: "A", location: BASE("A") }).build();
  assert.throws(
    () =>
      runInstruction(move, moveInstruction.args, {
        world: moveKernel,
        targets: { "friendly-unit-in-base": [moveKernel.ref("own-base")] }
      }),
    /effect\.move to must be a location, controller-base, or location choice/
  );
  assert.deepEqual(moveKernel.getObject("own-base").location, BASE("A"));
});

test("Showstopper golden: the Buff half places a buff on the base unit (702.2.a)", () => {
  const kernel = world().unit("unit", { owner: "A", location: BASE("A") }).build();
  const run = runInstruction(
    buff,
    { mode: "buff", target: "friendly-unit-in-base" },
    { world: kernel, targets: { "friendly-unit-in-base": [kernel.ref("unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("unit").buffs, 1);
  assert.equal(run.linked.buffedCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["buff"]);
  // A Buff is a counter, not a Might change: the printed +1 Might comes from
  // layers (703), which this primitive deliberately does not perform.
  assert.equal(kernel.getObject("unit").might, 1);
});

test("Showstopper golden: a unit that already has a buff is not buffed again (702.3 / 427.1.c)", () => {
  const kernel = world().unit("unit", { owner: "A", location: BASE("A"), buffs: 1 }).build();
  const run = runInstruction(
    buff,
    { mode: "buff", target: "friendly-unit-in-base" },
    { world: kernel, targets: { "friendly-unit-in-base": [kernel.ref("unit")] } }
  );

  // Reading such a unit stays legal; nothing is placed and the imperative
  // reports the no-op as negated/skipped (merged effect.buff behaviour).
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.getObject("unit").buffs, 1);
});

test("Showstopper golden: the Buff half runs from the program body through the interpreter", () => {
  const kernel = world().unit("unit", { owner: "A", location: BASE("A") }).build();
  kernel.setTargets("friendly-unit-in-base", [kernel.ref("unit")]);
  const { targets, ...lockedBuff } = buffInstruction;

  const outcome = runAbilityBody([lockedBuff], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("unit").buffs, 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["buff"]);
});

test("Showstopper golden: the Move half sends the same unit to a battlefield", () => {
  // The production caller owns the runtime Destination (355.4.a); this pins the
  // primitive half with a real battlefield and the unit the Buff half chose.
  const kernel = world().unit("unit", { owner: "A", exhausted: true, location: BASE("A") }).build();
  const run = runInstruction(
    move,
    {
      objects: moveInstruction.args.objects,
      to: { kind: "constant", value: BATTLEFIELD("bf1") }
    },
    {
      world: kernel,
      targets: { "friendly-unit-in-base": [kernel.ref("unit")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("unit").location, BATTLEFIELD("bf1"));
  assert.equal(run.linked.moved.count, 1);
  // An effect Move is not the Standard Move ability: no exhaust, no cost (144).
  assert.equal(kernel.getObject("unit").exhausted, true);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test.todo(
  "Showstopper base restriction: express \"a friendly unit in YOUR base\" so the controller-relative base " +
    "can be matched exactly — the merged location predicate only knows the location type and would also " +
    "admit a friendly unit sitting in an opponent base (355.9.b; needs a controller-relative location form " +
    "in the target system, RIFT-90)"
);

test.todo(
  "Showstopper Move Destination: enumerate the runtime-legal battlefield Destinations at Finalize and " +
    "offer the choice to the controller (355.4 / 355.4.a / 449.2 / 451.1), then resolve the Move " +
    "consequences (Contested 452, Move-triggered Showdown/Combat 453-454, Cleanup 455)"
);

