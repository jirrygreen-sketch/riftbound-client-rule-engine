import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/mel-newly-awakened.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-881035c8e14e8d3c7fa7299235e42c62bb45a5ba4a64f90a6f663abf348954cb";
const SOURCE_TEXT =
  "When you play me, draw 1.\n" +
  "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] Your spells and abilities can't be countered. If a spell or ability you " +
  "control would give -:rb_might: to a unit it chooses, it gives an additional -1 :rb_might:.";

const [playDraw, empower, cannotBeCountered, extraReduction] = program.abilities;
const [drawOne] = playDraw.body;

test("ven-069-166 Mel, Newly Awakened: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-069-166 Mel: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /426\.1/);
  assert.match(program.judgeReason, /continuous\.restrict/);
});

test("ven-069-166 Mel: 'When you play me, draw 1' is one mandatory self trigger", () => {
  assert.equal(playDraw.kind, "triggered");
  assert.equal(playDraw.trigger.at, "card-played");
  assert.deepEqual(playDraw.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playDraw.optional, false);
  assert.equal(playDraw.trigger.condition, undefined);
  assert.equal(playDraw.trigger.once, undefined);
  assert.equal(playDraw.body.length, 1);
  assert.equal(drawOne.id, "mel-newly-awakened.draw-1");
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
});

test("ven-069-166 Mel: [Empower] stays a keyword declaration", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
  // 827.1.c.1 的启动费用与 828.1.b.1 的依赖能力都无展开实现，故不写成启动能力。
  assert.equal(program.abilities.filter(ability => ability.kind === "activated").length, 0);
});

test("ven-069-166 Mel: the Empowered dependent abilities keep their status gate", () => {
  for (const [label, ability] of [["cannot-be-countered", cannotBeCountered], ["extra-reduction", extraReduction]]) {
    assert.equal(ability.kind, "static", label);
    // 442.1.a / 828.1.c：Empowered 门槛（描述性谓词，无已合入求值路径）。
    assert.equal(ability.condition.kind, "compare", label);
    assert.equal(ability.condition.operator, "gte", label);
    assert.deepEqual(ability.condition.left, {
      kind: "object-property",
      object: "self",
      property: "empoweredCount"
    }, label);
    assert.deepEqual(ability.condition.right, { kind: "constant", value: 1 }, label);
  }
  // 426.1/426.2：Counter 的静态禁止（continuous.restrict 族）。
  assert.deepEqual(cannotBeCountered.effect, {
    kind: "continuous.restrict",
    mode: "cannot-be-countered",
    appliesTo: "controller-spells-and-abilities"
  });
  // 479.4.b：“additional -1 :rb_might:” 是算术层的叠加修正，不是 Buff 计数。
  assert.equal(extraReduction.effect.kind, "continuous.modify-might-reduction");
  assert.equal(extraReduction.effect.mode, "additional");
  assert.deepEqual(extraReduction.effect.amount, { kind: "constant", value: -1 });
  assert.equal(extraReduction.effect.appliesTo, "controller-spells-and-abilities");
});

test("ven-069-166 golden: the play trigger really draws 1 through the chain adapter", () => {
  const kernel = world().player("A").deck(["top", "next"]).build();
  const outcome = resolveChainBody(playDraw.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["mel-newly-awakened.draw-1", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(outcome.linkedValues["mel-newly-awakened.draw-1.drawn"], 1);
  assert.equal(outcome.linkedValues["mel-newly-awakened.draw-1.drawnTo"], "A");
});

test("ven-069-166 golden: drawing from an empty deck links the real drawn count of 0 (414.4)", () => {
  const kernel = world().player("A").build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});
