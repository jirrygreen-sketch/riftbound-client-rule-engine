import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/the-harrowing.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-b1f0d3c36b0411806913cc29b12f067b24cd42286481ac3676aa35aa75b6943c";
const [ability] = program.abilities;
const [playUnit] = ability.body;
const unitSpec = playUnit.targets[0];

test("The Harrowing program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("The Harrowing identity and judge-required status match the printing", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("356.1.b.2"), true);
  assert.match(program.judgeReason, /CostPlanInput/);
  assert.equal(program.judgeReason.includes("ignore-base"), true);
  assert.match(program.judgeReason, /chain handoff/);
  assert.equal(
    program.sourceText,
    "Play a unit from your trash, ignoring its Energy cost. (You must still pay its Power cost.)"
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("The Harrowing structure: printed cost plus a play from trash with a cost.modify descriptor", () => {
  // No printed speed keyword: spells default to Action timing (159.2.a).
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "play");
  assert.deepEqual(ability.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 6 },
    power: { kind: "constant", value: 2 }
  });

  assert.equal(playUnit.op, "effect.play");
  assert.equal(playUnit.linkedTo, undefined);
  assert.deepEqual(playUnit.args.target, { kind: "constant", value: "the-harrowing.unit" });
  // 356.1.b.2's "ignore its Energy cost" is recorded as a base-cost rewrite:
  // only the Energy component is set to zero, the Power cost still applies.
  assert.deepEqual(playUnit.args.cost, {
    kind: "constant",
    value: { kind: "cost.modify", ignore: "energy" }
  });

  // 355.10.a / 355.10.a.1: a Trash is a Public zone, so the unit card in it is
  // a target; 056.1 keeps it in its owner's zone.
  assert.deepEqual(unitSpec, {
    id: "the-harrowing.unit",
    filter: { types: "unit", zone: "trash", owner: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("The Harrowing golden: the unfinalized cost modifier is refused, not silently waived", () => {
  // effect.play only consumes an already-finalized cost plan (420.3.b.1) and
  // documents that it never derives printed costs or implements an ignored-cost
  // rule, so the descriptor above cannot be mistaken for a paid plan.
  const kernel = world()
    .card("trashed-unit", {
      owner: "A",
      controller: "A",
      types: ["unit"],
      zone: "trash"
    })
    .build();
  const run = runInstruction(
    play,
    { target: unitSpec.id, cost: playUnit.args.cost },
    { world: kernel, targets: { [unitSpec.id]: [kernel.ref("trashed-unit")] } }
  );

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.getObject("trashed-unit").zone, "trash");
  assert.equal(kernel.events.length, 0);
});

test("The Harrowing golden: a caller-finalized plan (Energy 0, Power still owed) plays the unit", () => {
  // This is the shape the cost plan must hand over once the cost pipeline derives the
  // ignore-Energy rewrite: the card data itself never writes this plan.
  const kernel = world()
    .card("trashed-unit", {
      owner: "A",
      controller: "A",
      types: ["unit"],
      might: 3,
      zone: "trash"
    })
    .build();
  const run = runInstruction(
    play,
    {
      target: unitSpec.id,
      cost: { kind: "constant", value: { finalized: true, energy: 0, power: ["Chaos"], xp: 0 } }
    },
    { world: kernel, targets: { [unitSpec.id]: [kernel.ref("trashed-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("trashed-unit").zone, "board");
  assert.deepEqual(kernel.events.map(event => event.action), ["pay", "play"]);
  assert.deepEqual(run.linked.played, 1);
});

test("The Harrowing golden: a unit that left the trash before resolution is ignored", () => {
  const kernel = world()
    .card("trashed-unit", {
      owner: "A",
      controller: "A",
      types: ["unit"],
      zone: "trash"
    })
    .build();
  const stale = kernel.ref("trashed-unit");
  kernel.perform({ type: "move-zone", object: stale, to: "banishment" });
  const run = runInstruction(
    play,
    { target: unitSpec.id, cost: { kind: "constant", value: { finalized: true, energy: 0, power: ["Chaos"], xp: 0 } } },
    { world: kernel, targets: { [unitSpec.id]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("trashed-unit").zone, "banishment");
  // A resolution-time recheck (359.3.e.5-e.7) leaves the instruction ignored
  // and performs no action of its own.
  assert.deepEqual(run.events, []);
});

test.todo(
  "The Harrowing: a merged consumer must read this card's cost.modify descriptor and have " +
    "Finalize build the ignore-base plan (356.1.b.2: base Energy set to 0, Power still owed; " +
    "356.1.b.3 keeps later additional costs) for the effect.play handoff, including reading the " +
    "selected trash card's printed cost."
);

test.todo(
  "The Harrowing: 420.3's Limited-Action Play procedure (limited-action admission, chain handoff " +
    "and the nested card's own resolution) is owned by chain/ and the cost plan."
);
