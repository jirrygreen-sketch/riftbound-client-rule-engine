import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/disciple-of-shen.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-29466276a36ad6d31ede84a0b5f6d73cfe73590d866accc1e138b05ffecd77ca";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "I have [Shield 3] while I'm at a battlefield with exactly one other unit you control. " +
  "(+3 :rb_might: while I'm a defender.)";

const [hidden, shieldGrant] = program.abilities;
const condition = shieldGrant.condition;

// 该 condition 是普通 IR，可用已合入的 condition.predicate 真实求值。
const predicate = {
  id: "disciple-of-shen.condition",
  op: "condition.predicate",
  args: { condition: { kind: "constant", value: condition } }
};

const discipleKernel = ({ allies = 1, enemies = 0, allyLocation, atBase = false } = {}) => {
  const builder = world().player("controller").player("B");
  builder.unit("disciple", {
    controller: "controller",
    might: 1,
    location: atBase
      ? { type: "base", player: "controller" }
      : { type: "battlefield", id: "bf-1" }
  });
  for (let index = 0; index < allies; index++) {
    builder.unit(`ally-${index}`, {
      controller: "controller",
      location: { type: "battlefield", id: allyLocation ?? "bf-1" }
    });
  }
  for (let index = 0; index < enemies; index++) {
    builder.unit(`enemy-${index}`, {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "bf-1" }
    });
  }
  const base = builder.build();
  return base.clone({
    controller: "controller",
    sourceSnapshot: base.getObject("disciple")
  });
};

test("ven-117-166 Disciple of Shen: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-117-166 Disciple of Shen: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // [Hidden] 无结算消费方；授予侧注册入口已合入，但条件选择符不解析。
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-359/);
});

test("ven-117-166 Disciple of Shen: [Hidden] is declared as a bare keyword (contract 3.7)", () => {
  assert.equal(program.abilities.length, 2);
  // 811.1：只声明关键词，Hide 的动作与后续 [Reaction] 由关键词展开与内核负责。
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.equal(hidden.value, undefined);
});

test("ven-117-166 Disciple of Shen: the conditional Shield 3 grant to self", () => {
  assert.equal(shieldGrant.kind, "static");
  // 814.1.b.2/814.1.b.3：印刷值 3；814.1.c 的功能等价文本是“作为防守者时 +3 [M]”，
  // 由 effects/keywords/Shield.ts 展开，卡文件不重写。
  assert.deepEqual(shieldGrant.effect, {
    kind: "continuous.grant-keyword",
    appliesTo: "self",
    keywords: [{ id: "shield", value: 3 }]
  });
  // 契约 3.4：条件只作用于所属能力。
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "eq");
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "other-friendly-units-here");
  // “exactly one other unit you control” = 同战场、由你控制、排除来源自身。
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    sameLocationAs: "self",
    exclude: "self"
  });
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
});

test("ven-117-166 golden: the printed condition is true with exactly one other friendly unit here", () => {
  const outcome = runAbilityBody([predicate], discipleKernel({ allies: 1 }));
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["disciple-of-shen.condition.value"], true);
});

test("ven-117-166 golden: zero or two other friendly units here make the condition false", () => {
  for (const allies of [0, 2]) {
    const outcome = runAbilityBody([predicate], discipleKernel({ allies }));
    assert.equal(outcome.status, "executed");
    assert.equal(
      outcome.linkedValues["disciple-of-shen.condition.value"],
      false,
      `allies=${allies}`
    );
  }
});

test("ven-117-166 golden: a friendly unit at another battlefield is not 'here'", () => {
  const outcome = runAbilityBody([predicate], discipleKernel({ allies: 1, allyLocation: "bf-2" }));
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["disciple-of-shen.condition.value"], false);
});

test("ven-117-166 golden: an enemy unit here is not 'a unit you control'", () => {
  const outcome = runAbilityBody([predicate], discipleKernel({ allies: 1, enemies: 1 }));
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["disciple-of-shen.condition.value"], true);
});

test("ven-117-166 golden: the declared Grant-Keyword adds Shield 3 to the layered keyword list", () => {
  // RIFT-91 的 layers 引擎对 ability 层识别 grant 类 kind 并追加工关键词；这里用该卡
  // 声明的 keyword/value 形状做真实求值，证明“授予 Shield 3”的 declared 形状在图层里
  // 有实际产出。它不证明 828/814 的门控与卡牌注册路径已接通（见 judgeReason）。
  const kernel = world()
    .unit("disciple", {
      controller: "controller",
      might: 1,
      types: ["unit"],
      location: { type: "battlefield", id: "bf-1" }
    })
    .build()
    .clone({ controller: "controller" });
  const snapshot = kernel.getObject("disciple");
  const [granted] = shieldGrant.effect.keywords;
  const engine = createLayerEngine([snapshot], [
    {
      effect: {
        id: "disciple-of-shen.shield-3",
        layer: "ability",
        source: snapshot.ref,
        filter: { objectId: "disciple" },
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
  const evaluated = engine.evaluate(snapshot.ref);
  assert.deepEqual(evaluated.keywords, [{ id: "shield", value: 3 }]);
});

test.todo(
  "ven-117-166 Disciple of Shen: [Hidden]'s Hide action, the facedown zone, the later [Reaction] and the " +
    "0-Energy play (CR 811.1.d / 811.5 / 811.6) have no runtime — Hidden.ts records that " +
    "cost.hidden / cost.pay / effect.zone are unmerged (RIFT-89) and cost.hidden has no layerFor mapping"
);

test.todo(
  "ven-117-166 Disciple of Shen: the conditional Shield 3 grant reaches the layers with an honest " +
    "'exactly one other unit you control here' predicate — bindStaticToLayers exists but the " +
    "controller：“controller” selector is not parsed by layers/filter.ts (RIFT-359)"
);
