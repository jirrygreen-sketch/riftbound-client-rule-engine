import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/enthusiastic-promoter.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-c887e5d6b316e9709bd403596c8e7217fa050f03dc482385655b7654202cea8d";
const SOURCE_TEXT =
  "[Backline] (I must be assigned combat damage last.)\n" +
  "When I hold, [Buff] all units here. (Give each a +1 :rb_might: buff if it doesn't have one.)";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const [backline, onHold] = program.abilities;
const [buffHere] = onHold.body;
const targetSpec = buffHere.targets[0];

test("unl-043-219 Enthusiastic Promoter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-043-219 Enthusiastic Promoter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /826\.3/);
  assert.match(program.judgeReason, /base-combat-allocation/);
  assert.match(program.judgeReason, /383\.4\.d\.2/);
  assert.match(program.judgeReason, /effects\/keywords\/Backline\.ts/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("unl-043-219 Enthusiastic Promoter: [Backline] is a keyword declaration only", () => {
  assert.equal(program.abilities.length, 2);
  // 826.3 / 826.5：Backline 不带数值，多实例冗余。
  assert.deepEqual(backline, { kind: "keyword", keyword: "backline" });
  assert.equal(backline.value, undefined);
  // 826.4 的分配要求由 effects/keywords/Backline.ts 展开，卡内不重写。
  const backlineDef = keywordDefinitionsById.get("Backline");
  assert.ok(backlineDef, "the merged Backline KeywordDef is registered (CR 826)");
  assert.equal(backlineDef.stacking, "single");
  const [expansion] = backlineDef.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.effect.kind, "continuous.combat");
  assert.equal(expansion.effect.priority, "last");
});

test("unl-043-219 Enthusiastic Promoter: 'When I hold' subscribes to the hold timing point for the source", () => {
  assert.equal(onHold.kind, "triggered");
  // 383.4.d.1 的 “When I hold…” 写法；时点 hold 由 scoring 发出（315.2.b.2 / 471.2 / 473.2.b）。
  assert.deepEqual(onHold.trigger, { at: "hold", filter: { event: "hold", filter: { source: "self" } } });
  assert.equal(onHold.optional, false);
  assert.equal(onHold.body.length, 1);
});

test("unl-043-219 Enthusiastic Promoter: '[Buff] all units here' is one programmatic all-selection", () => {
  assert.equal(buffHere.id, "enthusiastic-promoter.buff-units-here");
  assert.equal(buffHere.op, "effect.buff");
  // 702.2.a：buff 模式；提醒文本 “give each a +1 buff if it doesn't have one” 就是 702.3.a
  // 的既有行为（已有 Buff 的单位不再获得），不需要额外参数。
  assert.deepEqual(buffHere.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "enthusiastic-promoter.units-here" }
  });
  // 355.10.d / 359.3.e.11：“all units here” 没有可做的选择，是全选集合。
  assert.deepEqual(targetSpec, {
    id: "enthusiastic-promoter.units-here",
    filter: { zone: "board", type: "unit", sameLocationAs: "self" },
    min: 0,
    max: null,
    selection: "all"
  });
  assert.equal(buffHere.picks, undefined);
  assert.equal(buffHere.linkedTo, undefined);
  assert.equal(buffHere.condition, undefined);
});

test("unl-043-219 Enthusiastic Promoter golden: Buff lands on every unit here and skips one that already has a Buff", () => {
  const kernel = world()
    .unit("promoter", { zone: "board", location: BATTLEFIELD, might: 2, buffs: 0 })
    .unit("ally-here", { zone: "board", location: BATTLEFIELD, buffs: 0 })
    .unit("already-buffed", { zone: "board", location: BATTLEFIELD, buffs: 1 })
    .unit("ally-elsewhere", { zone: "board", location: { type: "base", player: "A" }, buffs: 0 })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("promoter")) });
  // Finalize 锁定同一位置的全部单位（生产链路由目标系统用 sameLocationAs 锚点重验）。
  ctx.setTargets(targetSpec.id, [ctx.ref("promoter"), ctx.ref("ally-here"), ctx.ref("already-buffed")]);
  const outcome = resolveChainBody(onHold.body, ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["enthusiastic-promoter.buff-units-here", "executed"]
  ]);
  assert.equal(ctx.getObject("promoter").buffs, 1);
  assert.equal(ctx.getObject("ally-here").buffs, 1);
  // 702.3 / 702.3.a：已经有 Buff 的单位不再获得，但仍是合法选择（427.1.c）。
  assert.equal(ctx.getObject("already-buffed").buffs, 1);
  assert.equal(ctx.getObject("ally-elsewhere").buffs, 0);
  assert.deepEqual(ctx.events.map((event) => event.action), ["buff", "buff"]);
});

test("unl-043-219 Enthusiastic Promoter golden: with every candidate already buffed the instruction is a no-op", () => {
  const kernel = world()
    .unit("promoter", { zone: "board", location: BATTLEFIELD, buffs: 1 })
    .unit("ally-here", { zone: "board", location: BATTLEFIELD, buffs: 1 })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("promoter")) });
  const run = runInstruction(
    buff,
    { mode: "buff", target: targetSpec.id },
    { world: ctx, targets: { [targetSpec.id]: [ctx.ref("promoter"), ctx.ref("ally-here")] } }
  );
  // 702.3.a / 427.1.c：什么都没放下来，指令按 skipped 结算，事件为空。
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(run.linked.buffedCount, 0);
  assert.deepEqual(run.events, []);
});

test("unl-043-219 Enthusiastic Promoter golden: a stale locked group is mistargeted instead of silently skipped", () => {
  // 359.3.e.5–e.7：结算时目标引用全部失效 → ignored(mistargeted)，不是「无事发生」。
  const kernel = world()
    .unit("promoter", { zone: "board", location: BATTLEFIELD })
    .unit("ally-here", { zone: "board", location: BATTLEFIELD })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("promoter")) });
  const stale = ctx.ref("ally-here");
  ctx.perform({ type: "kill", object: stale });
  const run = runInstruction(
    buff,
    { mode: "buff", target: targetSpec.id },
    { world: ctx, targets: { [targetSpec.id]: [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
});

test.todo(
  "unl-043-219 Enthusiastic Promoter: honour [Backline] when assigning combat damage (CR 826.3/826.4.a/826.4.b) — " +
    "combat/base-combat-allocation.ts records 'No Tank/Backline/other assignment-priority requirement is bound here'"
);
test.todo(
  "unl-043-219 Enthusiastic Promoter: bind the hold trigger to the unit present at the held battlefield " +
    "(CR 383.4.d.2/.2.a) — the hold payload carries only battlefield/player (RIFT-31/RIFT-33)"
);
test.todo(
  "unl-043-219 Enthusiastic Promoter: expand the card's keywords through the KeywordDef registry into layer " +
    "registrations (contract 3.5/3.7) — no card keyword consumer is merged (RIFT-91)"
);
