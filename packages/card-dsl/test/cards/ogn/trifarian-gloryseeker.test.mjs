import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/trifarian-gloryseeker.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));

const BUFF_ID = "trifarian-gloryseeker.buff-me";

const bodyForExecution = () =>
  program.abilities[1].body.map(({ targets, ...rest }) => rest);

test("ogn-217-298 Trifarian Gloryseeker: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-0e5542d49264324b5497b244de3b3ad36381c763af055108066e1b17f7fb2aa7"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Legion/);
  assert.match(program.judgeReason, /effect\.buff/);
  assert.equal(
    program.sourceText,
    "[Legion] — When you play me, buff me. (If I don't have a buff, I get a +1 :rb_might: buff. " +
      "Get the effect if you've played another card this turn.)"
  );
});

test("ogn-217-298 Trifarian Gloryseeker: Legion keyword plus the gated card-played buff", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "legion");
  assert.equal(keyword.value, undefined);

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { event: "card-played", filter: { source: "self" } });
  // CR 812.1.b.1 / 812.1.c: the dependent ability is active only when another,
  // different card has been finalized by you this turn.
  assert.equal(triggered.trigger.condition.kind, "compare");
  assert.equal(triggered.trigger.condition.operator, "gte");
  assert.deepEqual(triggered.trigger.condition.right, { kind: "constant", value: 1 });
  assert.equal(triggered.trigger.condition.left.kind, "count");
  assert.equal(triggered.trigger.condition.left.subject, "cards-finalized-this-turn");
  assert.deepEqual(triggered.trigger.condition.left.filter, {
    player: "controller",
    exclude: "self"
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);

  assert.equal(triggered.body.length, 1);
  const [buff] = triggered.body;
  assert.equal(buff.id, BUFF_ID);
  assert.equal(buff.op, "effect.buff");
  assert.deepEqual(buff.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buff.args.target, { kind: "constant", value: "self-unit" });
  assert.deepEqual(buff.targets[0].filter, {
    object: "self",
    type: "unit",
    zone: "board"
  });
  assert.equal(buff.targets[0].min, 1);
  assert.equal(buff.targets[0].max, 1);
  assert.equal(buff.targets[0].selection, "one");
  assert.equal(buff.linkedTo, undefined);
  assert.equal(buff.condition, undefined);
});

test("ogn-217-298 Trifarian Gloryseeker golden: 'buff me' places one Buff on the source", () => {
  const kernel = world()
    .unit("gloryseeker", { might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("gloryseeker") });
  kernel.setTargets("self-unit", [kernel.ref("gloryseeker")]);

  const outcome = runAbilityBody(bodyForExecution(), kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // 702.2.a / 703: the Buff contributes +1 Might while it remains on the unit.
  assert.equal(kernel.getObject("gloryseeker").buffs, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.buffed, [
    { id: "gloryseeker", zoneEntryId: 1 }
  ]);
});

test("ogn-217-298 Trifarian Gloryseeker: a unit that already has a Buff is not Buffed again (CR 702.3.a)", () => {
  const kernel = world()
    .unit("gloryseeker", {
      might: 2,
      buffs: 1,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("gloryseeker") });
  kernel.setTargets("self-unit", [kernel.ref("gloryseeker")]);

  const outcome = runAbilityBody(bodyForExecution(), kernel);
  // 427.1.c: the unit is still a legal choice for a Buff action; it simply does
  // not receive a second counter.
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("gloryseeker").buffs, 1);
});

test.todo(
  "ogn-217-298 Trifarian Gloryseeker: [Legion] dependent-ability activation (CR 812.1.b.1/812.1.c) — " +
    "需要 condition.history/predicate 的卡牌侧实现与按卡身份排除字段（契约 3.8 已登记、实现未落地），依赖 RIFT-82"
);

test.todo(
  "ogn-217-298 Trifarian Gloryseeker: 'buff me' as a non-target self selection — " +
    "effect.buff 只从 ctx.targets(TargetSpec id) 读取对象；用 TargetSpec 包装会错误登记成为目标（355.10.d.1），" +
    "待原语支持 source/pick/query 形式的自身选择器"
);
