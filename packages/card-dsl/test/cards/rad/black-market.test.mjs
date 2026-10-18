// Execution evidence for the merged slice (two [A] runes + Draw 1 for the
// activator) lives in the RIFT-689 parameterized template golden:
// test/cards/templates/activated-activated-effect-draw-689.test.mjs
// This file keeps validation, identity, verbatim text, the declared status and
// the key structure of the printed cost/restriction/body.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/black-market.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-886b8c03b5b72474abc834112983d7b6adab55b1a3525aeddd44a39898736bb3";

test("rad-158-167 Black Market: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("rad-158-167 Black Market: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    ":rb_rune_rainbow::rb_rune_rainbow:: Draw 1. Each player may use this ability once on their turn (even if they don't control this battlefield)."
  );
  // The two remaining gaps, each with its v1.5 rule anchor and the measured
  // merged-surface evidence named in the reason.
  assert.match(program.judgeReason, /378\.2/);
  assert.match(program.judgeReason, /381\.3/);
  assert.match(program.judgeReason, /377\.2\.b/);
  assert.match(program.judgeReason, /386/);
  assert.match(program.judgeReason, /assertCanControl/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("rad-158-167 Black Market: one action-speed activated ability costing two [A] runes", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.equal(ability.cost.kind, "activated");
  assert.equal(ability.cost.energy, undefined);
  assert.equal(ability.cost.payments.length, 1);
  const [power] = ability.cost.payments;
  assert.equal(power.kind, "power");
  // 135.2.e.5 / 135.2.e.5.a: two rainbow runes = 2 Power of any Domain.
  assert.deepEqual(power.amount, { kind: "constant", value: 2 });
  assert.deepEqual(power.allowedDomains, ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
});

test("rad-158-167 Black Market: the any-player permission and once-per-turn limit stay declared", () => {
  const [ability] = program.abilities;
  // 378.2 / 381.3 (who may activate) and 377.2.b / 054.2 (the "use only" gate)
  // cannot be expressed by any merged consumer; the declaration is preserved so
  // a future activation-permission layer can read it.
  assert.deepEqual(ability.restriction, {
    kind: "usage-limit",
    scope: "once-per-turn-per-player",
    activator: "any-player",
    ignoresControl: true
  });
});

test("rad-158-167 Black Market: the body is one unlinked Draw 1 for the ability controller", () => {
  const [ability] = program.abilities;
  assert.equal(ability.body.length, 1);
  const [draw] = ability.body;
  assert.equal(draw.id, "black-market.draw-1");
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(draw.linkedTo, undefined);
  assert.equal(draw.targets, undefined);
  assert.equal(draw.picks, undefined);
  assert.equal(draw.condition, undefined);
});
