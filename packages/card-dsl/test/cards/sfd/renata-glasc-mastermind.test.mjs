import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/renata-glasc-mastermind.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

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

test("sfd-088-221 Renata Glasc, Mastermind: judgeReason names the activation-condition gap", () => {
  assert.match(program.judgeReason, /377\.2\.b/);
  assert.match(program.judgeReason, /battlefield/);
  assert.match(program.judgeReason, /107\.1\.b/);
  // The merged CardProgram -> ChainDraft restriction adapter exists, so the
  // accurate gap is the missing location-type predicate plus the refusal of a
  // non-Condition restriction kind, not a missing adapter.
  assert.match(program.judgeReason, /translateRestriction/);
  assert.match(program.judgeReason, /ChainDraft/);
  assert.match(program.judgeReason, /location\.type/);
  assert.match(program.judgeReason, /启动检查适配/);
  assert.match(program.judgeReason, /payment receipt/);
  assert.doesNotMatch(program.judgeReason, /未消费 Power/);
  assert.doesNotMatch(program.judgeReason, /describePlay 未实现/);
});

test("sfd-088-221 Renata Glasc, Mastermind: the merged adapter does forward a Condition-shaped restriction", () => {
  // Evidence for the corrected judgeReason: translateRestriction
  // turns a CardProgram restriction into a ChainDraft restriction, and the
  // chain checks it during Finalize. This card's kind is not in the Condition
  // vocabulary, which is exactly why the adapter refuses it.
  const synthetic = {
    canonicalCardId: "synthetic-restriction-probe",
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "probe",
    abilities: [
      {
        kind: "activated",
        timing: "action",
        cost: { kind: "activated" },
        restriction: { kind: "always" },
        body: [{ id: "probe.draw", op: "effect.draw", args: { amount: { kind: "constant", value: 1 } } }]
      }
    ]
  };
  const source = {
    ref: { id: "probe", zoneEntryId: 1 },
    cardId: "synthetic-restriction-probe",
    name: "probe",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    might: 3,
    energy: 2,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const binding = createProgramBinding({ cardPrograms: [synthetic] });
  const draft = binding.describeActivate(source, "A", 0);
  assert.deepEqual(draft.restrictions, [{ kind: "always" }]);
});

test.todo(
  "sfd-088-221 Renata Glasc, Mastermind: the card's own restriction kind " +
    "(use-only-while-at-battlefield) must be carried by a rules adapter — the merged adapter only " +
    "accepts Condition kinds, and a non-Condition kind fails closed"
);

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
  assert.equal(program.abilities.filter((ability) => ability.kind === "activated").length, 2);
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
  // 191.5.a/.b: use the ability's controller, so the body must not name a seat.
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
    "location.type directly and use-only-while-at-battlefield still needs an activation restriction adapter"
);

for (const [index, ability] of [drawAbility, scoreAbility].entries()) {
  test(`sfd-088-221 Renata Glasc, Mastermind: real printed cost payment for ability ${index + 1}`, () => {
    // This executes the original cost only; the source-location activation
    // restriction still blocks whole-card activation through the registry.
    const energy = index === 0 ? 1 : 4;
    const power = Array.from({ length: index === 0 ? 1 : 4 }, () => "Mind");
    const initial = world().player("A", { energy, power })
      .unit("renata", { cardId: CARD_ID, might: 4, energy: 5, power: null }).build();
    const kernel = initial.clone({ sourceSnapshot: initial.getObject("renata") });
    const cost = translateCost(ability.cost, `renata-cost-${index}`, "activate");
    const modified = runInstruction(costModify, { id: `renata-cost-${index}`, cost }, { world: kernel });
    assert.equal(modified.result.status, "executed");
    assert.equal(modified.linked.cost.total.energy, energy);
    assert.deepEqual(modified.linked.cost.total.power, [{ amount: power.length, allowedDomains: ["Mind"] }]);
    const paid = runInstruction(costPay, { cost: { kind: "constant", value: modified.linked.cost } }, { world: kernel });
    assert.equal(paid.result.status, "executed");
    assert.equal(kernel.player("A").energy, 0);
    // The legacy TestWorld pay action does not mutate its Power snapshot, but
    // the receipt contains the authoritative domain allocation selected by
    // cost.payment.ts.
    assert.deepEqual(paid.linked.payment.power.power, [
      { requirementIndex: 0, from: "Mind", amount: index === 0 ? 1 : 4 }
    ]);
    // cost.payment.ts commits the selected Power allocation even though the
    // legacy TestWorld pay action leaves its cached player snapshot untouched.
    assert.deepEqual(kernel.player("A").power, []);
    assert.equal(kernel.getObject("renata").exhausted, index === 1);
    assert.equal(kernel.getObject("renata").power, null);
    assert.deepEqual(paid.events.map(event => event.action), index === 0 ? ["pay"] : ["pay", "exhaust"]);
  });
}
