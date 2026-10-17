import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/astral-heron.js";

const CANONICAL_ID =
  "card.hash-7efb1a981d4769615bfa3bd93ca6dffae7dd488b8cbea4e087b97882f0d2933c";
const SOURCE_TEXT =
  "When you play your first card each turn, if I'm at a battlefield, your next card costs :rb_energy_2::rb_rune_rainbow::rb_rune_rainbow: less.";

const [ability] = program.abilities;
const [costModify] = ability.body;

test("ven-044-166 Astral Heron: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-044-166 Astral Heron: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /next-card/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-044-166 Astral Heron: 'your first card each turn' is a once-per-turn Nth-Time trigger", () => {
  // 383.1 / 383.1.b: the Nth-Time condition triggers only once even when several
  // qualifying plays happen simultaneously; contract 3.5 records the per-turn
  // lifetime on TriggerSpec.once (the merged rad/akali-brash uses the same shape).
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { player: "self" }
  });
  assert.equal(ability.trigger.once, "per-turn");
  assert.equal(ability.optional, false);
});

test("ven-044-166 Astral Heron: 'if I'm at a battlefield' is the trigger condition, not an effect clause", () => {
  // 383.2.a.1: the conditional statement immediately after the Condition belongs
  // to the Trigger Condition (the CR's Sona example); it is evaluated when the
  // ability triggers, so removing the source later does not undo it.
  assert.deepEqual(ability.trigger.condition, {
    kind: "expression",
    value: {
      kind: "object-property",
      object: "self",
      property: "at-battlefield"
    }
  });
  // No TargetSpec/pick: the clause restricts the trigger, it chooses no object.
  assert.equal(ability.trigger.filter.filter.zone, undefined);
});

test("ven-044-166 Astral Heron: the discount is a next-card rewrite with 2 Energy and two any-domain Power", () => {
  // 356.4 / 356.4.b / 356.4.c.1: the clause is a discount applied while total cost
  // is determined, per cost component; 206 keeps printed costs intact.
  assert.equal(costModify.id, "astral-heron.reduce-next-card");
  assert.equal(costModify.op, "cost.modify");
  assert.deepEqual(costModify.args, {
    resource: { kind: "constant", value: "energy" },
    amount: { kind: "constant", value: -2 },
    appliesTo: { kind: "constant", value: "next-card-played-this-turn" },
    duration: { kind: "constant", value: "this-turn" },
    power: { kind: "constant", value: ["rainbow", "rainbow"] }
  });
  // 135.2.e.5.a / 163.2.b: :rb_rune_rainbow: is Power of any Domain; the closed
  // six-domain union cannot express it, so the printed count is recorded as data
  // rather than approximated with a specific domain.
  assert.deepEqual(costModify.args.power.value, ["rainbow", "rainbow"]);
  // The rewrite names a window, never a specific card: no target object and no
  // amount taken from the future card's own printed cost.
  assert.equal(costModify.targets, undefined);
  assert.equal(costModify.picks, undefined);
});

test.todo(
  "ven-044-166 Astral Heron: apply the next-card discount while determining total cost (356.4) — cost.modify " +
    "is merged, but no one-shot next-card window is registered into a Finalize cost plan (RIFT-89)"
);

test.todo(
  "ven-044-166 Astral Heron: represent the two any-domain Power in the discount (135.2.e.5.a / 163.2.b) — the " +
    "closed six-domain union has no Universal Power value and must not be approximated"
);

test.todo(
  "ven-044-166 Astral Heron: evaluate \"if I'm at a battlefield\" as a trigger condition (383.2.a.1) — the " +
    "location predicate has no trigger/continuous landing path (RIFT-91)"
);

test.todo(
  "ven-044-166 Astral Heron: register the card-played trigger as a TriggerRegistration (383.2.c.1) — RIFT-120"
);
