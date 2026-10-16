import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/steraks-gage.js";
// card-dsl 没有到 engine-core 的依赖边（engine-core 依赖 card-dsl），golden 执行测试按
// workspace 布局加载已构建的 engine-core。
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { instructionDefinitionsById } = await import(new URL("effects/instructions/registry.generated.js", ENGINE));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));

const CARD_ID = "card.hash-b9ee923133a3002010f175ddd77b690a710fa21bed8ffaefa29904a936c710ca";
const EXPECTED_SOURCE =
  "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n" +
  "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)";

const [quickDraw, equip] = program.abilities;

/** The merged keyword bodies carry symbolic selectors; the reference kernel binds them. */
function referenceKernelBody(body) {
  return body.map((instruction) => ({
    ...instruction,
    args: Object.fromEntries(
      Object.entries(instruction.args).map(([key, expression]) => [key, { kind: "constant", value: expression }])
    ),
    targets: instruction.targets?.map((target) => ({ ...target, filter: { type: "unit" } }))
  }));
}

/** Run a keyword body inside one primitive transaction, as the merged keyword tests do. */
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
    .object("steraks-gage", {
      name: "Sterak's Gage",
      cardId: CARD_ID,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: ["Calm"]
    })
    .unit("ally", { controller: "A", zone: "board", location: { type: "base", player: "A" }, might: 3 })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("steraks-gage") });
}

test("sfd-056-221 Sterak's Gage: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /equip/);
  assert.match(program.judgeReason, /CostPlanError|Unsupported payment kind/);
  assert.match(program.judgeReason, /Quick-Draw/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("sfd-056-221 Sterak's Gage: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.judgeReason.length > 0, true);
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("sfd-056-221 Sterak's Gage: Quick-Draw plus a valued Calm Equip declaration", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(quickDraw, { kind: "keyword", keyword: "quick-draw" });
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c：印刷费用只有一个 Calm 符文符号（无能量符号）；契约 3.1 的 KeywordAbility 只能
  // 记录印刷符号数，费用组成见 judgeReason 与契约变更请求。
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, undefined);
});

test("sfd-056-221 Sterak's Gage: both keyword expansions are valid EffectIR for this card", () => {
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
  // 819.1.b/c：Quick-Draw 功能上等于固有 [Reaction] 许可加一条打出时的附着触发。
  const quickDrawExpansion = keywordDefinitionsById.get("Quick-Draw").expand({ host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(quickDrawExpansion.map((ability) => ability.kind), ["static", "triggered"]);
  assert.equal(quickDrawExpansion[1].trigger.at, "card-played");
  // 818.1.b/c.2：Equip 功能上等于一条 action 速度的启动式能力。
  const [equipActivation] = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  assert.equal(equipActivation.kind, "activated");
  assert.equal(equipActivation.timing, "action");
});

test("sfd-056-221 Sterak's Gage: the merged attach body really attaches the Gear to a controlled unit", () => {
  const attach = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } })[0].body;
  const kernel = fixture();
  const specId = attach[0].targets[0].id;
  const run = executeBody(referenceKernelBody(attach), kernel, { [specId]: [kernel.ref("ally")] });
  assert.equal(run.outcome.status, "executed");
  assert.equal(kernel.getObject("steraks-gage").attachedTo.id, "ally");
  assert.deepEqual(run.outcome.events.map((event) => event.action), ["attach"]);
});

test("sfd-056-221 Sterak's Gage: an empty Finalize target set ignores the attach instead of attaching elsewhere", () => {
  const attach = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } })[0].body;
  const kernel = fixture();
  const specId = attach[0].targets[0].id;
  const run = executeBody(referenceKernelBody(attach), kernel, { [specId]: [] });
  assert.equal(run.outcome.status, "partial");
  assert.equal(kernel.getObject("steraks-gage").attachedTo, null);
  assert.equal(run.outcome.results[0].result.reason, "mistargeted");
});

test("sfd-056-221 Sterak's Gage: the Equip expansion declares its activation cost as an equip payment", () => {
  // 818.1.c.3：Equip 费用由 Equip 自身的支付种类承载，而不是卡牌层手写的资源数字。
  const [activation] = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(activation.cost.payments.map((payment) => payment.kind), ["equip"]);
});

test.todo(
  "sfd-056-221 Sterak's Gage: paying the printed Equip cost (1 Calm rune, 818.1.c / 818.1.c.3) needs the " +
    "\"equip\" payment kind in cost plan-values (RIFT-89 follow-up) plus the program -> keyword expansion -> chain wiring " +
    "(contract 3.5)"
);
test.todo(
  "sfd-056-221 Sterak's Gage: Quick-Draw's expansion (inherent Reaction timing plus the card-played attach trigger, " +
    "CR 819.1.b-d) needs the continuous.timing layer consumer (RIFT-91) and the program -> TriggerRegistration adapter " +
    "(contract 3.5) before it can fire"
);
