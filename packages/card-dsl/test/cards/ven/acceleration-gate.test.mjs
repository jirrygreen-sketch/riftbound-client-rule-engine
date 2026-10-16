import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/acceleration-gate.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
// Card bodies run through the chain's own interpreter adapter — the production
// entry point that re-wraps Expr arguments for the registered primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-d573cd36f7b306449a231dfbdee312b3b2f66f62fa38f092efed53512ac63fc0";
const SOURCE_TEXT = "Ready up to 4 units, gear, and/or runes.";
const TARGET_ID = "acceleration-gate.chosen-objects";

const [play] = program.abilities;
const [readyUpToFour] = play.body;
const [targetSpec] = readyUpToFour.targets;

/**
 * The reference kernel's matchesFilter compares a scalar type/zone literally,
 * so it cannot evaluate the array-valued filter this card needs ("units, gear,
 * and/or runes" over Board + Rune Zone). The production matcher
 * (layers/filter.ts) implements that array semantics; the proxy below routes
 * the kernel's set queries through it so the card's own filter is what runs —
 * the same normalization-free approach the sibling goldens take.
 */
function productionFilter(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => target.query({}).filter((object) => matchesObjectFilter(filter, object));
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("ven-150-166 Acceleration Gate: program passes validateCardProgram as executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-150-166 Acceleration Gate: one action-timed play ability, no speed keyword and no printed cost", () => {
  // 159.2.a: the printing has no [Action]/[Reaction] line, so the spell keeps
  // default timing; the printed base cost is bound from the catalog at Finalize
  // (356.1.c), never written into the card data.
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.restriction, undefined);
  assert.equal(play.body.length, 1);

  assert.equal(readyUpToFour.id, "acceleration-gate.ready-up-to-four");
  assert.equal(readyUpToFour.op, "effect.ready");
  assert.equal(readyUpToFour.linkedTo, undefined);
  assert.equal(readyUpToFour.condition, undefined);
  assert.deepEqual(readyUpToFour.args, {
    objects: { kind: "constant", value: { kind: "target", id: TARGET_ID } },
    amount: { kind: "constant", value: 4 },
    linkKey: { kind: "constant", value: "readied" }
  });
  // The declared primitive really is the merged registry entry.
  assert.equal(instructionDefinitionsById.get("effect.ready"), ready);
});

test("ven-150-166 Acceleration Gate: 'up to 4' is one 0..4 target group over units, gear and runes", () => {
  // 355.12 / 355.13: "up to N" targets are chosen independently of the may to
  // act, and zero is a legal choice, so the group carries min 0 / max 4.
  assert.equal(readyUpToFour.targets.length, 1);
  assert.equal(targetSpec.id, TARGET_ID);
  assert.equal(targetSpec.min, 0);
  assert.equal(targetSpec.max, 4);
  assert.equal(targetSpec.selection, "up-to");
  assert.equal(readyUpToFour.picks, undefined);
  // 133.3.a + 107.1.c: units/gear are on the Board and runes sit in the Rune
  // Zone (this project's Base rune area). The zone filter cannot be dropped:
  // 141.2.b/148.2.b keep card type valid in every zone, so a type-only filter
  // would also match gear cards in a deck or trash. The text says nothing
  // about control, so no controller key is written.
  assert.deepEqual(targetSpec.filter, {
    type: ["unit", "gear", "rune"],
    zone: ["board", "rune-zone"]
  });
  assert.equal(targetSpec.filter.controller, undefined);
  assert.equal(targetSpec.filter.owner, undefined);
});

test("ven-150-166 Acceleration Gate: the production matcher selects exactly units/gear on the board and runes in the rune zone", () => {
  const kernel = productionFilter(
    world()
      .unit("battlefield-unit", { owner: "A", controller: "A" })
      .unit("base-unit", { owner: "A", controller: "A", location: { type: "base", player: "A" } })
      .object("board-gear", { owner: "A", controller: "A", types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
      .object("base-rune", { owner: "A", controller: "A", types: ["rune"], zone: "rune-zone", location: { type: "base", player: "A" } })
      .unit("enemy-unit", { owner: "B", controller: "B" })
      .object("deck-gear", { owner: "A", controller: "A", types: ["gear"], zone: "deck" })
      .object("trash-rune", { owner: "A", controller: "A", types: ["rune"], zone: "trash" })
      .object("chain-spell", { owner: "A", controller: "A", types: ["spell"], zone: "chain" })
      .build()
  );

  assert.deepEqual(
    kernel.query(targetSpec.filter).map((object) => object.ref.id).sort(),
    ["base-rune", "base-unit", "battlefield-unit", "board-gear", "enemy-unit"]
  );
});

test("ven-150-166 Acceleration Gate golden: up to four chosen objects ready through the merged primitive", () => {
  const kernel = world()
    .unit("unit-exhausted", { owner: "A", controller: "A", exhausted: true })
    .unit("unit-ready", { owner: "A", controller: "A", exhausted: false })
    .object("gear-exhausted", { owner: "A", controller: "A", types: ["gear"], zone: "board", location: { type: "base", player: "A" }, exhausted: true })
    .object("rune-exhausted", { owner: "A", controller: "A", types: ["rune"], zone: "rune-zone", location: { type: "base", player: "A" }, exhausted: true })
    .unit("enemy-exhausted", { owner: "B", controller: "B", exhausted: true })
    .object("deck-card", { owner: "A", controller: "A", types: ["unit"], zone: "deck", exhausted: false })
    .build();

  // The Finalize-locked target group (355.8/355.13): three exhausted objects
  // plus one already-ready object, i.e. the 0..4 choice the player made.
  const locked = ["unit-exhausted", "unit-ready", "gear-exhausted", "rune-exhausted"].map((id) => kernel.ref(id));
  const outcome = resolveChainBody(play.body, productionFilter(kernelWithTargets(kernel, locked)));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["acceleration-gate.ready-up-to-four", "executed"]]
  );
  // 416.1.b / 416.1.c: an already-ready object is not readied again and emits no
  // event, so only the three exhausted objects are reported and acted on.
  assert.deepEqual(outcome.linkedValues["acceleration-gate.ready-up-to-four.readied"], {
    count: 3,
    objects: [
      { id: "unit-exhausted", zoneEntryId: 1 },
      { id: "gear-exhausted", zoneEntryId: 1 },
      { id: "rune-exhausted", zoneEntryId: 1 }
    ]
  });
  assert.deepEqual(outcome.events.map((event) => event.action), ["ready", "ready", "ready"]);
  assert.equal(kernel.getObject("unit-exhausted").exhausted, false);
  assert.equal(kernel.getObject("gear-exhausted").exhausted, false);
  assert.equal(kernel.getObject("rune-exhausted").exhausted, false);
  assert.equal(kernel.getObject("unit-ready").exhausted, false);
  // Objects outside the chosen group are untouched, and the ready group is not
  // limited by zone: 355.13 allows any number of available targets, 0..4.
  assert.equal(kernel.getObject("enemy-exhausted").exhausted, true);
});

test("ven-150-166 Acceleration Gate golden: choosing zero objects readies nothing and changes no state", () => {
  // 355.12 / 355.13: "up to 4" lets the player choose zero, and the spell is
  // played without any targets. The merged primitive maps an empty target group
  // to its documented "all targets unavailable" path rather than to an empty
  // receipt; the observable game state is identical either way, so this golden
  // asserts the state semantics (no event, no ready, no receipt side effect on
  // any object) and deliberately does not pin the instruction-status spelling.
  const kernel = world().unit("unit-exhausted", { owner: "A", controller: "A", exhausted: true }).build();
  const outcome = resolveChainBody(play.body, productionFilter(kernelWithTargets(kernel, [])));

  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.getObject("unit-exhausted").exhausted, true);
});

test.todo(
  "ven-150-166 Acceleration Gate: a deliberate zero-object choice (355.13) should resolve as an empty receipt, " +
    "while an empty group after lost/revalidated targets stays the merged primitive's ignored/mistargeted path " +
    "(359.3.e.7) — today the interpreter cannot tell the two apart at resolve (same gap as rad-003-167 Bilgewater Tracker)"
);

test("ven-150-166 Acceleration Gate golden: a prevented ready negates the instruction without approximating", () => {
  const kernel = world().unit("unit-exhausted", { owner: "A", controller: "A", exhausted: true }).build();
  kernel.addReplacement((action) => (action.type === "ready" ? "prevented" : null));

  const outcome = resolveChainBody(play.body, productionFilter(kernelWithTargets(kernel, [kernel.ref("unit-exhausted")])));

  // Contract 3.6 primitive rule 2 / 3.4: a replaced or prevented action negates
  // the instruction rather than claiming a ready that never happened.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [["acceleration-gate.ready-up-to-four", "negated", "impossible"]]
  );
  assert.equal(kernel.getObject("unit-exhausted").exhausted, true);
  assert.deepEqual(kernel.events.map((event) => event.action), ["ready"]);
});

test("ven-150-166 Acceleration Gate golden: the set the card declares is readied through the merged primitive", () => {
  // runInstruction clones the world, so the production matcher proxy is not
  // applied inside the clone; hand the primitive the concrete, already-correct
  // selection the card's own filter produced above. The filter itself is
  // asserted in the structure and matcher tests.
  const kernel = world()
    .unit("unit-exhausted", { owner: "A", controller: "A", exhausted: true })
    .object("rune-exhausted", { owner: "A", controller: "A", types: ["rune"], zone: "rune-zone", location: { type: "base", player: "A" }, exhausted: true })
    .unit("enemy-exhausted", { owner: "B", controller: "B", exhausted: true })
    .build();
  const run = runInstruction(
    ready,
    { ...readyUpToFour.args, objects: { kind: "constant", value: { kind: "target", id: TARGET_ID } } },
    { world: kernel, targets: { [TARGET_ID]: [kernel.ref("unit-exhausted"), kernel.ref("rune-exhausted"), kernel.ref("enemy-exhausted")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.readied, {
    count: 3,
    objects: [
      { id: "unit-exhausted", zoneEntryId: 1 },
      { id: "rune-exhausted", zoneEntryId: 1 },
      { id: "enemy-exhausted", zoneEntryId: 1 }
    ]
  });
  assert.deepEqual(run.events.map((event) => event.action), ["ready", "ready", "ready"]);
  assert.equal(kernel.getObject("unit-exhausted").exhausted, false);
  assert.equal(kernel.getObject("rune-exhausted").exhausted, false);
  assert.equal(kernel.getObject("enemy-exhausted").exhausted, false);
});

/** Attach the Finalize-locked target group the production chain would supply. */
function kernelWithTargets(kernel, refs) {
  kernel.setTargets(TARGET_ID, refs);
  return kernel;
}
