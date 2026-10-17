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
const { translateTriggerFilter } = await import(new URL("programs/filters.js", ENGINE));
const { assertTriggerSpec } = await import(new URL("events/trigger-spec.js", ENGINE));
const { expandProgram } = await import(new URL("programs/keywords.js", ENGINE));
const { createEngineStaticBinder } = await import(new URL("programs/statics.js", ENGINE));
const { actionTimings } = await import(new URL("layers/rules/query.js", ENGINE));
const { ChainEngine } = await import(new URL("chain/engine.js", ENGINE));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", ENGINE));

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

/**
 * A real ChainEngine + EventPipeline wired to the reference kernel, so the
 * static-binding and timing-query evidence below exercises the production
 * program layer rather than a card-local stub.
 */
function bindingFixture() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
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
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: () => { throw new Error("the timing evidence must not require a choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host });
  return { engine, kernel, source: kernel.getObject("steraks-gage") };
}

test("sfd-056-221 Sterak's Gage: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /equip/);
  assert.match(program.judgeReason, /CostPlanError|Unsupported payment kind/);
  assert.match(program.judgeReason, /Quick-Draw/);
  assert.match(program.judgeReason, /abilitySpeed|actionTimings/);
  assert.match(program.judgeReason, /continuous\.timing/);
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

test("sfd-056-221 Sterak's Gage: Quick-Draw translates to a closed card-played trigger", () => {
  // The merged program binding translates Quick-Draw's source anchor into an
  // EventPattern, and card-played is in the closed event vocabulary. The only
  // card-level blocker is the Equip payment described by judgeReason.
  const expansion = keywordDefinitionsById.get("Quick-Draw").expand({ host: { canonicalCardId: CARD_ID } });
  const spec = {
    at: expansion[1].trigger.at,
    filter: translateTriggerFilter(expansion[1].trigger.filter, "steraks", expansion[1].trigger.at)
  };
  assert.doesNotThrow(() => assertTriggerSpec(spec));
});

test("sfd-056-221 Sterak's Gage: Quick-Draw declares its Reaction timing grant", () => {
  const source = {
    cardId: CARD_ID,
    keywords: [{ id: "Quick-Draw" }],
    ref: { id: "steraks-gage", zoneEntryId: 1 }
  };
  const expanded = expandProgram(program, source);
  const timing = expanded.abilities.find((ability) => ability.kind === "static");
  assert.deepEqual(timing?.effect, {
    kind: "continuous.timing",
    value: { kind: "constant", value: "reaction" },
    source: { canonicalCardId: CARD_ID },
    scope: "source",
    permissions: ["play", "attach"]
  });
});

test("sfd-056-221 Sterak's Gage: the declared Reaction grant produces no consumable timing", () => {
  // Live evidence for judgeReason (2): the merged continuous.timing primitive
  // accepts grants/timings/appliesTo, while the Quick-Draw expansion writes
  // value/source/scope/permissions. The static effect registers into the ability
  // layer but grants nothing, so the Chain's timing query cannot see Reaction.
  const harness = bindingFixture();
  const { engine, kernel, source } = harness;
  const binder = createEngineStaticBinder(engine);
  const timings = [];
  for (const ability of expandProgram(program, source).abilities) {
    if (ability.kind !== "static") continue;
    binder.bindStatic(ability, source);
    timings.push(...actionTimings(engine.layers.registry, source.ref, source, "A"));
  }

  assert.deepEqual(engine.layers.registry.list().map((entry) => entry.effect.effect.kind), ["continuous.timing"]);
  assert.deepEqual(timings, [], "the merged query must not see a Reaction grant");
  assert.deepEqual(engine.layers.registry.list()[0].effect.effect.grants, undefined);
});

test("sfd-056-221 Sterak's Gage: the sibling Action/Reaction expansions are rejected by the static binder", () => {
  // The speed-keyword family shares the same blocker: their static filters use
  // appliesTo: ["card", "activated-ability"], which the merged static binder
  // refuses, so no Action/Reaction permission is installed today.
  const { engine, source } = bindingFixture();
  const binder = createEngineStaticBinder(engine);

  for (const keyword of ["Action", "Reaction"]) {
    const [ability] = keywordDefinitionsById.get(keyword).expand({ host: { canonicalCardId: CARD_ID } });
    assert.throws(
      () => binder.bindStatic(ability, source),
      /Unsupported static appliesTo/,
      `${keyword} must fail closed instead of granting an unconsumed permission`
    );
  }
});

test.todo(
  "sfd-056-221 Sterak's Gage: the printed Quick-Draw Reaction timing must be consumed by the production canAct path, " +
    "including the static timing registration when the card is played"
);
