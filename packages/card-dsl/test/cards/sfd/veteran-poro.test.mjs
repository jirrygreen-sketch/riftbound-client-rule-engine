import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/veteran-poro.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7";

const weaponmasterExpansion = () => {
  const definition = keywordDefinitionsById.get("Weaponmaster");
  assert.ok(definition, "effects/keywords/Weaponmaster.ts must be registered");
  return definition.expand({ host: { canonicalCardId: CARD_ID } });
};

test("sfd-099-221 Veteran Poro: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The blocker is authoritative Equip cost and symbol provenance.
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /821\.1/);
  assert.match(program.judgeReason, /\[A\]\/\[C\]/);
  assert.match(program.judgeReason, /reduce-equip-cost/);
  assert.equal(
    program.sourceText,
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
  );
});

test("sfd-099-221 Veteran Poro: exactly one unvalued Weaponmaster keyword ability", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "keyword");
  assert.equal(ability.keyword, "weaponmaster");
  assert.equal(ability.value, undefined);
});

test("sfd-099-221 Veteran Poro: the merged Weaponmaster expansion is structurally valid EffectIR", () => {
  // The merged Weaponmaster expansion renders 821.1.c as a play trigger whose body
  // pays the chosen Equipment's reduced Equip cost before attaching.
  const [ability] = weaponmasterExpansion();
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  const [choice] = ability.body;
  assert.equal(choice.op, "sequence");
  assert.deepEqual(choice.targets, [
    {
      id: "weaponmaster-equipment",
      filter: { type: "gear", controller: "self", tags: ["Equipment"] },
      min: 0,
      max: 1,
      selection: "up-to"
    }
  ]);
  assert.deepEqual(choice.args.body.value.map((instruction) => instruction.op), [
    "cost.modify",
    "cost.pay",
    "effect.attach"
  ]);
});

test("sfd-099-221 Veteran Poro: selecting no Equipment skips the whole cost/attach sequence", () => {
  // The expansion's own guard: with no Equipment chosen the body is a skipped
  // negation, so nothing is paid and nothing is attached. This executes on the
  // merged interpreter and proves the authored shape is well-formed.
  const [ability] = weaponmasterExpansion();
  const kernel = world().object("gear", { types: ["gear"], tags: ["Equipment"], zone: "board", location: { type: "base", player: "A" } }).build();
  kernel.setTargets("weaponmaster-equipment", []);
  const outcome = runAbilityBody(ability.body, kernel);
  assert.deepEqual(outcome.results.map((entry) => entry.id), ["weaponmaster-choice"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
});

test.todo("Veteran Poro: bind the chosen Equipment's Equip CostSpec and original [A] symbols, then pay and attach at Finalize (821.1.c.2-.5)");
test.todo("Veteran Poro: match the expanded self card-played trigger to the actual played object incarnation");
