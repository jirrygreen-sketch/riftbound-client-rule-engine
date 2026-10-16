import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import bulletTime from "../../../dist/cards/ogn/bullet-time-miss-fortune.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-a3cda4342389b7462e190847b72891326166dd6d3a74a0400056dbbee1371daa";
const BATTLEFIELD = id => ({ type: "battlefield", id });

const [keyword, play] = bulletTime.abilities;
const [payInstruction, damageInstruction] = play.body;

test("Bullet Time program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(bulletTime);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Bullet Time identity, ruleset, status, printed text and judgeReason", () => {
  assert.equal(bulletTime.canonicalCardId, CANONICAL);
  assert.equal(bulletTime.rulesetVersion, "core-1.5");
  assert.equal(bulletTime.status, "judge-required");
  assert.equal(
    bulletTime.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Pay any amount of :rb_rune_rainbow: to deal that much damage to all enemy units at a battlefield."
  );
  // The judgeReason must name both missing forms with their rule numbers.
  assert.match(bulletTime.judgeReason, /355\.10\.d/);
  assert.match(bulletTime.judgeReason, /204\.3/);
  assert.match(bulletTime.judgeReason, /effect\.damage/);
  assert.match(bulletTime.judgeReason, /cost\.pay/);
  assert.equal(cardRegistryById.get(bulletTime.canonicalCardId), bulletTime);
});

test("Bullet Time declares [Action] and no printed Power cost (power: null, not 0)", () => {
  assert.equal(bulletTime.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(keyword.value, undefined);
  // The catalog records power: null for this printing, so the program must not
  // declare a zero-cost or any other Power requirement.
  assert.equal(play.cost, undefined);
});

test("Bullet Time structure: the instruction cost is linked to a non-target damage set", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 2);

  // A Cost within an Instruction (204.3 / 204.3.a, whose printed example is this
  // card). The amount is chosen at resolution and must be reportable for the
  // damage below.
  assert.equal(payInstruction.id, "bullet-time.pay-any-amount");
  assert.equal(payInstruction.op, "cost.pay-any");
  assert.deepEqual(payInstruction.args, {
    resource: { kind: "constant", value: "power" },
    domain: { kind: "constant", value: "rainbow" },
    amount: { kind: "constant", value: "any" },
    linkKey: { kind: "constant", value: "paid" },
    prompt: { kind: "constant", value: "Pay any amount of [A]?" }
  });
  assert.equal(payInstruction.targets, undefined);
  assert.equal(payInstruction.linkedTo, undefined);

  // The amount is the paid amount, and the units are a programmatic set (not
  // targets), described in the descriptor shape effect.ready / effect.heal take.
  assert.equal(damageInstruction.id, "bullet-time.damage-each-enemy-unit");
  assert.equal(damageInstruction.op, "effect.damage");
  assert.equal(damageInstruction.linkedTo, "bullet-time.pay-any-amount");
  assert.deepEqual(damageInstruction.args.amount, {
    kind: "linked-value",
    instructionId: "bullet-time.pay-any-amount",
    key: "paid"
  });
  assert.deepEqual(damageInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: { type: "unit", controller: "opponent", location: "battlefield" }
    }
  });
  // A TargetSpec here would wrongly make every unit at the battlefield a target
  // (355.7 / 754), so the instruction declares none.
  assert.equal(damageInstruction.targets, undefined);
});

test("Bullet Time: the merged damage primitive rejects the unsupported set descriptor", () => {
  // The merged effect.damage consumes only a Finalize-locked TargetSpec id and
  // rejects the non-target set descriptor that effect.ready / effect.heal take.
  assert.equal(instructionDefinitionsById.has("effect.damage"), true);
  // The only accepted form is the Finalize-locked TargetSpec; the set form is
  // not part of the schema at all.
  const constant = value => ({ kind: "constant", value });
  assert.throws(
    () => damage.argsSchema.parse({ amount: constant(2), objects: constant({ kind: "query", filter: { type: "unit" } }) }),
    /effect\.damage args\.target must be a TargetSpec id string/
  );
  assert.equal(damage.argsSchema.parse({ amount: constant(2), target: "units" }).target, "units");
});

test("Bullet Time: the program fails closed instead of damaging something", () => {
  const kernel = world().unit("enemy", { owner: "B", location: BATTLEFIELD("bf1") }).build();
  const body = play.body.map(({ targets, ...rest }) => rest);
  assert.throws(
    () => runAbilityBody(body, kernel),
    /cost\.pay-any/
  );
  assert.equal(kernel.getObject("enemy").damage, 0);
});

test("Bullet Time golden: the declared damage set is what a non-target damage form must cover", () => {
  // The merged effect.damage can only be driven through a locked TargetSpec, so
  // this pins which units the card set contains — every enemy unit at a
  // battlefield — and that the linked amount really reaches the primitive.
  const kernel = world()
    .unit("enemy-here", { owner: "B", location: BATTLEFIELD("bf1") })
    .unit("enemy-elsewhere", { owner: "B", location: BATTLEFIELD("bf2") })
    .unit("friendly-here", { owner: "A", location: BATTLEFIELD("bf1") })
    .build();
  const run = runInstruction(
    damage,
    { amount: { kind: "constant", value: 3 }, target: "enemy-units-at-a-battlefield" },
    {
      world: kernel,
      targets: {
        "enemy-units-at-a-battlefield": [kernel.ref("enemy-here"), kernel.ref("enemy-elsewhere")]
      }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-here").damage, 3);
  assert.equal(kernel.getObject("enemy-elsewhere").damage, 3);
  // Only the declared set is affected: the friendly unit is untouched.
  assert.equal(kernel.getObject("friendly-here").damage, 0);
  assert.equal(run.linked.dealt, 6);
  // CR 418.1.d: damage to more than one unit at the same time, one action each.
  assert.deepEqual(run.events.map(event => event.action), ["damage", "damage"]);
});

test.todo(
  "Bullet Time instruction cost: add a resolve-time any-amount payment primitive that publishes the amount " +
    "actually paid, so the linked damage can read it (204.3 / 204.3.a; the merged cost plan only covers " +
    "Finalize payments today)"
);

test.todo(
  "Bullet Time non-target damage: let effect.damage consume the same query-set descriptor that effect.ready " +
    "and effect.heal already accept, so every enemy unit at a battlefield is damaged without becoming a " +
    "target (355.10.d / 355.10.d.1 / 754)"
);

