import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/kadregrin-the-infernal.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-398b3826ce23339dadae173c5f1fa39994abe8d2eed99f68d1de01806763d379";

test("ogn-038-298 Kadregrin the Infernal: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Mighty/);
  assert.match(program.judgeReason, /RIFT-88/);
});

test("ogn-038-298 Kadregrin the Infernal: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "When you play me, draw 1 for each of your [Mighty] units. (A unit is Mighty while it has 5+ :rb_might:.)"
  );
});

test("ogn-038-298 Kadregrin the Infernal: card-played self trigger with a count-driven draw and no target", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "kadregrin.draw-per-mighty");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, {
    kind: "count",
    subject: "units",
    filter: { type: "unit", controller: "controller", mightGte: 5 }
  });
  // "for each of your [Mighty] units" is a programmatic set query (355.10.d),
  // not a target: no TargetSpec / PickSpec is declared.
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogn-038-298 Kadregrin the Infernal: the count drives an exactly-sized draw through the reference kernel", () => {
  // The merged reference kernel's filter does not implement a Mighty predicate,
  // so this golden pins the count -> draw shape with an explicit board filter
  // (controller + zone); the Mighty predicate itself remains the judged part.
  const kernel = world()
    .deck(["a", "b", "c"])
    .unit("mighty-1", { owner: "A", might: 6 })
    .unit("mighty-2", { owner: "A", might: 5 })
    .unit("enemy", { owner: "B", might: 7 })
    .build();
  const amountExpr = {
    kind: "count",
    subject: "units",
    filter: { type: "unit", controller: "A", zone: "board" }
  };
  assert.equal(kernel.evaluate(amountExpr), 2);

  const run = runInstruction(draw, { amount: amountExpr }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("ogn-038-298 Kadregrin the Infernal: zero qualifying units draws zero cards", () => {
  const kernel = world().deck(["a"]).build();
  const run = runInstruction(
    draw,
    { amount: { kind: "count", subject: "units", filter: { type: "unit", controller: "A", zone: "board" } } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(kernel.events.length, 0);
});

test.todo(
  "ogn-038-298 Kadregrin the Infernal: the [Mighty] set predicate (Might >= 5, CR 706-708/710) must be " +
    "supplied by the keyword/condition work (RIFT-88) and consumed by the query filter (RIFT-91); until " +
    "then the count cannot distinguish Mighty units from non-Mighty ones."
);
