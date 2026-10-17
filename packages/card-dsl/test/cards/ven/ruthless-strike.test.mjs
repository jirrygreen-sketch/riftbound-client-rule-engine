import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/ruthless-strike.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-40879a4051400736fda23ede8e39ad9da54a90ec93c7462a8297c7dbf55dee93";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "As an additional cost to play this, you may discard 1.\n" +
  "Deal 3 to a unit at a battlefield. If you paid the additional cost, deal 5 to it instead.";

const [actionKeyword, play] = program.abilities;
const [dealInstruction] = play.body;
const [unitSpec] = dealInstruction.targets;

test("ven-008-166 Ruthless Strike: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ven-008-166 Ruthless Strike: identity, ruleset, status, judgeReason and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /condition\.result/);
  assert.match(program.judgeReason, /158\.2/);
  assert.match(program.judgeReason, /RIFT-89/);
  // RIFT-89 的 cost.modify 原语已合入：理由必须点名已合入的通道与仍缺的生产接线，
  // 不再把原语本身写成缺口。
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /translateCost/);
});

test("ven-008-166 Ruthless Strike: [Action] keyword and the printed energy-only base cost", () => {
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(actionKeyword.value, undefined);
  assert.equal(play.kind, "play");
  // Catalog: energy 3, power null. The absent printed power is never written as 0.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.equal(Object.hasOwn(play.cost, "power"), false);
});

test("ven-008-166 Ruthless Strike: one 3-damage instruction restricted to units at a battlefield", () => {
  assert.equal(play.body.length, 1);
  assert.equal(dealInstruction.id, "ruthless-strike.deal-3");
  assert.equal(dealInstruction.op, "effect.damage");
  assert.deepEqual(dealInstruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(dealInstruction.args.target, {
    kind: "constant",
    value: "ruthless-strike.battlefield-unit"
  });
  assert.equal(dealInstruction.linkedTo, undefined);
  assert.equal(dealInstruction.picks, undefined);
  // 355.9.a.1 "unit" = a Board object; 355.9.b/355.10.b: "at a battlefield" is a
  // targeting restriction, never a target on the battlefield.
  assert.deepEqual(unitSpec, {
    id: "ruthless-strike.battlefield-unit",
    filter: { type: "unit", location: "battlefield", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // The printed "instead" branch (3 to 5) is the same Deal action, so no second
  // effect.damage is authored (see judgeReason).
  assert.equal(play.body.filter(instruction => instruction.op === "effect.damage").length, 1);
});

test("ven-008-166 Ruthless Strike golden: the base deal marks exactly 3 damage", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 6 }).build();
  const locked = kernel.ref("enemy");

  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: unitSpec.id },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 3);
  assert.equal(run.linked.dealtCount, 1);
  assert.equal(kernel.getObject("enemy").damage, 3);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("ven-008-166 Ruthless Strike boundary: a unit that left the Board ignores the deal (359.3.e)", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 6 }).build();
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "kill", object: stale });

  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: unitSpec.id },
    { world: kernel, targets: { [unitSpec.id]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

/**
 * The merged cost.modify primitive (RIFT-89) owns the optionalAdditional
 * channel this card's printed sentence needs: selecting the additional cost
 * produces a real discard payment, declining it writes declinedAdditional and
 * pays only the base cost. This exercises the merged channel end to end; it
 * does not wire the card program's cost into a play action (see judgeReason).
 */
test("ven-008-166 Ruthless Strike golden: cost.modify runs the optional additional discard channel", () => {
  const buildWorld = () => world()
    .hand("discard-me", { types: ["unit"] })
    .unit("spell", { types: ["spell"], energy: 3 })
    .build();
  const additionalCost = (kernel) => ({
    id: "ruthless-strike.optional-discard",
    kind: "additional",
    cost: {
      kind: "activated",
      payments: [{
        kind: "discard",
        choice: {
          id: "ruthless-strike.discard-pick",
          options: [kernel.ref("discard-me")],
          min: 1,
          max: 1,
          selection: "one"
        }
      }]
    }
  });

  // 356.2.b.1: the player chooses to pay the optional additional cost.
  const paid = buildWorld();
  const paidRun = runInstruction(costModify, {
    id: "ruthless-strike.plan",
    cost: { kind: "activated", energy: { kind: "constant", value: 3 } },
    optionalAdditional: [{ ...additionalCost(paid), selected: true }]
  }, {
    world: paid,
    answers: { "ruthless-strike.plan:pick:ruthless-strike.discard-pick": [paid.ref("discard-me")] }
  });

  assert.equal(paidRun.result.status, "executed");
  assert.deepEqual(paidRun.linked.cost.selectedAdditional, [
    { id: "ruthless-strike.optional-discard", kind: "additional" }
  ]);
  assert.deepEqual(paidRun.linked.cost.declinedAdditional, []);
  assert.deepEqual(
    paidRun.linked.cost.total.actions.map(action => action.action),
    [{ type: "discard", object: paid.ref("discard-me") }]
  );
  assert.deepEqual(paid.query({ zone: "hand" }), []);
  assert.deepEqual(paid.query({ zone: "trash" }).map(object => object.cardId), ["card:discard-me"]);
  assert.deepEqual(paidRun.events.map(event => event.action), ["discard"]);

  // 356.2.b: the same choice may be declined; only the base cost is assembled.
  const declined = buildWorld();
  const declinedRun = runInstruction(costModify, {
    id: "ruthless-strike.plan",
    cost: { kind: "activated", energy: { kind: "constant", value: 3 } },
    optionalAdditional: [{ ...additionalCost(declined), selected: false }]
  }, { world: declined });

  assert.equal(declinedRun.result.status, "executed");
  assert.deepEqual(declinedRun.linked.cost.selectedAdditional, []);
  assert.deepEqual(declinedRun.linked.cost.declinedAdditional, ["ruthless-strike.optional-discard"]);
  assert.deepEqual(
    declinedRun.linked.cost.total.actions.map(action => action.action),
    []
  );
  assert.deepEqual(declinedRun.events, []);
  assert.equal(declined.query({ zone: "hand" }).length, 1);
});

test.todo(
  "ven-008-166 Ruthless Strike: charge the printed optional additional cost inside the play pipeline " +
    "(356.2.b/356.2.b.1) — programs/play.ts translateCost still rejects additional/additional-cost cost " +
    "fields on card programs, so the decision never reaches Finalize even though the merged cost.modify " +
    "optionalAdditional channel executes (RIFT-89); the 356.4.f.1 paid receipt still needs a " +
    "condition.result predicate and the 5-instead-of-3 Deal still needs an instruction-level replacement (CR 158.2)"
);
