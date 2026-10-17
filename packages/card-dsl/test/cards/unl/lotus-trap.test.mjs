import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/lotus-trap.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { abilitySpeed } from "../../../../engine-core/dist/programs/keywords.js";
import { canAct } from "../../../../engine-core/dist/layers/rules/query.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-4a35c75cbe6c3eeae825ce423a2f3dbbdbbbc76b117a9c54735ebc7a7c7c4290";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a unit. Double all damage that would be dealt to it this turn.";

const [hidden, reaction, play] = program.abilities;
const [doubleDamage] = play.body;

test("unl-013-219 Lotus Trap: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-013-219 Lotus Trap: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /replacement\.damage-multiplier/);
  assert.match(program.judgeReason, /433\.1\.b/);
  assert.match(program.judgeReason, /hidden/);
  assert.doesNotMatch(program.judgeReason, /timing 消费方同样未合入|chain timing consumer is missing/);
});

test("unl-013-219 Lotus Trap: Hidden + Reaction keywords plus one doubling replacement on a chosen unit", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  // 355.9.a.3 / 107.3.e: the printed Facedown cost is not rewritten here; the base cost is

  // the printed 2 Energy and the printing has no Power value (catalog power: null).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  assert.equal(Object.hasOwn(play.cost, "power"), false);

  assert.equal(doubleDamage.id, "lotus-trap.double-damage");
  assert.equal(doubleDamage.op, "replacement.damage-multiplier");
  // 433.1.b: doubling damage is the replacement "take double that damage instead".

  assert.deepEqual(doubleDamage.args.event, { kind: "constant", value: "damage" });
  assert.deepEqual(doubleDamage.args.multiplier, { kind: "constant", value: 2 });
  assert.deepEqual(doubleDamage.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(doubleDamage.args.object, {
    kind: "constant",
    value: { target: "lotus-trap.unit" }
  });
  assert.equal(doubleDamage.linkedTo, undefined);
  assert.equal(doubleDamage.picks, undefined);
  // "Choose a unit." is a target, not a replacement-effect object choice (355.10.c).
  assert.deepEqual(doubleDamage.targets, [
    {
      id: "lotus-trap.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("unl-013-219 Lotus Trap: the merged Reaction expansion admits a Closed-State play", () => {
  const source = world().object("lotus-trap", {
    zone: "hand",
    types: ["spell"],
    cardId: CANONICAL_ID
  }).build().getObject("lotus-trap");
  const definition = keywordDefinitionsById.get("Reaction");
  assert.ok(definition, "keywords/Reaction.ts must be registered");
  const [permission] = definition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(permission.effect.kind, "continuous.timing");
  assert.deepEqual(permission.effect.grants, ["showdown", "closed-state"]);
  assert.equal(abilitySpeed(program.abilities, source), "reaction");
  assert.equal(canAct({
    player: "A",
    speed: abilitySpeed(program.abilities, source),
    showdown: false,
    closedState: true,
    turnPlayer: "B",
    priorityHolder: "A",
    grants: permission.effect.grants
  }), true);
});

test.todo("unl-013-219 Lotus Trap: replacement.damage-multiplier — double all damage that would be dealt to the chosen unit this turn (CR 433.1.b / 369.1 / 418.1 / 418.5); the survey (docs/plans/survey/unclassified-unl.md item 9) records it as needs-new-primitive");
test.todo("unl-013-219 Lotus Trap: the [Hidden] expansion must grant the Hide action, the Facedown Zone and the cost-0 facedown play (811 / 107.3 / 422) — cost.hidden has no execution consumer");

