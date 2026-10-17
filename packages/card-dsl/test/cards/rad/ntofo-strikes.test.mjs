import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ntofo-strikes.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, play] = program.abilities;
const [grantShield, shieldValue, dealShield] = play.body;

function fixture() {
  const kernel = world()
    .unit("ksante", { might: 4 })
    .unit("enemy", { owner: "B", might: 5 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ksante") });
  scoped.setTargets("ntofo-strikes.friendly-unit", [kernel.ref("ksante")]);
  return { kernel, scoped };
}

test("rad-148-167 Ntofo Strikes: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-09ac8b0dded2de4aaec186e708da9025177f38cddcb872a26bfa49aa0a1f627f"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Give a friendly unit [Shield 2] this turn, then deal damage equal to its [Shield] to an enemy unit. " +
      "(A unit with Shield has +1 :rb_might: for each instance of Shield while it's a defender.)"
  );
});

test("rad-148-167 Ntofo Strikes: judgeReason records only the remaining Shield-value read", () => {
  // The keyword-grant dependency is merged; the reason must say so instead of
  // still listing it as a gap, and must name the real remaining one.
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-258/);
  assert.match(program.judgeReason, /effect\.shield-value/);
  assert.match(program.judgeReason, /814\.2/);
  assert.equal(/RIFT-91/.test(program.judgeReason), false);
});

test("rad-148-167 Ntofo Strikes: reading `keywords` as an amount is rejected, so the Shield Value read stays missing", () => {
  // ObjectSnapshot.keywords is a { id, value } list; effect.damage needs a
  // number. The closest available spelling (object-property "keywords") yields
  // the array and the primitive negates it as impossible rather than dealing a
  // wrong amount — which is exactly why effect.shield-value is still pending.
  const kernel = world()
    .unit("ally", { might: 4, keywords: [{ id: "Shield", value: 2 }] })
    .unit("enemy", { owner: "B", might: 5 })
    .build();
  const run = runInstruction(
    damage,
    {
      amount: { kind: "object-property", object: { target: "ntofo-strikes.enemy-unit" }, property: "keywords" },
      target: "ntofo-strikes.enemy-unit"
    },
    { world: kernel, targets: { "ntofo-strikes.enemy-unit": [kernel.ref("enemy")] } }
  );
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.getObject("enemy").damage, 0);
  // The granted Shield itself is real: the list really carries the value.
  assert.deepEqual(kernel.getObject("ally").keywords, [{ id: "Shield", value: 2 }]);
});

test("rad-148-167 Ntofo Strikes: the authored three-instruction body stops at the unregistered Shield-value op", () => {
  // End-to-end evidence for the declared gap: the grant would execute, but the
  // whole body is driven to `ignored` by the unregistered read, and the linked
  // damage cannot fall through to a free 0 or a guessed 2.
  assert.equal(program.abilities[1].body[1].op, "effect.shield-value");
  const kernel = world()
    .unit("ksante", { might: 4, controller: "A", owner: "A" })
    .unit("enemy", { might: 5, controller: "B", owner: "B" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ksante") });
  scoped.setTargets("ntofo-strikes.friendly-unit", [kernel.ref("ksante")]);
  scoped.setTargets("ntofo-strikes.enemy-unit", [kernel.ref("enemy")]);
  const outcome = runAbilityBody(program.abilities[1].body, scoped);
  assert.deepEqual(outcome.results.map(result => [result.op, result.result.status]), [
    ["continuous.grant-keyword", "ignored"],
    ["effect.shield-value", "ignored"],
    ["effect.damage", "ignored"]
  ]);
  // Nothing was actually granted or dealt: the body is not silently settled.
  assert.equal(scoped.continuousEffects.length, 0);
  assert.equal(scoped.getObject("enemy").damage, 0);
});

test("rad-148-167 Ntofo Strikes: structure — Action keyword, Shield grant, Shield-value read, linked damage", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "ntofo-strikes.grant-shield",
    "ntofo-strikes.shield-value",
    "ntofo-strikes.deal-shield"
  ]);

  // "Give a friendly unit [Shield 2] this turn" — duration-bounded keyword
  // grant (801.3.a / 814.1.b.2) through the merged continuous.grant-keyword op.
  assert.equal(grantShield.op, "continuous.grant-keyword");
  assert.deepEqual(grantShield.args.keyword, { kind: "constant", value: "Shield" });
  assert.deepEqual(grantShield.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(grantShield.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(grantShield.targets.length, 1);
  assert.equal(grantShield.targets[0].id, "ntofo-strikes.friendly-unit");
  assert.deepEqual(grantShield.targets[0].filter, { type: "unit", controller: "self" });
  assert.equal(grantShield.targets[0].min, 1);
  assert.equal(grantShield.targets[0].max, 1);
  assert.equal(grantShield.targets[0].selection, "one");

  // "then deal damage equal to its [Shield]" — the Shield Value read ("then"
  // makes this linked to the grant, 359.3.e.14). No merged expression reads a
  // keyword value, so the amount stays linked to the pending op.
  assert.equal(shieldValue.op, "effect.shield-value");
  assert.equal(shieldValue.linkedTo, "ntofo-strikes.grant-shield");
  assert.deepEqual(shieldValue.args.object, {
    kind: "constant",
    value: { target: "ntofo-strikes.friendly-unit" }
  });
  assert.equal(shieldValue.targets, undefined);

  assert.equal(dealShield.op, "effect.damage");
  assert.equal(dealShield.linkedTo, "ntofo-strikes.shield-value");
  assert.deepEqual(dealShield.args.amount, {
    kind: "linked-value",
    instructionId: "ntofo-strikes.shield-value",
    key: "shieldValue"
  });
  assert.deepEqual(dealShield.args.target, {
    kind: "constant",
    value: "ntofo-strikes.enemy-unit"
  });
  assert.equal(dealShield.targets.length, 1);
  assert.equal(dealShield.targets[0].id, "ntofo-strikes.enemy-unit");
  assert.deepEqual(dealShield.targets[0].filter, { type: "unit", controller: "opponent" });
  assert.equal(dealShield.targets[0].min, 1);
  assert.equal(dealShield.targets[0].max, 1);
  assert.equal(dealShield.targets[0].selection, "one");
});

test("rad-148-167 Ntofo Strikes: the merged Shield KeywordDef carries the printed Shield Value", () => {
  assert.equal(keywordDefinitionsById.get("Shield"), shield);
  // 814.1.b.2 / 814.2: a Shield Value sums its instances and is a characteristic.
  assert.equal(shield.valued, true);
  assert.equal(shield.stacking, "sum");
  assert.ok(shield.ruleRefs.includes("814.1.b.3"));
  assert.ok(shield.ruleRefs.includes("814.2"));
});

test("rad-148-167 Ntofo Strikes: the declared grant really registers the Shield 2 ability-layer grant", () => {
  const { scoped } = fixture();
  const outcome = runAbilityBody([{ ...grantShield, targets: undefined }], scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [["ntofo-strikes.grant-shield", "executed"]]
  );
  assert.equal(scoped.continuousEffects.length, 1);
  const [registered] = scoped.continuousEffects;
  assert.equal(registered.effect.layer, "ability");
  assert.equal(registered.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registered.effect.effect.keyword, "Shield");
  // 814.1.b.2: the granted Shield Value is the printed 2.
  assert.equal(registered.effect.effect.keywordValue, 2);
  // "this turn" (801.3.a / 317.2.c): the grant expires at end of turn.
  assert.deepEqual(registered.duration, { type: "end-of-turn" });
});

test("rad-148-167 Ntofo Strikes: the granted Shield expands to +2 Might while defending (814.1.c)", () => {
  const [expansion] = shield.expand({ value: 2, host: { canonicalCardId: program.canonicalCardId } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.equal(expansion.effect.mode, "add");
  assert.equal(expansion.effect.layer, "arithmetic");
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 2 });
  // 814.1.d.1: the bonus applies exactly while the unit holds the Defender
  // designation.
  assert.equal(expansion.condition.kind, "compare");
  assert.equal(expansion.condition.operator, "eq");
  assert.equal(expansion.condition.left.property, "designation");
  assert.deepEqual(expansion.condition.right, { kind: "constant", value: "defender" });
});

test("rad-148-167 Ntofo Strikes: the damage half deals the Shield Value once it is supplied (418.1.b)", () => {
  const kernel = world()
    .player("A")
    .unit("ally", { might: 2 })
    .unit("enemy", { owner: "B", might: 5 })
    .build();
  // The Shield Value read is the unresolved half; with the value supplied (as
  // the pending effect.shield-value would link it), the merged effect.damage
  // deals exactly that much to the targeted enemy unit.
  const run = runInstruction(
    damage,
    { amount: dealShield.args.amount, target: "ntofo-strikes.enemy-unit" },
    {
      world: kernel,
      targets: { "ntofo-strikes.enemy-unit": [kernel.ref("enemy")] },
      linked: { shieldValue: 2 }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.dealt, 2);
  assert.equal(kernel.getObject("enemy").damage, 2);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test.todo(
  "rad-148-167 Ntofo Strikes: 'damage equal to its [Shield]' needs a read of the unit's summed Shield " +
    "Value (ObjectSnapshot.keywords { id, value }; CR 814.1.b.2 / 814.2); no merged Expr reads a keyword " +
    "value"
);
