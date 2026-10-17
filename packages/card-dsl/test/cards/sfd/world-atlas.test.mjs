import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/world-atlas.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { describeActivate, expandProgram } from "../../../../engine-core/dist/programs/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";

const CARD_ID = "card.hash-2d067a6d3e2dbc9738ed7868ad7bea2727fdc69a8074c639e913e6360798d27c";
const EXPECTED_SOURCE = "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)";

const [equip] = program.abilities;

const equipActivation = () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  const [activation] = definition.expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  return activation;
};

function fixture() {
  return world()
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
}

// Card filters spell the ability controller "self"; the reference kernel matches
// filter values literally, so the production object matcher runs with the
// resolved controller exactly as chain/engine.ts resolves it.
const productionContext = (kernel) => bindResolveContext(kernel, {
  source: kernel.getObject("world-atlas"),
  sourceSnapshot: kernel.getObject("world-atlas"),
  controller: "A",
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [
      key,
      (key === "controller" || key === "owner") && value === "self" ? "A" : value
    ])),
    object
  ))
});

test("sfd-086-221 World Atlas: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(CARD_ID), program);
  // README section 2: the reason states only the current gaps against merged source.
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /kind: "equip"/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /818\.1/);
  assert.match(program.judgeReason, /818\.2/);
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
  assert.equal(equip.costDomain, "Mind");
});

test("sfd-086-221 World Atlas: the merged Equip expansion targets a controlled unit", () => {
  const activation = equipActivation();
  assert.equal(activation.kind, "activated");
  // 818.1.b.1：选择的单位是 Target；818.1.b/c.2 限你控制的单位。
  assert.deepEqual(activation.body[0].targets, [
    {
      id: "equip-target",
      filter: { type: "unit", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("sfd-086-221 World Atlas: production keyword expansion drops the printed Equip cost", () => {
  // 818.1.c: the printed "Equip [Mind]" is an activation cost. The merged
  // ExpandInput params.cost entry exists (contract 3.8 item 3), but
  // programs/keywords.ts only passes value/host, so the expanded ability keeps
  // the unmapped { kind: "equip" } placeholder instead of a Mind Power cost.
  const kernel = fixture();
  const source = kernel.getObject("world-atlas");
  const { judgeReason: _reason, ...executableProbe } = program;
  const [activation] = expandProgram({ ...executableProbe, status: "executable" }, source).expanded;
  assert.equal(activation.kind, "activated");
  assert.deepEqual(activation.cost, {
    kind: "activated",
    payments: [{ kind: "equip", value: { kind: "constant", value: { kind: "source" } } }]
  });
  // The authored value/costDomain are descriptive only; no CostSpec/evaluable
  // payment amount is bound for the printed Mind Power rune.
  assert.equal(JSON.stringify(activation.cost).includes("Mind"), false);
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Mind");
});

test("sfd-086-221 World Atlas: the production activate draft still reaches an unsupported payment kind", () => {
  // 818.1.b/818.1.c.2: the Equip activation must pay its printed cost before
  // Attach. The real card-program adapter produces the draft, and the merged
  // cost planner rejects the { kind: "equip" } payment outright, so Finalize
  // cannot pay the activation.
  const kernel = fixture();
  const source = kernel.getObject("world-atlas");
  const { judgeReason: _reason, ...executableProbe } = program;
  const draft = describeActivate(new ProgramRegistry([{ ...executableProbe, status: "executable" }]), source, "A");
  assert.equal(draft.kind, "activated");
  assert.deepEqual(draft.cost.cost, {
    kind: "activated",
    payments: [{ kind: "equip", value: { kind: "constant", value: { kind: "source" } } }]
  });
  assert.throws(
    () => buildCostPlan(productionContext(kernel), {
      id: "cost:world-atlas-equip",
      cost: draft.cost.cost,
      domains: ["Mind"]
    }),
    error => error instanceof CostPlanError && error.reason === "judge-required" &&
      /Unsupported payment kind: equip/.test(error.message)
  );
});

test("sfd-086-221 World Atlas golden: the merged attach body really attaches the Gear to a controlled unit", () => {
  const activation = equipActivation();
  const kernel = fixture();
  const [attach] = activation.body;
  const specId = attach.targets[0].id;
  kernel.setTargets(specId, [kernel.ref("ally")]);
  // The chain adapter preserves the primitive's own arg expressions while the
  // host is bound to the live Gear instance, so the expansion body runs through
  // the real production path.
  const outcome = resolveChainBody([attach], productionContext(kernel));
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.getObject("world-atlas").attachedTo, kernel.ref("ally"));
  assert.deepEqual(outcome.events.map((event) => event.action), ["attach"]);
  // 818.2 / 818.2.a：Attach 完成是可被游戏效果与触发能力引用的对象附着事件。
  assert.equal(outcome.events[0].type, "task-resolved");
});

test.todo(
  "World Atlas: carry the printed Mind Equip CostSpec through KeywordAbility/params.cost and " +
    "replace the { kind: " + JSON.stringify("equip") + " } payment with the real one Mind Power activation " +
    "cost so Finalize can pay it (818.1.b/818.1.c; cost/plan-values.ts still blocks the equip kind)"
);
