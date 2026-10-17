import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/tail-cloaked-matriarch.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-3799ed0e95297410e29a35f17acda5f84a6efe71a60d927d529051f350de1aa6";
const SOURCE_TEXT =
  "[Empower] :rb_energy_2::rb_rune_chaos: (:rb_energy_2::rb_rune_chaos:: Empower me. Use only if not Empowered.)\n" +
  "When I become [Empowered], you may choose a unit in your trash with Energy cost no more than " +
  ":rb_energy_3: and Power cost no more than :rb_rune_rainbow:. Play it to your base, ignoring its cost.";

const [empower, triggered] = program.abilities;
const [mayPlay] = triggered.body;
const [playIt] = mayPlay.args.body.value;

const matriarchKernel = () => {
  const base = world()
    .player("controller")
    .unit("matriarch", {
      controller: "controller",
      location: { type: "battlefield", id: "bf-1" }
    })
    .card("trash-unit", {
      owner: "controller",
      controller: "controller",
      zone: "trash",
      types: ["unit"],
      might: 2,
      energy: 3,
      power: ["Chaos"]
    })
    .build();
  return base.clone({ controller: "controller", sourceSnapshot: base.getObject("matriarch") });
};

test("ven-104-166 Tail-Cloaked Matriarch: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-104-166 Tail-Cloaked Matriarch: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /356\.1\.b\.1/);
  assert.match(program.judgeReason, /costEnergyLte/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.ok(!/RIFT-89|RIFT-87/.test(program.judgeReason));
});

test("ven-104-166 Tail-Cloaked Matriarch: [Empower] is declared, not re-implemented (contract 3.7)", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  // 827.1.c.1 的「2 Energy + 1 Chaos Power」与「仅当未 Empowered 时启动」属关键词展开；
  // KeywordAbility 没有承载印刷费用的 params 字段（契约 3.8.3 只加在 KeywordDef.expand 上）。
  assert.equal(empower.value, undefined);
  assert.equal(empower.params, undefined);
});

test("ven-104-166 Tail-Cloaked Matriarch: the Empowered trigger and its optional play body", () => {
  // 828.1.d / 442.2.a：成为 Empowered 的时点；“增加方向”过滤见 judgeReason 第 2 点。
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "empowered-changed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "empowered-changed",
    filter: { player: "self", direction: "increase" }
  });
  // 383.3.a：效果首部的 “you may”。
  assert.equal(triggered.optional, true);

  // 契约 3.9：被选指令包在 choice.optional 的 body 里。
  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.args.body.kind, "constant");
  assert.deepEqual(mayPlay.args.body.value.map(entry => entry.id), [
    "tail-cloaked-matriarch.play-it"
  ]);
  assert.equal(mayPlay.linkedTo, undefined);
});

test("ven-104-166 Tail-Cloaked Matriarch: the play instruction keeps the printed ceilings descriptive", () => {
  assert.equal(playIt.op, "effect.play");
  assert.deepEqual(playIt.args.target, {
    kind: "constant",
    value: "tail-cloaked-matriarch.unit-in-your-trash"
  });
  // “to your base”（420.3）：控制者自己的 Base。
  assert.deepEqual(playIt.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  // 356.1.b.1：“ignoring its cost” 把基础 Energy/Power 置零。
  assert.deepEqual(playIt.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: [] }
  });
  assert.equal(playIt.targets.length, 1);
  // 355.9.a 的「Recycle a unit from your trash」例子：垃圾场是公开区域（355.10.a.1），所以是目标。
  assert.deepEqual(playIt.targets[0].filter, {
    zone: "trash",
    type: "unit",
    owner: "controller",
    costEnergyLte: 3,
    costPowerLte: 1
  });
  assert.equal(playIt.targets[0].selection, "one");
  assert.equal(playIt.targets[0].min, 1);
  assert.equal(playIt.targets[0].max, 1);
});

test("ven-104-166 golden: the locked trash unit is really played to your base for the given plan", () => {
  const kernel = matriarchKernel();
  kernel.setTargets("tail-cloaked-matriarch.unit-in-your-trash", [kernel.ref("trash-unit")]);
  const outcome = resolveChainBody([playIt], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["tail-cloaked-matriarch.play-it", "executed"]
  ]);
  assert.equal(kernel.getObject("trash-unit").zone, "board");
  assert.deepEqual(kernel.getObject("trash-unit").location, {
    type: "base",
    player: "controller"
  });
  assert.equal(outcome.linkedValues["tail-cloaked-matriarch.play-it.played"], 1);
  // 356.1.b.1 的零基础费用计划：确实提交了 pay + play，但费用为 0。
  assert.deepEqual(kernel.events.map(event => event.action), ["pay", "play"]);
});

test("ven-104-166 golden: no locked target makes the play ignored, not played from anywhere", () => {
  const kernel = matriarchKernel();
  const outcome = resolveChainBody([playIt], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(entry => [entry.result.status, entry.result.reason]),
    [["ignored", "mistargeted"]]
  );
  assert.equal(kernel.getObject("trash-unit").zone, "trash");
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "ven-104-166 Tail-Cloaked Matriarch: [Empower]'s activation (827.1.c.1: 2 Energy + 1 Chaos Power, 'use only " +
    "if not Empowered') needs an Empower KeywordDef — none is merged"
);

test.todo(
  "ven-104-166 Tail-Cloaked Matriarch: the [Empowered] dependent trigger (828.1.d) needs an Empowered status " +
    "predicate and the increase-direction filter on empowered-changed (442.1.a/442.2.a; EVENT_PATTERN_TYPES " +
    "has no empowerment discriminator and the payload carries no direction field)"
);

test.todo(
  "ven-104-166 Tail-Cloaked Matriarch: enforce the printed-cost ceilings ('Energy cost no more than 3', " +
    "'Power cost no more than [A]', 163.2.b) — the frozen ObjectFilter has no cost predicate and the merged " +
    "filters ignore such keys, so today any trash unit is a legal target"
);

test.todo(
  "ven-104-166 Tail-Cloaked Matriarch: produce the ignore-base Finalize plan for the chosen card (356.1.b.1) — " +
    "cost/cost-plan.ts can express ignore-base but no CardProgram -> cost plan wiring exists; " +
    "programs/filters.ts also rejects the descriptive costEnergyLte / costPowerLte target keys"
);
