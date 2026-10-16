import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/grove-of-the-god-willow.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const [drawInstruction] = ability.body;

test("ogn-280-298 Grove of the God-Willow: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ogn-280-298 Grove of the God-Willow: identity, ruleset, status and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-d1f5f5fd364619f443c985e7fbad178f65d050634effd13cb00fa940a37d3b0a"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  // deck-catalog.json (ogn-280-298) carries this text verbatim.
  assert.equal(program.sourceText, "When you hold here, draw 1.");
});

test("ogn-280-298 Grove of the God-Willow: one mandatory hold trigger drawing 1", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 315.2.b.2 / 471.2 / 473.2.b: the hold scoring step.
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, { event: "hold", here: true, player: "controller" });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(drawInstruction.id, "grove-of-the-god-willow.draw");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  // "Draw 1." involves no target, no non-target pick, no link and no local
  // condition (the drawer defaults to the ability controller, CR 414.1.a).
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("ogn-280-298 Grove of the God-Willow: the printed instruction draws 1 for the battlefield's controller", () => {
  // An array adds a top-to-bottom block (effects/testing/README.md), so
  // "top-card" is the first card of the Main Deck here.
  const kernel = world().deck(["top-card", "bottom-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  // CR 190.6.d: the implicit "you" is the battlefield's controller.
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  // CR 414.1.a: the implicit source is the top of the controller's Main Deck.
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("ogn-280-298 Grove of the God-Willow: an empty deck draws as much as possible (CR 414.4/432)", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "ogn-280-298 Grove of the God-Willow: the hold timing point reaching this ability through the " +
    "trigger -> chain pipeline (RIFT-33 scenarios-triggers / RIFT-26 scenarios-chain)"
);

// Running the raw ability body through runAbilityBody currently throws for this
// instruction: the interpreter evaluates args (amount -> 1) before calling the
// primitive schema, while effect.draw's schema still requires an Expr. The same
// convention mismatch is why the merged straw-man goldens (ogn/consult-the-past,
// sfd/production-surge) execute effect.draw through runInstruction instead.
test.todo(
  "ogn-280-298 Grove of the God-Willow: whole-body execution through runAbilityBody once the " +
    "primitive-schema convention is aligned (interpreter evaluates args; effect.draw/effect.zone/" +
    "effect.token still parse raw IR Exprs)"
);
