// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/mutated-mouser.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-772d03e9b0b696718afe836a8028877765e2a10ff2fd39781dc7d52e3b05e8b8";
const SOURCE_TEXT =
  "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
  "[Tank] (I must be assigned combat damage first.)";

const [shield, tank] = program.abilities;

test("unl-036-219 Mutated Mouser: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-036-219 Mutated Mouser: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The reason names the designation condition and combat allocation consumers.
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /designation 条件仍不可求值/);
  assert.match(program.judgeReason, /MissingInformation/);
  assert.match(program.judgeReason, /814\.1\.d/);
  assert.match(program.judgeReason, /815\.1\.c/);
  // The mapping exists only in the unwired expr-ext module, and the reason must
  // refuse an unconditional +2.
  assert.match(program.judgeReason, /expr-ext/);
  assert.match(program.judgeReason, /不能无条件 \+2/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+|未进 HEAD/);
});

test("unl-036-219 Mutated Mouser: the card only declares Shield 2 and Tank (contract 3.7)", () => {
  assert.equal(program.abilities.length, 2);
  // 814.1.b.2：印刷的 Shield Value 是 2。
  assert.deepEqual(shield, { kind: "keyword", keyword: "shield", value: 2 });
  // 815.1.b / 815.2：Tank 无数值，多实例冗余。
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  assert.equal(tank.value, undefined);
  // 卡文件不重写关键词展开：没有手写的 static / replacement 能力。
  assert.equal(program.abilities.some((ability) => ability.kind === "static"), false);
  assert.equal(program.abilities.some((ability) => ability.kind === "replacement"), false);
});

test("unl-036-219 Mutated Mouser: the merged Shield and Tank expansions match the printed reminder text", () => {
  const shieldDef = keywordDefinitionsById.get("Shield");
  const tankDef = keywordDefinitionsById.get("Tank");
  assert.ok(shieldDef, "the merged Shield KeywordDef is registered (CR 814)");
  assert.ok(tankDef, "the merged Tank KeywordDef is registered (CR 815)");
  assert.equal(shieldDef.stacking, "sum");
  assert.equal(tankDef.stacking, "single");

  // 814.1.c：Shield 2 展开成“当我是防守方时 +2 [M]”的条件图层修正。
  const [shieldExpansion] = shieldDef.expand({ value: 2, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(shieldExpansion.kind, "static");
  assert.equal(shieldExpansion.effect.kind, "continuous.might");
  assert.deepEqual(shieldExpansion.effect.amount, { kind: "constant", value: 2 });
  // 814.1.d：展开仍读 designation，快照已有 combatRole；缺字段映射。
  assert.equal(shieldExpansion.condition.left.property, "designation");
  assert.deepEqual(shieldExpansion.condition.right, { kind: "constant", value: "defender" });

  // 815.1.c：Tank 展开成战斗伤害分配优先级要求（continuous.combat），无层/战斗消费方。
  const [tankExpansion] = tankDef.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(tankExpansion.kind, "static");
  assert.equal(tankExpansion.effect.kind, "continuous.combat");
  assert.equal(tankExpansion.effect.priority, "first");
});

test.todo(
  "unl-036-219 Mutated Mouser: evaluate the Defender designation in the arithmetic layer so Shield 2 applies " +
    "only while defending (CR 814.1.d/814.1.d.1) by mapping designation to combatRole and producing combat roles"
);
test.todo(
  "unl-036-219 Mutated Mouser: consume [Tank]'s lethal-first priority while assigning combat damage " +
    "(CR 815.1.b/815.1.c.1/.c.2) in the combat allocation workflow"
);

test("unl-036-219 Mutated Mouser golden: the Shield 2 condition fails closed in every combat role", async () => {
  // 814.1.c/814.1.d: the expansion is "+2 Might while I am a defender", and the
  // production static binder evaluates that condition once with the live
  // snapshot. Because the snapshot carries combatRole while the authored
  // property (and the default evaluator) reads "designation", the predicate
  // answers false for attacker, defender and no-role alike — so a defender gets
  // no Might at all rather than Shield being applied unconditionally.
  const { createProgramBinding, createEngineStaticBinder } = await import("../../../../engine-core/dist/programs/index.js");
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");

  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [{ id: "mouser", cardId: CANONICAL_ID, types: ["unit"], energy: 2, power: [], might: 1 }]
  });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("mouser"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  const base = f.kernel.getObject("mouser");
  const binder = createEngineStaticBinder(f.engine);

  for (const role of ["attacker", "defender", null]) {
    const source = { ...base, combatRole: role };
    f.engine.layers.setObjects([source]);
    const handles = binding.inspect(source).abilities
      .filter(ability => ability.kind === "static")
      .map(ability => binder.bindStatic(ability, source));
    const [registration] = f.engine.layers.registry.list();
    assert.equal(typeof registration.effect.effect.condition, "function");
    assert.equal(registration.effect.effect.condition(source), false, `Shield condition for ${role}`);
    // 814.1.c: the printed Might 1 is unchanged, never +2 by accident.
    assert.equal(f.engine.layers.evaluate(source.ref).might, 1);
    for (const handle of handles) handle.unbind();
  }
});

test("unl-036-219 Mutated Mouser golden: Tank's continuous.combat binds but changes no evaluated snapshot", async () => {
  // 815.1.c/.c.1/.c.2: the merged binder accepts the keyword's declarative
  // registration (ability layer) yet the layer engine has no continuous.combat
  // branch, so the requirement cannot order damage assignment.
  const { createProgramBinding, createEngineStaticBinder } = await import("../../../../engine-core/dist/programs/index.js");
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [{ id: "mouser", cardId: CANONICAL_ID, types: ["unit"], energy: 2, power: [], might: 1 }]
  });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("mouser"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  const source = f.kernel.getObject("mouser");
  f.engine.layers.setObjects([source]);
  const binder = createEngineStaticBinder(f.engine);
  const [tankExpansion] = tankDef().expand({ host: { canonicalCardId: CANONICAL_ID } });
  const handle = binder.bindStatic(tankExpansion, source);
  const [registration] = f.engine.layers.registry.list();
  assert.equal(registration.effect.effect.kind, "continuous.combat");
  assert.equal(registration.effect.effect.priority, "first");
  // No layer branch consumes it: neither Might nor keywords move.
  const evaluated = f.engine.layers.evaluate(source.ref);
  assert.equal(evaluated.might, 1);
  assert.deepEqual(evaluated.keywords, []);
  handle.unbind();
});

function tankDef() { return keywordDefinitionsById.get("Tank"); }

test("unl-036-219 Mutated Mouser: every declared keyword resolves to a merged KeywordDef (contract 3.5/3.7)", () => {
  // The card only declares keywords; programs/keywords.ts's expandProgram is the
  // merged consumer that resolves each declaration through the registry. A
  // declaration with no KeywordDef throws ProgramBindingError there, so this
  // pins the card's contract-3.7 surface against the merged registry.
  for (const ability of program.abilities) {
    assert.equal(ability.kind, "keyword");
    const definition = [...keywordDefinitionsById.entries()]
      .find(([id, def]) => id.toLowerCase() === ability.keyword.toLowerCase()
        || def.keyword.toLowerCase() === ability.keyword.toLowerCase());
    assert.ok(definition, `the merged registry must define ${ability.keyword}`);
  }
  // 814.1.b.2: the printed Shield Value is 2, carried by the card declaration.
  assert.equal(shield.value, 2);
  // 815.1.b / 815.2: Tank carries no value and is redundant in multiples.
  assert.equal(tank.value, undefined);
});
