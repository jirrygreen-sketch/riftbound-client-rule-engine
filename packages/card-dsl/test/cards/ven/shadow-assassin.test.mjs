import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shadow-assassin.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
// The production replacement binder executes the substitution once
// the program's replacement ability is registered on it.
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID =
  "card.hash-101dc13865ec4192cab5368a9a51d1582968c98f57b52ab293cd35e4c5313b0c";
const SOURCE_TEXT = "I enter ready if you have a card with my name in your trash.";

const [replacement] = program.abilities;
const [enterReady] = replacement.with;

/** 参考内核的 source 指向宿主；能力体用符号选择器，由解释器绑定。 */
function hostWorld(kernel, id) {
  return kernel.clone({ source: kernel.ref(id), sourceSnapshot: kernel.getObject(id) });
}

test("ven-013-166 Shadow Assassin: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-013-166 Shadow Assassin: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // judgeReason 必须点名 369.3 的入场替代缺口、同名谓词与过滤键归一化。
  assert.match(program.judgeReason, /359\.2\.c\/369\.3/);
  assert.match(program.judgeReason, /132\.1\/132\.3\/132\.4/);
  // The merged binder executes the substitution; the unmerged part is the
  // production registration path plus the name/placeholder predicates.
  assert.match(program.judgeReason, /bindReplacement/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-013-166 Shadow Assassin: 'I enter ready' is a board-entry replacement, not a post-entry ready", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(replacement.kind, "replacement");
  // 359.2.c：单位默认横置进入 Board；369.3 把这种文本定义为入场替代。
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  // effect.ready 的文件头明确本原语不参与入场替代，因此这里只出现在替代体里。
  assert.deepEqual(replacement.with.map(instruction => [instruction.id, instruction.op]), [
    ["shadow-assassin.enter-ready", "effect.ready"]
  ]);
  assert.deepEqual(enterReady.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(enterReady.targets, undefined);
  assert.equal(enterReady.picks, undefined);
  assert.equal(enterReady.linkedTo, undefined);
});

test("ven-013-166 Shadow Assassin: the applicability condition counts same-named cards in your trash", () => {
  const condition = replacement.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "cards");
  // 132.1/132.3/132.4 的同名比较与 "your trash" 的作用域；sameNameAs 是描述性占位键
  // （现有 ObjectFilter 的 characteristics 只做顶层字段等值，没有消费方读取它）。
  assert.deepEqual(condition.left.filter, {
    zone: "trash",
    owner: "self",
    sameNameAs: "self"
  });
});

test("ven-013-166 Shadow Assassin golden: the replacement body readies the exhausted entering unit (416.1)", () => {
  const kernel = hostWorld(
    world().unit("shadow-assassin", { might: 5, exhausted: true }).build(),
    "shadow-assassin"
  );
  assert.equal(kernel.getObject("shadow-assassin").exhausted, true);

  const outcome = resolveChainBody(replacement.with, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["shadow-assassin.enter-ready", "executed"]
  ]);
  assert.equal(kernel.getObject("shadow-assassin").exhausted, false);
  assert.deepEqual(outcome.linkedValues["shadow-assassin.enter-ready.readied"], {
    count: 1,
    objects: [kernel.ref("shadow-assassin")]
  });
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
});

test("ven-013-166 Shadow Assassin golden: an already-ready unit stays legal with 0 readied (416.1.b)", () => {
  const kernel = hostWorld(
    world().unit("shadow-assassin", { might: 5, exhausted: false }).build(),
    "shadow-assassin"
  );
  const outcome = resolveChainBody(replacement.with, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(outcome.linkedValues["shadow-assassin.enter-ready.readied"], {
    count: 0,
    objects: []
  });
});

test("ven-013-166 Shadow Assassin golden: bindReplacement turns exhausted entry into ready entry (mechanism)", () => {
  // This runs the merged replacement binder on the card's real replaces/with
  // shape without the unexecutable condition (gap 3): the bound unit
  // enters the board ready while an unbound twin stays exhausted. It proves the
  // substitution mechanism, not the production registration path (gap 1).
  const f = fixture({ cards: [
    { id: "bound-assassin", types: ["unit"] },
    { id: "unbound-assassin", types: ["unit"] }
  ] });
  bindReplacement(
    { replaces: replacement.replaces, with: replacement.with },
    f.kernel.ref("bound-assassin"),
    {
      host: {
        object: ref => f.kernel.object(ref),
        objects: () => f.kernel.objects,
        context: () => f.kernel
      },
      pipeline: f.engine.pipeline
    }
  );
  f.engine.execute(f.card("bound-assassin", { kind: "unit", body: [] }));
  f.engine.execute(f.card("unbound-assassin", { kind: "unit", body: [] }));
  resolveAll(f.engine);

  assert.equal(f.kernel.getObject("bound-assassin").zone, "board");
  assert.equal(f.kernel.getObject("bound-assassin").exhausted, false);
  // The unbound control keeps the default exhausted entry (359.2.c).
  assert.equal(f.kernel.getObject("unbound-assassin").zone, "board");
  assert.equal(f.kernel.getObject("unbound-assassin").exhausted, true);
});

test.todo(
  "ven-013-166 Shadow Assassin: replace exhausted entry with ready entry when the condition holds " +
    "(359.2.c / 369.3) — the merged binder executes the substitution (golden above), but no production " +
    "module registers a CardProgram replacement ability into the event pipeline"
);
test.todo(
  "ven-013-166 Shadow Assassin: evaluate 'a card with my name in your trash' — comparing card names " +
    "(132.1/132.3/132.4) needs a name predicate; ObjectFilter.characteristics only does top-level " +
    "field equality and Expr cannot read the source card's name, and the trash filter's owner " +
    "placeholder is not normalized by merged query consumers"
);
