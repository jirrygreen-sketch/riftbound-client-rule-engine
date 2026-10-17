import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/blood-rush.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";

const CANONICAL = "card.hash-01042b9eeb52d036e7ddeb7a52f785ab5acaf5fc08d6923554a753376d2b7529";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "[Repeat] :rb_energy_1: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Give a unit [Assault 2]. (+2 :rb_might: while it's an attacker.)";

const [speed, play] = program.abilities;
const [grant] = play.body;

test("sfd-003-221 Blood Rush: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-003-221 Blood Rush: judge-required for the keyword grant and the Repeat cost wiring", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /combatRole|designation/);
  assert.match(program.judgeReason, /820\.1\.c\.1/);
  assert.match(program.judgeReason, /conditionMatches/);
  assert.match(program.judgeReason, /optionalAdditional/);
});

test("sfd-003-221 Blood Rush structure: [Action] plus the printed Repeat cost", () => {
  // [Action] (806) is the printed speed keyword; the registry owns the
  // Showdown permission (806.1.c / 159.2.a).
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");

  // [Repeat] :rb_energy_1: (820.1.c): the printed additional cost with the
  // explicit pay/decline decision 820.1.b requires.
  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.payments.length, 1);
  const [payment] = play.cost.payments;
  assert.equal(payment.kind, "energy");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  assert.equal(payment.choice.id, "blood-rush.repeat-payment");
  assert.deepEqual(payment.choice.options, ["pay", "decline"]);
  assert.equal(payment.choice.selection, "one");
});

test("sfd-003-221 Blood Rush structure: the Assault 2 grant on one chosen unit", () => {
  assert.equal(play.body.length, 1);
  assert.equal(grant.id, "blood-rush.grant-assault-2");
  assert.equal(grant.op, "continuous.grant-keyword");
  // 807.1.b.2: the printed value is 2 (the reminder text "+2 :rb_might: while
  // it's an attacker" is 807.1.c's functional text, not a second ability).
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Assault" });
  assert.deepEqual(grant.args.value, { kind: "constant", value: 2 });
  assert.equal(grant.linkedTo, undefined);

  // "a unit": one Board unit, no controller restriction printed (355.9.a.1).
  assert.equal(grant.targets.length, 1);
  assert.deepEqual(grant.targets[0], {
    id: "blood-rush.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-003-221 Blood Rush: the granted Assault 2 expands with the printed value and its designation gate", () => {
  // The expansion is a static continuous.might ability conditioned on the
  // host's attacker designation (807.1.c / 807.1.d.1); the granted value is the
  // card's printed 2, not the 807.1.b.3 presumed 1.
  const [expansion] = assault.expand({
    value: grant.args.value.value,
    host: { canonicalCardId: CANONICAL }
  });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 2 });
  assert.deepEqual(expansion.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "attacker" }
  });
});

test.todo(
  "sfd-003-221 Blood Rush: executing the merged continuous.grant-keyword op needs the " +
    "card-to-layers wiring that registers a granted ability layer for its printed duration " +
    "(820.1.d.1's additional execution would repeat the grant; CR 801.3.a / 807.1.c)."
);

test.todo(
  "sfd-003-221 Blood Rush: the granted Assault's +2 Might must stay limited to the Attacker " +
    "designation (807.1.d.1), which needs conditionMatches to evaluate the expansion's " +
    "designation condition instead of its unknown-kind fallthrough."
);

test.todo(
  "sfd-003-221 Blood Rush: collecting the optional 1-energy Repeat cost at Finalize, exposing the " +
    "paid count to the effect execution, and re-making choices for the additional execution " +
    "(820.1.c.1 / 820.1.d.1 / 820.2) need the card-to-Finalize optionalAdditional wiring and " +
    "the paid-instance binding."
);

test.todo(
  "sfd-003-221 Blood Rush: the printed [Action] Showdown permission (806, 159.2.a) needs the " +
    "keyword expansion plus the chain's canAct timing query."
);
