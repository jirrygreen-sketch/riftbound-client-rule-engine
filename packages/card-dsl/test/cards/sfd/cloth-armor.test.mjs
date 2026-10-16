import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/cloth-armor.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { instructionDefinitionsById } = await import(new URL("effects/instructions/registry.generated.js", ENGINE));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));

const CARD_ID = "card.hash-4cea7af35d00d653a3ecebd33dde5212a7ce582deb4a293fcdaf8fd6acdd293c";
const EXPECTED_SOURCE =
  "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n" +
  "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)";

const [quickDraw, equip] = program.abilities;

function referenceKernelBody(body) {
  return body.map((instruction) => ({
    ...instruction,
    args: Object.fromEntries(
      Object.entries(instruction.args).map(([key, expression]) => [key, { kind: "constant", value: expression }])
    ),
    targets: instruction.targets?.map((target) => ({ ...target, filter: { type: "unit" } }))
  }));
}

function executeBody(body, kernel, targets) {
  let outcome;
  const wrapper = {
    op: "test.card-keyword-body",
    argsSchema: { parse: (value) => value },
    execute(context) {
      outcome = runAbilityBody(body, context, instructionDefinitionsById);
      return { status: "executed", events: [...outcome.events] };
    }
  };
  const run = runInstruction(wrapper, {}, { world: kernel, targets });
  return { ...run, outcome };
}

function fixture() {
  const kernel = world()
    .object("cloth-armor", {
      name: "Cloth Armor",
      cardId: CARD_ID,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 1,
      power: null
    })
    .unit("ally", { controller: "A", zone: "board", location: { type: "base", player: "A" }, might: 2 })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("cloth-armor") });
}

test("sfd-064-221 Cloth Armor: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /equip/);
  assert.match(program.judgeReason, /Unsupported payment kind/);
  assert.match(program.judgeReason, /Quick-Draw/);
});

test("sfd-064-221 Cloth Armor: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("sfd-064-221 Cloth Armor: Quick-Draw plus a valued Mind Equip declaration", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(quickDraw, { kind: "keyword", keyword: "quick-draw" });
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c：印刷费用只有一个 Mind 符文符号（无能量符号）。
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, undefined);
});

test("sfd-064-221 Cloth Armor: both keyword expansions are valid EffectIR for this card", () => {
  for (const [keyword, value] of [["Quick-Draw", undefined], ["Equip", equip.value]]) {
    const definition = keywordDefinitionsById.get(keyword);
    assert.ok(definition, `effects/keywords/${keyword}.ts must be registered`);
    const expansion = definition.expand({
      ...(value === undefined ? {} : { value }),
      host: { canonicalCardId: CARD_ID }
    });
    const expanded = validateCardProgram({
      canonicalCardId: CARD_ID,
      rulesetVersion: EFFECT_IR_V2_RULESET,
      status: "judge-required",
      judgeReason: "expanded structure probe",
      abilities: expansion,
      sourceText: EXPECTED_SOURCE
    });
    assert.deepEqual(expanded.issues, [], keyword);
    assert.equal(expanded.ok, true, keyword);
  }
  // 819.1.b/c：Quick-Draw 的固有 [Reaction] 许可加打出附着触发。
  const expansion = keywordDefinitionsById.get("Quick-Draw").expand({ host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(expansion.map((ability) => ability.kind), ["static", "triggered"]);
  assert.deepEqual(expansion[1].trigger.filter, {
    event: "card-played",
    source: { canonicalCardId: CARD_ID }
  });
});

test("sfd-064-221 Cloth Armor: the merged attach body really attaches the Gear to a controlled unit", () => {
  const attach = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } })[0].body;
  const kernel = fixture();
  const specId = attach[0].targets[0].id;
  const run = executeBody(referenceKernelBody(attach), kernel, { [specId]: [kernel.ref("ally")] });
  assert.equal(run.outcome.status, "executed");
  assert.equal(kernel.getObject("cloth-armor").attachedTo.id, "ally");
  assert.deepEqual(run.outcome.events.map((event) => event.action), ["attach"]);
});

test("sfd-064-221 Cloth Armor: the Equip expansion declares its activation cost as an equip payment", () => {
  const [activation] = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(activation.cost.payments.map((payment) => payment.kind), ["equip"]);
});

test.todo(
  "sfd-064-221 Cloth Armor: paying the printed Equip cost (1 Mind rune, 818.1.c) needs the \"equip\" payment kind " +
    "in cost plan-values (RIFT-89 follow-up) plus the program -> keyword expansion -> chain wiring (contract 3.5)"
);
test.todo(
  "sfd-064-221 Cloth Armor: Quick-Draw's expansion (CR 819.1.b-d) needs the continuous.timing layer consumer (RIFT-91) " +
    "and the program -> TriggerRegistration adapter (contract 3.5)"
);
