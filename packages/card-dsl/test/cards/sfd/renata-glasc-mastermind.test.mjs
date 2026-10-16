import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/renata-glasc-mastermind.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-f5072242d7761ded012359feb98fcc8a89d7c3db8562a68ea71287fefa8f2141";
const SOURCE_TEXT =
  ":rb_energy_1::rb_rune_mind:: Draw 1.\n" +
  ":rb_energy_4::rb_rune_mind::rb_rune_mind::rb_rune_mind::rb_rune_mind:, :rb_exhaust:: Score 1 point.\n" +
  "Use my abilities only while I'm at a battlefield.";

const [drawAbility, scoreAbility] = program.abilities;
const [drawInstruction] = drawAbility.body;
const [scoreInstruction] = scoreAbility.body;

test("sfd-088-221 Renata Glasc, Mastermind: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-088-221 Renata Glasc, Mastermind: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-088-221 Renata Glasc, Mastermind: judgeReason names the activation-condition gaps", () => {
  assert.match(program.judgeReason, /377\.2\.b/);
  assert.match(program.judgeReason, /battlefield/);
  assert.match(program.judgeReason, /107\.1\.b/);
  assert.match(program.judgeReason, /ChainDraft/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("sfd-088-221 Renata Glasc, Mastermind: two Action-speed activated abilities with printed costs", () => {
  // 377.1: the text before ":" is the cost. 381.1: with no [Action]/[Reaction]
  // keyword the ability uses the default Action timing on the controller's turn.
  assert.equal(program.abilities.length, 2);

  assert.equal(drawAbility.kind, "activated");
  assert.equal(drawAbility.timing, "action");
  assert.deepEqual(drawAbility.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    payments: [
      { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Mind"] }
    ]
  });

  assert.equal(scoreAbility.kind, "activated");
  assert.equal(scoreAbility.timing, "action");
  assert.deepEqual(scoreAbility.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 4 },
    // 4 Mind runes: one Power requirement of amount 4 restricted to the Mind
    // domain (135.2.e names Mind), matching the merged allowedDomains shape.
    payments: [
      { kind: "power", amount: { kind: "constant", value: 4 }, allowedDomains: ["Mind"] },
      { kind: "exhaust", object: "self" }
    ]
  });
});

test("sfd-088-221 Renata Glasc, Mastermind: 'use my abilities only while I'm at a battlefield' is a restriction", () => {
  // 377.2.b: the clause is an activation condition, not a resolving effect, so
  // it belongs on the ability, never inside body as a condition.
  for (const ability of [drawAbility, scoreAbility]) {
    assert.equal(ability.restriction.kind, "use-only-while-at-battlefield");
    assert.equal(ability.restriction.source, "self");
  }
  assert.equal(program.abilities.some(ability => ability.kind === "static"), false);
});

test("sfd-088-221 Renata Glasc, Mastermind: bodies are one unlinked Draw 1 and Score 1 point", () => {
  assert.equal(drawAbility.body.length, 1);
  assert.equal(drawInstruction.id, "renata-glasc-mastermind.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });

  assert.equal(scoreAbility.body.length, 1);
  assert.equal(scoreInstruction.id, "renata-glasc-mastermind.score-1");
  assert.equal(scoreInstruction.op, "effect.score");
  assert.deepEqual(scoreInstruction.args, { amount: { kind: "constant", value: 1 } });

  for (const instruction of [drawInstruction, scoreInstruction]) {
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.condition, undefined);
  }
});

test("sfd-088-221 Renata Glasc, Mastermind golden: Draw 1 takes the top card of the controller's Main Deck", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const outcome = resolveChainBody(drawAbility.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["renata-glasc-mastermind.draw-1", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["draw"]);
});

test("sfd-088-221 Renata Glasc, Mastermind golden: Score 1 point awards the ability controller", () => {
  const kernel = world().player("A").player("B").build();
  const outcome = resolveChainBody(scoreAbility.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").score, 1);
  assert.equal(kernel.player("B").score, 0);
  assert.deepEqual(outcome.results[0].result.linkedValues, {
    scored: [{ player: "A", amount: 1 }]
  });
  assert.deepEqual(outcome.events.map(event => event.action), ["score"]);
});

test("sfd-088-221 Renata Glasc, Mastermind golden: the same body scores for whoever controls the ability", () => {
  const kernel = world().player("A").player("B").build();
  // 190.6.d: "you" resolves to the ability's controller, so the body must not
  // name a seat.
  Object.defineProperty(kernel, "controller", { value: "B" });
  const outcome = resolveChainBody(scoreAbility.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("B").score, 1);
  assert.equal(kernel.player("A").score, 0);
});

test("sfd-088-221 Renata Glasc, Mastermind golden: an empty deck draws 0 without inventing a card (414.4)", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(drawAbility.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(outcome.results[0].result.linkedValues, { drawn: 0, drawnTo: "A" });
});

test.todo(
  "sfd-088-221 Renata Glasc, Mastermind: an activation-time check that the source is at a battlefield " +
    "(377.2.b with the Ultrasoft Poro example, 107.1.b / 198.1) — the frozen Condition cannot read " +
    "location.type and the merged chain only validates ChainDraft restrictions, so no CardProgram -> " +
    "ChainDraft adapter carries this activation condition (RIFT-90 / RIFT-120)"
);

test.todo(
  "sfd-088-221 Renata Glasc, Mastermind: charge the printed Energy and Mind Power costs at Finalize " +
    "through the merged cost pipeline (404.1.a / 415.5) once the activated-ability draft adapter exists " +
    "(RIFT-89 / RIFT-120 follow-up)"
);
