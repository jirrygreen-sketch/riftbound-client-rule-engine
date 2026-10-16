import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/towering-combatant.js";

const CANONICAL_ID =
  "card.hash-954548f2a1317ac2bc2954489da0730ecf613acc22887c0dc6c46d250c025391";
const SOURCE_TEXT =
  "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
  "[Tank] (I must be assigned combat damage first.)";

const [shield, tank] = program.abilities;

test("unl-099-219 Towering Combatant: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-099-219 Towering Combatant: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /814/);
  assert.match(program.judgeReason, /815/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /base-combat-allocation/);
});

test("unl-099-219 Towering Combatant: both printed lines are keyword declarations only", () => {
  assert.equal(program.abilities.length, 2);
  // 814.1.b.1 / 814.1.b.2: Shield 2 carries its printed Shield Value.
  assert.deepEqual(shield, { kind: "keyword", keyword: "shield", value: 2 });
  // 815.1: Tank carries no value (815.2: multiple instances are redundant).
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
});

test("unl-099-219 Towering Combatant: the reminders are not re-authored as instructions", () => {
  // README §5: the bracketed keyword plus its reminder is one keyword entry;
  // no effect.* instruction, target or static numeric bonus is invented here.
  for (const ability of program.abilities) {
    assert.equal(ability.body, undefined);
    assert.equal(ability.effect, undefined);
    assert.equal(ability.trigger, undefined);
  }
});

test("unl-099-219 Towering Combatant: Shield's expansion exists, Tank's does not", async () => {
  const { keywordDefinitionsById } = await import(
    "../../../../engine-core/dist/effects/keywords/registry.generated.js"
  );
  assert.equal(keywordDefinitionsById.has("Shield"), true);
  assert.equal(keywordDefinitionsById.has("Tank"), false);
  // 814.2 / 815.2: Shield sums, Tank is redundant.
  assert.equal(keywordDefinitionsById.get("Shield").stacking, "sum");
});

test("unl-099-219 Towering Combatant: the merged layer engine still records an equivalent restriction-free +2 shape only", async () => {
  // Concrete evidence for the judgeReason: the Shield expansion is a static
  // continuous.might effect gated on the Defender designation, and the layer
  // engine's conditionMatches never evaluates that `compare` condition — so
  // registering it today would add +2 unconditionally.
  const { default: shieldDefinition } = await import(
    "../../../../engine-core/dist/effects/keywords/Shield.js"
  );
  const [expansion] = shieldDefinition.expand({ value: 2, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 2 });
  assert.equal(expansion.condition.kind, "compare");
  assert.equal(expansion.condition.operator, "eq");
  assert.deepEqual(expansion.condition.right, { kind: "constant", value: "defender" });

  const { createLayerEngine } = await import("../../../../engine-core/dist/layers/index.js");
  const unit = {
    ref: { id: "towering-combatant", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "Towering Combatant",
    types: ["unit"],
    tags: ["Shurima"],
    keywords: [{ id: "Shield", value: 2 }],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    might: 3,
    energy: 4,
    power: ["Body"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const engine = createLayerEngine([unit], [
    {
      effect: {
        id: "towering-combatant.shield",
        layer: "arithmetic",
        filter: { object: "self" },
        source: unit.ref,
        effect: { ...expansion.effect, condition: expansion.condition }
      },
      duration: { type: "permanent" },
      timestamp: 1
    }
  ]);
  engine.setObjects([unit]);
  // The Defender designation is not a merged characteristic and the layer
  // engine cannot evaluate the compare condition, so the +2 is applied with no
  // defending state at all — the concrete reason the card stays judge-required.
  assert.equal(engine.evaluate(unit.ref).might, 5);
});

test.todo(
  "unl-099-219 Towering Combatant: register the Shield 2 static effect as a ContinuousEffectSpec and honour its 'I'm a defender' condition (contract 3.8 combatRole + RIFT-91 card wiring + layer condition evaluation)"
);
test.todo(
  "unl-099-219 Towering Combatant: execute [Tank] by binding the 815.1.b / 815.1.c.1-.2 combat-damage assignment requirement — effects/keywords has no Tank KeywordDef and combat/base-combat-allocation.ts binds no assignment priority"
);
