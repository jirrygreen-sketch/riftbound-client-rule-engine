import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/rampage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import continuousMight from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-9c6aa95845a73edcec9a9568deba187100fbe690f0a6dfcc010810f04e6a9245";
const SOURCE_TEXT =
  "As you play this, you may pay :rb_rune_body: as an additional cost.\n" +
  "Choose a friendly unit and an enemy unit. If you paid the additional cost, " +
  "give the friendly unit +2 :rb_might: this turn. They deal damage equal to " +
  "their Mights to each other.";

const [play] = program.abilities;
const [givePlusTwo, friendlyDeals, enemyDeals] = play.body;

const FRIENDLY_ID = "rampage.friendly-unit";
const ENEMY_ID = "rampage.enemy-unit";

test("ven-083-166 Rampage: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-083-166 Rampage: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-083-166 Rampage: judgeReason names the additional-cost, cost-result and Might gaps", () => {
  assert.doesNotMatch(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /condition\.result/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.doesNotMatch(program.judgeReason, /RIFT-258/);
  assert.doesNotMatch(program.judgeReason, /没有 continuous\.might|continuous\.might 未合入/);
  // 356.4.f.1 is the "paid" record the conditional +2 needs.
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-083-166 Rampage: printed cost plus the optional :rb_rune_body: additional cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // 356.2.b / 356.2.b.1: the optional additional cost is one Body Power with an
  // explicit pay/decline choice; the printed base cost is 3 Energy and the
  // catalog's power is null (no printed Power, never rewritten as 0).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 },
    payments: [
      {
        kind: "power",
        amount: { kind: "constant", value: 1 },
        allowedDomains: ["Body"],
        choice: {
          id: "rampage.pay-or-decline",
          options: ["pay", "decline"],
          min: 1,
          max: 1,
          selection: "one"
        }
      }
    ]
  });
});

test("ven-083-166 Rampage: +2 Might body and the two Might-sourced Deal instructions", () => {
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["rampage.give-friendly-plus-2", "continuous.might"],
    ["rampage.friendly-deals", "effect.damage"],
    ["rampage.enemy-deals", "effect.damage"]
  ]);

  // 143.2.a / 317.2.c: the +2 is a this-turn layers Might change written with
  // the merged continuous.might instruction; the paid-cost gate still has no
  // result binding.
  assert.deepEqual(givePlusTwo.args, {
    amount: { kind: "constant", value: 2 },
    duration: { kind: "constant", value: "this-turn" },
    target: { kind: "constant", value: FRIENDLY_ID }
  });
  assert.deepEqual(givePlusTwo.targets, [
    {
      id: FRIENDLY_ID,
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // 355.7 / 355.9.a.1 / 355.9.b: one friendly and one enemy Board unit, both
  // chosen at Finalize.
  assert.deepEqual(friendlyDeals.targets, [
    {
      id: ENEMY_ID,
      filter: { type: "unit", zone: "board", controller: "opponent" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.deepEqual(enemyDeals.targets, [
    {
      id: FRIENDLY_ID,
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // 418.6.b.3: each chosen unit is the source of its own damage and the amount
  // is read from that unit's Might at resolution.
  for (const [instruction, self, other] of [
    [friendlyDeals, FRIENDLY_ID, ENEMY_ID],
    [enemyDeals, ENEMY_ID, FRIENDLY_ID]
  ]) {
    assert.deepEqual(instruction.args.amount, {
      kind: "object-property",
      object: { target: self },
      property: "might"
    });
    assert.deepEqual(instruction.args.source, {
      kind: "object-property",
      object: { target: self },
      property: "ref"
    });
    assert.deepEqual(instruction.args.target, { kind: "constant", value: other });
    // A fixed per-unit amount is not split damage (355.14), and the printed Deal
    // is not combat damage (418.6.c), so neither flag is declared.
    assert.equal(instruction.args.divide, undefined);
    assert.equal(instruction.args.combat, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }
});

test("ven-083-166 Rampage golden: the two chosen units damage each other by their Mights", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", controller: "A", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 5 })
    .build();
  const friendlyRef = kernel.ref("friendly");
  const enemyRef = kernel.ref("enemy");
  // 418.6.b.3 makes each chosen unit the source of its own damage; the submitted
  // GameActions are observed (a hook that applies no replacement) so the source
  // references are proven, not just the marked damage.
  const submitted = [];
  kernel.addReplacement(action => {
    if (action.type === "damage") submitted.push(action);
    return null;
  });

  const friendlyRun = runInstruction(
    damage,
    {
      amount: friendlyDeals.args.amount,
      source: friendlyDeals.args.source,
      target: ENEMY_ID
    },
    { world: kernel, targets: { [FRIENDLY_ID]: [friendlyRef], [ENEMY_ID]: [enemyRef] } }
  );
  assert.equal(friendlyRun.result.status, "executed");
  assert.equal(friendlyRun.result.linkedValues.dealt, 3);
  assert.equal(kernel.getObject("enemy").damage, 3);

  const enemyRun = runInstruction(
    damage,
    {
      amount: enemyDeals.args.amount,
      source: enemyDeals.args.source,
      target: FRIENDLY_ID
    },
    { world: kernel, targets: { [FRIENDLY_ID]: [friendlyRef], [ENEMY_ID]: [enemyRef] } }
  );
  assert.equal(enemyRun.result.status, "executed");
  assert.equal(enemyRun.result.linkedValues.dealt, 5);
  assert.equal(kernel.getObject("friendly").damage, 5);
  // 418.1.b/.c: damage is marked on each unit separately, from that unit.
  assert.deepEqual(submitted, [
    {
      type: "damage",
      source: friendlyRef,
      target: enemyRef,
      amount: 3,
      combat: false
    },
    {
      type: "damage",
      source: enemyRef,
      target: friendlyRef,
      amount: 5,
      combat: false
    }
  ]);
});

test("ven-083-166 Rampage golden: a chosen unit that left the Board is not dealt damage (359.3.e.7)", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", controller: "A", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 5 })
    .build();
  const friendlyRef = kernel.ref("friendly");
  const enemyRef = kernel.ref("enemy");
  const staleEnemy = kernel.ref("enemy");
  kernel.perform({ type: "kill", object: staleEnemy });

  const run = runInstruction(
    damage,
    {
      amount: friendlyDeals.args.amount,
      source: friendlyDeals.args.source,
      target: ENEMY_ID
    },
    { world: kernel, targets: { [FRIENDLY_ID]: [friendlyRef], [ENEMY_ID]: [staleEnemy] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.equal(kernel.getObject("enemy").zone, "trash");
});

test.todo(
  "ven-083-166 Rampage: charge the optional :rb_rune_body: additional cost at Finalize (CR 356.2.b / " +
    "356.2.b.1) and gate the +2 on the paid result (356.4.f.1) — needs the card program's cost.additional / " +
    "CostSpec clause wired into CostPlanInput.optionalAdditional plus a cost-result binding"
);

test("ven-083-166 Rampage golden: the chosen friendly unit receives a +2 Might arithmetic-layer boost", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", controller: "A", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 5 })
    .build();
  const friendlyRef = kernel.ref("friendly");

  const run = runInstruction(
    continuousMight,
    // runInstruction receives the evaluator-resolved argument shape, so bind
    // the Expr args to the same plain values the interpreter produces.
    {
      amount: 2,
      duration: "this-turn",
      target: FRIENDLY_ID,
    },
    { world: kernel, targets: { [FRIENDLY_ID]: [friendlyRef] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.result.linkedValues["affected.count"], 1);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  assert.deepEqual(registration.effect.filter.objectId, "friendly");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
});

test.todo(
  "ven-083-166 Rampage: give the chosen friendly unit +2 Might this turn and compute both Deal amounts " +
    "from the modified Mights (CR 143.2.a / 317.2.c / 418.6.b.3) — the +2 registration is proven by golden, " +
    "but the paid-additional-cost result binding (356.4.f.1) is still missing, so the unfired-cost branch must " +
    "never trigger the +2"
);
