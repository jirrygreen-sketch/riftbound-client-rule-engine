import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/solari-sunhawk.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { finalizeTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-b50ebe7425cbcc3607642935536039f10f7ddfeb4a0537dbf96c5aac8f96a4ad";
const SOURCE_TEXT =
  "[Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +1 :rb_might: and [Deflect 2]. (Opponents must pay " +
  ":rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)";

const [empower, mightGrant, deflectGrant] = program.abilities;

test("ven-122-166 Solari Sunhawk: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-122-166 Solari Sunhawk: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /828\.1\.b\.1/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /Unsupported cost kind: empower/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91|RIFT-90|RIFT-593/);
});

test("ven-122-166 Solari Sunhawk: [Empower] is declared, never re-implemented (contract 3.7)", () => {
  assert.equal(program.abilities.length, 3);
  // 827.1.c.1 的“2 Energy：Empower me”是关键词展开；印刷费由关键词承载，卡文件不写
  // 第二条启动能力（及 golden 不断言 KeywordDef 缺席——依赖落地后会失效）。
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
});

test("ven-122-166 Solari Sunhawk: the [Empowered] dependent clause grants +1 Might and Deflect 2 to self", () => {
  // 828.1.b.1：整段【Empowered】能力功能等价于“当我拥有 Empowered 状态时，此牌获得 [Text]”。
  assert.equal(mightGrant.kind, "static");
  assert.equal(mightGrant.effect.kind, "continuous.might");
  assert.equal(mightGrant.effect.mode, "add");
  assert.equal(mightGrant.effect.layer, "arithmetic");
  assert.equal(mightGrant.effect.appliesTo, "self");
  assert.deepEqual(mightGrant.effect.amount, { kind: "constant", value: 1 });
  // 442.1.a 的 Empowered 状态没有可求值谓词：用显式谓词字符串占位，不手写状态判定。
  assert.deepEqual(mightGrant.condition, {
    kind: "expression",
    value: { kind: "constant", value: "empowered" }
  });

  // 814.1.b.2/814.1.b.3：印刷值 2；展开由 effects/keywords/Deflect.ts 负责。
  assert.equal(deflectGrant.kind, "static");
  assert.deepEqual(deflectGrant.effect, {
    kind: "continuous.grant-keyword",
    appliesTo: "self",
    keywords: [{ id: "deflect", value: 2 }]
  });
  assert.deepEqual(deflectGrant.condition, mightGrant.condition);
});

test("ven-122-166 Solari Sunhawk golden: the declared +1 Might produces an arithmetic-layer bonus", () => {
  // RIFT-91 的 layers 引擎已合入求值侧：用该卡声明的 amount/appliesTo 形状做真实求值，
  // 证明“+1 Might”在算术图层里有实际产出。它不证明 Empowered 门控或卡牌注册已接通。
  const kernel = world()
    .unit("sunhawk", {
      controller: "controller",
      might: 3,
      types: ["unit"],
      location: { type: "base", player: "controller" }
    })
    .build()
    .clone({ controller: "controller" });
  const snapshot = kernel.getObject("sunhawk");
  const engine = createLayerEngine([snapshot], [
    {
      effect: {
        id: "solari-sunhawk.might",
        layer: "arithmetic",
        source: snapshot.ref,
        filter: { objectId: "sunhawk" },
        effect: {
          kind: "continuous.might",
          mode: mightGrant.effect.mode,
          amount: mightGrant.effect.amount
        }
      },
      duration: { type: "permanent" },
      timestamp: 1,
      sequence: 1
    }
  ]);
  assert.equal(engine.evaluate(snapshot.ref).might, 4);
});

test("ven-122-166 Solari Sunhawk golden: the declared Deflect 2 is added to the layered keyword list", () => {
  const kernel = world()
    .unit("sunhawk", {
      controller: "controller",
      might: 3,
      types: ["unit"],
      location: { type: "base", player: "controller" }
    })
    .build()
    .clone({ controller: "controller" });
  const snapshot = kernel.getObject("sunhawk");
  const [granted] = deflectGrant.effect.keywords;
  const engine = createLayerEngine([snapshot], [
    {
      effect: {
        id: "solari-sunhawk.deflect",
        layer: "ability",
        source: snapshot.ref,
        filter: { objectId: "sunhawk" },
        effect: {
          kind: "grant-keyword",
          keyword: granted.id,
          value: granted.value
        }
      },
      duration: { type: "permanent" },
      timestamp: 1,
      sequence: 1
    }
  ]);
  assert.deepEqual(engine.evaluate(snapshot.ref).keywords, [{ id: "deflect", value: 2 }]);
});

test("ven-122-166 Solari Sunhawk gap: the printed 2 Energy never reaches the Empower expansion", () => {
  // Contract 3.1's KeywordAbility carries only keyword/value and
  // programs/keywords.ts calls def.expand({ value, host }) without params.cost
  // (contract 3.8.3), so the merged KeywordDef falls back to { kind: "empower" }.
  const kernel = world().unit("sunhawk", { cardId: CANONICAL_ID }).build();
  const expanded = expandProgram(program, kernel.getObject("sunhawk"));
  const [empowerAbility] = expanded.expanded.filter(ability => ability.kind === "activated");
  assert.deepEqual(empowerAbility.cost, { kind: "empower" });
  assert.throws(
    () => buildCostPlan(kernel, { id: "solari-sunhawk", cost: empowerAbility.cost }),
    /Unsupported cost kind: empower/
  );
});

test("ven-122-166 Solari Sunhawk gap: the Empowered gate is not enforced by the layer engine", () => {
  // 442.1.a: the frozen ObjectSnapshot carries no empowered characteristic, so
  // the authored expression condition cannot read the status. The merged
  // conditionMatches falls through to true and the +1 Might applies anyway.
  const kernel = world().unit("sunhawk", {
    controller: "controller", might: 3, location: { type: "base", player: "controller" }
  }).build();
  const source = kernel.getObject("sunhawk");
  const engine = createLayerEngine([source], [{
    effect: {
      id: "solari-sunhawk.gate",
      layer: "arithmetic",
      source: source.ref,
      filter: { objectId: "sunhawk" },
      effect: { kind: "continuous.might", mode: mightGrant.effect.mode, amount: mightGrant.effect.amount, condition: mightGrant.condition }
    },
    duration: { type: "permanent" },
    timestamp: 1,
    sequence: 1
  }]);
  assert.equal(engine.evaluate(source.ref).might, 4);
});

test("ven-122-166 Solari Sunhawk gap: layered Deflect 2 produces no target tax", () => {
  // 809.1.c/809.1.c.1: the keyword reaches the layered keyword list, but no
  // merged producer turns it into a TargetTaxRequest, and the chain's
  // finalizeTargetPlan call passes no tax option, so the choice is free.
  const kernel = world()
    .unit("sunhawk", { owner: "B", controller: "B", might: 3, keywords: [{ id: "deflect", value: 2 }] })
    .build();
  const requests = [];
  const plan = finalizeTargetPlan(
    kernel,
    { id: "spell-target", filter: { type: "unit" }, min: 1, max: 1, selection: "one" },
    { selected: [kernel.ref("sunhawk")], taxAdapter: { appendTargetTax: request => { requests.push(request); return { status: "appended" }; } } }
  );
  assert.deepEqual(plan.selected, [kernel.ref("sunhawk")]);
  assert.deepEqual(requests, []);
});

