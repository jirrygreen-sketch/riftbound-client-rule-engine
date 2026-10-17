import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/experimental-hexplate.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { translateObjectFilter } = await import(new URL("programs/filters.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));

const CARD_ID = "card.hash-f9773189acce6bbb236b5fe609b108079a3b1b13064783ef685543fb56e8e969";
const EXPECTED_SOURCE = "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)";

const [equip] = program.abilities;

// Preserve the expanded TargetSpec and bind self as the chain query does.
function controllerContext(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") return filter => {
        const normalized = translateObjectFilter(filter);
        if (normalized.controller === "self") normalized.controller = target.controller;
        return target.query(normalized);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function fixture() {
  const kernel = world()
    .object("experimental-hexplate", {
      name: "Experimental Hexplate",
      cardId: CARD_ID,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 1,
      power: null,
      might: 1
    })
    .unit("ally", { controller: "A", zone: "board", location: { type: "base", player: "A" }, might: 2 })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("experimental-hexplate") });
}

test("sfd-073-221 Experimental Hexplate: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /equip/);
  assert.match(program.judgeReason, /CostPlanError/);
  assert.match(program.judgeReason, /Unsupported payment kind/);
  assert.match(program.judgeReason, /818\.1\.c\.3/);
});

test("sfd-073-221 Experimental Hexplate: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("sfd-073-221 Experimental Hexplate: a single valued Mind Equip declaration", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c：印刷费用只有一个 Mind 符文符号（无能量符号）。
  assert.equal(equip.value, 1);
  assert.deepEqual(equip, { kind: "keyword", keyword: "equip", value: 1 });
});

test("sfd-073-221 Experimental Hexplate: the merged Equip expansion is valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

  // 818.1.c.2：展开功能上等于「[费用]: Attach this to a unit you control.」
  const expansion = definition.expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "judge-required",
    judgeReason: "expanded structure probe",
    abilities: expansion,
    sourceText: EXPECTED_SOURCE
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);

  const [ability] = expansion;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.payments.map((payment) => payment.kind), ["equip"]);
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

test("sfd-073-221 Experimental Hexplate: the merged attach body really attaches the Gear to a controlled unit", () => {
  const attach = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } })[0].body;
  const kernel = fixture();
  const specId = attach[0].targets[0].id;
  kernel.setTargets(specId, [kernel.ref("ally")]);
  const outcome = resolveChainBody(attach, controllerContext(kernel));
  assert.equal(outcome.status, "executed");
  // 818.1.b.2：所选单位成为 Attach 的 Top-Most Card。
  assert.deepEqual(kernel.getObject("experimental-hexplate").attachedTo, kernel.ref("ally"));
  assert.deepEqual(outcome.events.map((event) => event.action), ["attach"]);
});

test("sfd-073-221 Experimental Hexplate: the Equip expansion declares its activation cost as an equip payment", () => {
  const [activation] = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(activation.cost.payments.map((payment) => payment.kind), ["equip"]);
});

test.todo(
  "sfd-073-221 Experimental Hexplate: bind the printed Mind Equip cost through KeywordAbility, " +
    "programs/keywords.ts and Equip.expand(params.cost), then pay it during activation (818.1.c.2/.3)"
);

test("sfd-073-221 Experimental Hexplate golden: the expanded target excludes an opponent unit", () => {
  const base = world()
    .object("hexplate", { types: ["gear"], zone: "board" })
    .unit("enemy", { controller: "B" })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("hexplate") });
  kernel.setTargets("equip-target", [kernel.ref("enemy")]);
  const [activation] = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  const outcome = resolveChainBody(activation.body, controllerContext(kernel));
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("hexplate").attachedTo, null);
});
