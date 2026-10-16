import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/world-atlas.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { instructionDefinitionsById } = await import(new URL("effects/instructions/registry.generated.js", ENGINE));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));

const CARD_ID = "card.hash-2d067a6d3e2dbc9738ed7868ad7bea2727fdc69a8074c639e913e6360798d27c";
const EXPECTED_SOURCE = "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)";

const [equip] = program.abilities;

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
    .object("world-atlas", {
      name: "World Atlas",
      cardId: CARD_ID,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: null,
      might: 2
    })
    .unit("ally", { controller: "A", zone: "board", location: { type: "base", player: "A" }, might: 2 })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("world-atlas") });
}

test("sfd-086-221 World Atlas: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /equip/);
  assert.match(program.judgeReason, /Unsupported payment kind/);
});

test("sfd-086-221 World Atlas: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("sfd-086-221 World Atlas: a single valued Mind Equip declaration", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c：印刷费用只有一个 Mind 符文符号（无能量符号）。
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, undefined);
});

test("sfd-086-221 World Atlas: the merged Equip expansion targets a controlled unit", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  const [ability] = definition.expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  assert.equal(ability.kind, "activated");
  // 818.1.b.1：选择的单位是 Target；818.1.b/c.2 限你控制的单位。
  assert.deepEqual(ability.body[0].targets, [
    {
      id: "equip-target",
      filter: { type: "unit", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("sfd-086-221 World Atlas: the merged attach body really attaches the Gear to a controlled unit", () => {
  const attach = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } })[0].body;
  const kernel = fixture();
  const specId = attach[0].targets[0].id;
  const run = executeBody(referenceKernelBody(attach), kernel, { [specId]: [kernel.ref("ally")] });
  assert.equal(run.outcome.status, "executed");
  assert.deepEqual(kernel.getObject("world-atlas").attachedTo, kernel.ref("ally"));
  assert.deepEqual(run.outcome.events.map((event) => event.action), ["attach"]);
  // 818.2 / 818.2.a：Attach 完成是可被游戏效果与触发能力引用的对象附着事件。
  assert.equal(run.outcome.events[0].type, "task-resolved");
});

test("sfd-086-221 World Atlas: the Equip expansion declares its activation cost as an equip payment", () => {
  const [activation] = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(activation.cost.payments.map((payment) => payment.kind), ["equip"]);
});

test.todo(
  "sfd-086-221 World Atlas: paying the printed Equip cost (1 Mind rune, 818.1.c) needs the \"equip\" payment kind " +
    "in cost plan-values (RIFT-89 follow-up) plus the program -> keyword expansion -> chain wiring (contract 3.5)"
);
