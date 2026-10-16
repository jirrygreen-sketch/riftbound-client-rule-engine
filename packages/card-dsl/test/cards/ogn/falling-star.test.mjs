import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/ogn/falling-star.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so the golden test loads the built engine through its workspace
// layout. resolveChainBody is the production entry point the chain engine uses
// to resolve a card body (engine-core/src/chain/engine.ts); it keeps primitive
// arguments as authored IR and lets each registered primitive evaluate them,
// which is the real resolution path for links, conditions and ordering.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));

const play = program.abilities[0];
const first = play.body[0];
const second = play.body[1];

test("Falling Star program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Falling Star identity and status match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-46a8cadb412c53c300d401fa5cb701e3ff79acdc14f7759a2d78bd292379b77f"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "Deal 3 to a unit.\nDeal 3 to a unit.");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Falling Star structure: two independent 3-damage instructions over two targets", () => {
  // No [Action]/[Reaction] keyword is printed: a spell is playable in its
  // controller's Open State by default (CR 155), so the program declares no
  // speed keyword.
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["falling-star.deal-3-first", "effect.damage"],
      ["falling-star.deal-3-second", "effect.damage"]
    ]
  );

  for (const [instruction, targetId] of [
    [first, "falling-star.first-unit"],
    [second, "falling-star.second-unit"]
  ]) {
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 3 });
    assert.deepEqual(instruction.args.target, { kind: "constant", value: targetId });
    assert.equal(instruction.targets.length, 1);
    assert.equal(instruction.targets[0].id, targetId);
    assert.deepEqual(instruction.targets[0].filter, { type: "unit", zone: "board" });
    assert.equal(instruction.targets[0].location, undefined);
    assert.equal(instruction.targets[0].min, 1);
    assert.equal(instruction.targets[0].max, 1);
    assert.equal(instruction.targets[0].selection, "one");
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.picks, undefined);
  }
});

test("Falling Star golden execution: each sentence deals 3, and the same unit may take both", () => {
  const kernel = world().unit("shared-unit", { owner: "B", might: 8 }).build();
  kernel.setTargets("falling-star.first-unit", [kernel.ref("shared-unit")]);
  kernel.setTargets("falling-star.second-unit", [kernel.ref("shared-unit")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => result.result.status),
    ["executed", "executed"]
  );
  assert.equal(kernel.getObject("shared-unit").damage, 6);
  assert.deepEqual(
    outcome.events.filter(event => event.action === "damage").map(event => event.action),
    ["damage", "damage"]
  );
});

test("Falling Star golden execution: the two instructions may name two different units", () => {
  const kernel = world()
    .unit("first-unit", { owner: "A", might: 5 })
    .unit("second-unit", { owner: "B", might: 5, location: { type: "base", player: "B" } })
    .build();
  kernel.setTargets("falling-star.first-unit", [kernel.ref("first-unit")]);
  kernel.setTargets("falling-star.second-unit", [kernel.ref("second-unit")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("first-unit").damage, 3);
  // "a unit" is unrestricted by location (355.9.a.1), so a Base unit is legal.
  assert.equal(kernel.getObject("second-unit").damage, 3);
});

test("Falling Star golden execution: an ignored first instruction does not suppress the second", () => {
  // The two sentences are not linked (359.3.e.14: linked instructions reference
  // each other), so losing the first target leaves the second executable.
  const kernel = world()
    .unit("stays", { owner: "B", might: 5 })
    .unit("leaves", { owner: "B", might: 5 })
    .build();
  const stale = kernel.ref("leaves");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets("falling-star.first-unit", [stale]);
  kernel.setTargets("falling-star.second-unit", [kernel.ref("stays")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(kernel.getObject("stays").damage, 3);
});

test.todo(
  "Falling Star full chain play: paying 2 Energy + 2 Fury power, the default " +
    "Open-State timing admission, and the Finalize locking of both independent " +
    "targets belong to the cost plan (RIFT-89) and the target system (RIFT-90)."
);
