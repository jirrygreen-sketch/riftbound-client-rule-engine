// Execution evidence for the supported slice lives in
// ../templates/keyword-static-671.test.mjs (README 4.1) and
// ../templates/keyword-static-647.test.mjs; this card stays judge-required for the
// gaps asserted below. The measured gates added on 2026-10-18 pin the three
// production-side blockers: the cost.hidden layer mapping, the relative controller
// selector and the ignored sameLocationAs/exclude anchors.
import assert from "node:assert/strict";
import test from "node:test";

import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/disciple-of-shen.js";

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
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /Facedown Zone|藏牌/);
  assert.match(program.judgeReason, /selectorMatches/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /designation/);
  assert.doesNotMatch(program.judgeReason, /RIFT-89/);
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

test("ven-117-166 golden: the merged keyword-grant adapter applies Shield 3 to a defender", () => {
  const kernel = world().unit("disciple", {
    controller: "controller",
    might: 1,
    combatRole: "defender",
    types: ["unit"],
    location: { type: "battlefield", id: "bf-1" }
  }).build().clone({ controller: "controller" });
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("disciple") });
  const outcome = runAbilityBody([{
    id: "disciple-of-shen.grant-shield",
    op: "continuous.grant-keyword",
    args: {
      keywords: { kind: "constant", value: shieldGrant.effect.keywords },
      appliesTo: { kind: "constant", value: "self" }
    }
  }], context);
  assert.equal(outcome.status, "executed");
  const layers = new KeywordGrantLayerEngine(context.objects, {
    context: source => bindResolveContext(context, { source, controller: source.controller })
  });
  for (const entry of context.continuousEffects) {
    layers.addContinuous(entry.effect, entry.duration, entry.timestamp);
  }
  const snapshot = layers.snapshot(context.ref("disciple"));
  assert.deepEqual(snapshot.keywords, [{ id: "Shield", value: 3 }]);
  assert.equal(snapshot.might, 4);
});

test("ven-117-166 evidence: the Hidden expansion has no production layer mapping", () => {
  // 811.1.c/811.1.d: Hidden expands to a static hidden-cost effect. The real
  // binder rejects that kind, and attachProgramLifecycle swallows the error, so
  // the Hide action, the facedown zone and the later free play stay unreachable.
  const kernel = world().unit("shen", {
    cardId: program.canonicalCardId, types: ["unit"], zone: "board",
    controller: "A", owner: "A", energy: null, power: null
  }).build();
  const { expanded } = expandProgram(program, kernel.getObject("shen"));
  assert.deepEqual(expanded.map(ability => ability.effect), [{ kind: "cost.hidden" }]);

  const { engine, kernel: boardKernel } = fixture({ cards: [{
    id: "shen", cardId: program.canonicalCardId, types: ["unit"], might: 1, energy: null, power: null
  }] });
  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic(expanded[0], boardKernel.getObject("shen")),
    (error) => error instanceof Error && /cost\.hidden has no layer mapping/.test(error.message)
  );
});

test("ven-117-166 evidence: the relative controller selector cannot anchor the grant", () => {
  // 814.1.c needs "exactly one other unit you control here". The layer matcher
  // resolves controller selectors against the object itself, so the authored
  // "controller" spelling never matches a production object.
  const object = {
    ref: { id: "u", zoneEntryId: 1 }, cardId: null, name: "u", types: ["unit"], tags: [], keywords: [],
    owner: "A", controller: "A", zone: "board", location: { type: "battlefield", id: "bf-1" },
    combatRole: null, might: 1, energy: null, power: null, exhausted: false, damage: 0,
    stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  };
  assert.equal(matchesObjectFilter({ type: "unit", zone: "board", controller: "controller" }, object), false);
  assert.equal(matchesObjectFilter({ type: "unit", zone: "board", controller: "A" }, object), true);
});

test("ven-117-166 evidence: the layer matcher ignores sameLocationAs and exclude", () => {
  // 355.9.c / 359.3.f: "other" excludes the source and "here" pins the location.
  // The production matcher ignores both anchors, so a unit at a different
  // battlefield and the source itself would both be counted.
  const elsewhere = {
    ref: { id: "ally", zoneEntryId: 1 }, cardId: null, name: "ally", types: ["unit"], tags: [], keywords: [],
    owner: "A", controller: "A", zone: "board", location: { type: "battlefield", id: "bf-2" },
    combatRole: null, might: 1, energy: null, power: null, exhausted: false, damage: 0,
    stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  };
  assert.equal(
    matchesObjectFilter({ type: "unit", zone: "board", controller: "A", sameLocationAs: "self", exclude: "self" }, elsewhere),
    true
  );
});

test("ven-117-166 evidence: the production binder registers the grant but never satisfies its gate", () => {
  // The static registration path exists; the condition is what fails. With a
  // real board of exactly one other friendly unit here, the layered keywords
  // still never gain Shield 3 under the authored condition.
  const { engine, kernel } = fixture({ cards: [{
    id: "shen", cardId: program.canonicalCardId, types: ["unit"], might: 1, energy: null, power: null
  }] });
  engine.commit({
    type: "move-zone", object: kernel.ref("shen"), to: "battlefield",
    location: { type: "battlefield", id: "bf-1" }
  });
  const ally = engine.pipeline.host.objects().find(object => object.ref.id === "enemy");
  assert.ok(ally, "the fixture provides another permanent");
  const binder = createEngineStaticBinder(engine);
  binder.bindStatic(shieldGrant, kernel.getObject("shen"));
  assert.deepEqual(engine.layers.snapshot(kernel.ref("shen")).keywords, []);
});

test.todo(
  "ven-117-166 Disciple of Shen: [Hidden]'s Hide action, the facedown zone, the later [Reaction] and " +
    "the 0-Energy play (CR 811.1.d / 811.5 / 811.6) need facedown-zone/Hide integration; cost.hidden " +
    "has no layerFor mapping while cost.pay, effect.zone and buildHiddenCostPlan already exist"
);

test.todo(
  "ven-117-166 Disciple of Shen: reach the layers with an honest 'exactly one other unit you " +
    "control here' predicate - the production matcher has no relative controller selector and " +
    "ignores sameLocationAs/exclude (355.9.c / 359.3.f)"
);

test.todo(
  "ven-117-166 Disciple of Shen: route the granted Shield 3 through the default CardProgram lifecycle " +
    "so production layers consume the defender Might bonus; the isolated KeywordGrantLayerEngine adapter " +
    "already covers the combatRole/designation alias (814.1.c)"
);

