// Execution evidence for the merged Deal 1 half of Bellows Breath lives in the
// RIFT-652 template suite:
//   ../templates/keyword-play-effect-damage-652.test.mjs
// The card stays judge-required: the 355.11 group requirement ("at the same
// location") has no evaluating consumer, and the [Repeat] additional cost is
// not collected at Finalize. This file keeps validation, identity and the key
// structure only.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/bellows-breath.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CANONICAL_ID = "card.hash-effd069140ba0a97aec2b49e85dfc04e38ae3517c75aea5b88e3fcb853a4ea2b";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "[Repeat] :rb_energy_1::rb_rune_mind: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Deal 1 to up to three units at the same location.";

const [action, play] = program.abilities;
const [deal] = play.body;
const targetSpec = deal.targets[0];

test("sfd-080-221 Bellows Breath: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-080-221 Bellows Breath: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("sfd-080-221 Bellows Breath: judgeReason names the group requirement and the Repeat wiring", () => {
  assert.match(program.judgeReason, /355\.11/);
  assert.match(program.judgeReason, /355\.11\.b/);
  assert.match(program.judgeReason, /optionalAdditional/);
});

test("sfd-080-221 Bellows Breath: [Action] keyword plus the printed [Repeat] additional cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(action.value, undefined);

  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.keyword, "repeat");
  assert.equal(play.cost.optional, true);
  const [energyPayment, powerPayment] = play.cost.payments;
  assert.equal(energyPayment.kind, "energy");
  assert.deepEqual(energyPayment.amount, { kind: "constant", value: 1 });
  assert.equal(energyPayment.choice.id, "bellows-breath.repeat-payment");
  assert.equal(powerPayment.kind, "power");
  assert.deepEqual(powerPayment.amount, { kind: "constant", value: 1 });
  assert.deepEqual(powerPayment.allowedDomains, ["Mind"]);
});

test("sfd-080-221 Bellows Breath: up-to-three unit targets with the same-location group intent", () => {
  assert.equal(play.body.length, 1);
  assert.equal(deal.id, "bellows-breath.deal-1");
  assert.equal(deal.op, "effect.damage");
  assert.equal(deal.linkedTo, undefined);
  assert.deepEqual(deal.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(deal.args.target, { kind: "constant", value: "bellows-breath.units" });
  // A fixed 1 per target is not split damage (355.14).
  assert.equal(deal.args.divide, undefined);

  // 355.12: each chosen unit is a target chosen independently of the Deal;
  // 355.13: "up to three" includes zero. kind "group" records the 355.11
  // same-location requirement (coherence is still unmerged).
  assert.deepEqual(targetSpec, {
    id: "bellows-breath.units",
    filter: { type: "unit", zone: "board" },
    min: 0,
    max: 3,
    selection: "up-to",
    kind: "group"
  });
  assert.equal(instructionDefinitionsById.get("effect.damage"), damage);
});
