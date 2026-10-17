import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/mel-defiant-soul.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

const CANONICAL_ID =
  "card.hash-ac23c451a781cab424bef57b9033b37b366730f18b5699ec3fdfd4a7cb61f807";
const SOURCE_TEXT =
  "[Empower] — Discard a spell (Pay the cost: Empower me. Use only if not Empowered.)\n" +
  "When I become [Empowered], banish an enemy unit at a battlefield with 3 :rb_might: or less.";

const [empower, triggered] = program.abilities;
const [banishInstruction] = triggered.body;

const melKernel = ({ might }) => {
  const base = world()
    .player("controller")
    .player("B")
    .unit("mel", {
      controller: "controller",
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("enemy", {
      owner: "B",
      controller: "B",
      might,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  return base.clone({ controller: "controller", sourceSnapshot: base.getObject("mel") });
};

test("ven-110-166 Mel, Defiant Soul: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-110-166 Mel: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.2/);
  // 143.2.a：当前 Might 的数值上限（无谓词消费方）。
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /143\.2\.a/);
});

test("ven-110-166 Mel: [Empower] is declared with its printed non-resource cost named in the reason", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  // 827.1.c.2 允许 Empower 费用包含非资源费用（本卡是 “Discard a spell”）；卡程序不自行展开。
  assert.match(program.judgeReason, /Discard a spell/);
});

test("ven-110-166 Mel: the Empowered trigger and its banishing instruction", () => {
  // 828.1.d / 442.2.a：成为 Empowered 的时点；增加方向过滤见 judgeReason 第 2 点。
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "empowered-changed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "empowered-changed",
    filter: { source: "self", direction: "increase" }
  });
  assert.equal(triggered.optional, false);

  assert.equal(banishInstruction.id, "mel.banish-weak-enemy-unit");
  assert.equal(banishInstruction.op, "effect.banish");
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: { target: "mel.enemy-unit-at-a-battlefield" }
  });
  assert.equal(banishInstruction.targets.length, 1);
  const [target] = banishInstruction.targets;
  assert.equal(target.id, "mel.enemy-unit-at-a-battlefield");
  // 355.9.a.1 / 355.10.b：敌方单位是目标，“at a battlefield” 只是该目标的限制；
  // mightLte 是 143.2.a 当前 Might 上限的描述性记录（无消费方）。
  assert.deepEqual(target.filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    location: "battlefield",
    mightLte: 3
  });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("ven-110-166 golden: the locked enemy unit is really banished, not killed (428.2.a)", () => {
  const kernel = melKernel({ might: 3 });
  const run = runInstruction(banish, banishInstruction.args, {
    world: kernel,
    targets: { "mel.enemy-unit-at-a-battlefield": [kernel.ref("enemy")] }
  });
  assert.equal(run.result.status, "executed");
  // 428.1/428.2：进入其拥有者的 Banishment；428.2.a 说明 Banish 不是 Kill 的子集。
  assert.equal(kernel.getObject("enemy").zone, "banishment");
  assert.equal(kernel.getObject("enemy").owner, "B");
  assert.deepEqual(kernel.objectsInZone("B", "trash"), []);
  assert.equal(run.linked.banished.count, 1);
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
});

test("ven-110-166 golden: a stale target makes the banish ignored (359.3.e.7)", () => {
  const kernel = melKernel({ might: 3 });
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(banish, banishInstruction.args, {
    world: kernel,
    targets: { "mel.enemy-unit-at-a-battlefield": [stale] }
  });
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.deepEqual(run.events, []);
});

test.todo(
  "ven-110-166 Mel: [Empower]'s non-resource cost 'Discard a spell' (827.1.c.1 / 827.1.c.2) still needs " +
    "the merged Empower KeywordDef to receive params.cost and a spell-filtered hand-cost choice"
);
test.todo(
  "ven-110-166 Mel: the [Empowered] dependent trigger (828.1.d) still needs an event discriminant and " +
    "increase-direction consumer for empowered-changed"
);
test.todo(
  "ven-110-166 Mel: enforce 'with 3 :rb_might: or less' (143.2.a effective Might) — the frozen ObjectFilter " +
    "has no Might predicate consumer; the primitive golden only proves movement of an already-locked target"
);

// Resolution-only evidence: no activation or printed-cost payment is claimed.
test("mel: the merged Empower resolution body checks live state and does not empower twice", () => {
  const kernel = world().unit("mel", { cardId: CANONICAL_ID }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("mel") });
  const [expanded] = expandProgram(program, context.source).expanded;
  assert.equal(expanded.kind, "activated");
  assert.equal(expanded.timing, "action");
  assert.equal(expanded.body[0].op, "effect.empower");
  assert.deepEqual(expanded.restriction.condition, {
    kind: "compare", left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq", right: { kind: "constant", value: 0 }
  });
  const first = runAbilityBody(expanded.body, context, undefined, { host: context.source.ref });
  assert.equal(first.status, "executed");
  assert.equal(context.getObject("mel").empowered, 1);
  const second = runAbilityBody(expanded.body, context, undefined, { host: context.source.ref });
  assert.equal(second.results[0].result.reason, "skipped");
  assert.equal(context.getObject("mel").empowered, 1);
  assert.deepEqual(context.events.map(event => event.action), ["empower"]);
});
