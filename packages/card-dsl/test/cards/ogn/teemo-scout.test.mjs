import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/teemo-scout.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import * as keywordRegistry from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-cb1f129544dcf370595e85fa0b8df2f0620b5cb3bd0199a5a8700160557bfb5f";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me, give me +3 :rb_might: this turn.";

const [keyword, triggered] = program.abilities;
const [grantMight] = triggered.body;

test("teemo-scout: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("teemo-scout: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /card-hidden/);
  assert.match(program.judgeReason, /811\.6/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("teemo-scout: [Hidden] keyword + play trigger granting +3 Might this turn", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "hidden" });

  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);

  // CR 143.2.a / 475: 这是本回合的 Effective Might 算术修正，不是 702 的 Buff 计数器。
  assert.equal(grantMight.id, "teemo-scout.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  // “me”：appliesTo self 指向能力宿主（contract 3.6 的 source/self）。
  assert.deepEqual(grantMight.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(grantMight.linkedTo, undefined);
  assert.equal(grantMight.targets, undefined);
  assert.equal(grantMight.picks, undefined);
});

test("teemo-scout golden: the +3 Might registers on the host and expires at end of turn", () => {
  const kernel = world().unit("teemo-scout", { owner: "A", controller: "A", might: 1 }).build();
  const source = kernel.getObject("teemo-scout");
  // The trigger's source is the unit itself; bind it the way the chain's
  // Resolve context does so appliesTo "self" resolves to the host.
  const context = new Proxy(kernel, {
    get(target, key) {
      if (key === "source") return source;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  const outcome = resolveChainBody(triggered.body, context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [["teemo-scout.grant-might", "executed"]]
  );

  // 478 / 478.1.a: the +3 lives in the arithmetic layer with an end-of-turn
  // duration (317.1.a / 468.7.c), never as a 702 Buff counter.
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 3);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(kernel.getObject("teemo-scout").buffs, 0);

  const engine = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(engine.evaluate(kernel.ref("teemo-scout")).might, 4);

  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(engine.evaluate(kernel.ref("teemo-scout")).might, 1);
});

test("teemo-scout: the Hidden keyword expands to the static cost.hidden effect (CR 811.1.b)", () => {
  const { keywordDefinitionsById } = keywordRegistry;
  const hidden = keywordDefinitionsById.get("Hidden");
  assert.ok(hidden, "the merged Hidden KeywordDef must be registered");
  assert.equal(hidden.valued, false);
  const expansion = hidden.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(expansion, [{ kind: "static", effect: { kind: "cost.hidden" } }]);
});

test.todo(
  "teemo-scout: [Hidden] 藏牌、忽略基础费用与次回合 [Reaction]（811.1.b/d、811.6）" +
    "仍缺 cost.hidden 的 Hide/facedown 生命周期消费方与 card-hidden 产生方；关键词展开和程序绑定已合入"
);

test("teemo-scout: the program binder expands Hidden and retains the authored play trigger", () => {
  const kernel = world().unit("teemo", { cardId: CANONICAL }).build();
  const expanded = expandProgram(program, kernel.getObject("teemo"));
  assert.deepEqual(expanded.expanded, [{ kind: "static", effect: { kind: "cost.hidden" } }]);
  assert.deepEqual(expanded.abilities.find(ability => ability.kind === "triggered"), triggered);
});
