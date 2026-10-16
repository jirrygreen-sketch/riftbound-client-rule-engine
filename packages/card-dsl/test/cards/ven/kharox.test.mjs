import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/kharox.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import mill from "../../../../engine-core/dist/effects/instructions/effect.mill.js";

const CANONICAL_ID =
  "card.hash-3d223dbad167b8ba77b7ea78144ef2178d6804de4c7d260449f02325a2d81e71";
const SOURCE_TEXT =
  "[Empower] :rb_energy_6::rb_rune_chaos::rb_rune_chaos: (:rb_energy_6::rb_rune_chaos::rb_rune_chaos:: " +
  "Empower me. Use only if not Empowered.)\nWhen I become [Empowered], choose an opponent. They [Burn 3]. " +
  "Then you may do this: Choose a unit in their trash and play it, ignoring its cost. (To Burn 3, " +
  "they put the top 3 cards of their Main Deck into their trash.)";

const [empower, onEmpowered] = program.abilities;
const [burnThree, mayPlay] = onEmpowered.body;
const [playUnit] = mayPlay.args.body.value;

const trashIds = (kernel, player) =>
  kernel.zoneSlice(player, "trash", "top").map((object) => object.ref.id);
const deckIds = (kernel, player) =>
  kernel.zoneSlice(player, "deck", "top").map((object) => object.ref.id);

test("ven-114-166 Kharox: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-114-166 Kharox: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /356\.1\.b\.1/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("ven-114-166 Kharox: [Empower] is declared as a keyword, never re-implemented", () => {
  // 827.1.c.1 的“6 Energy + 2 Chaos Power：Empower me”是关键词展开；KeywordAbility 没有
  // params 字段承载印刷费用，故不伪造第二条启动能力（契约 3.7 / README 第 5 节）。
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
});

test("ven-114-166 Kharox: the become-Empowered trigger burns 3 through the opponent pick", () => {
  // 828.1.d："When I become Empowered" 依赖能力在来源成为 Empowered 时触发；
  // 828.1.c 只对增加方向触发。
  assert.equal(onEmpowered.kind, "triggered");
  assert.equal(onEmpowered.trigger.at, "empowered-changed");
  assert.deepEqual(onEmpowered.trigger.filter, {
    event: "empowered-changed",
    filter: { source: "self", direction: "increase" }
  });
  assert.equal(onEmpowered.optional, false);

  assert.deepEqual(
    onEmpowered.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["kharox.chosen-opponent-burn-3", "effect.mill"],
      ["kharox.may-play-option", "choice.optional"]
    ]
  );

  // 441.2："They [Burn 3]" 的烧牌者是被选对手（355.10.e 的非目标 pick）。
  assert.deepEqual(burnThree.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(burnThree.args.pick, {
    kind: "constant",
    value: "kharox.chosen-opponent"
  });
  assert.deepEqual(burnThree.picks, [
    {
      id: "kharox.chosen-opponent",
      options: ["dynamic:opponent-players"],
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ven-114-166 Kharox: 'Then you may …' is a choice.optional wrapping the play (contract 3.9)", () => {
  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.args.body.kind, "constant");
  assert.deepEqual(
    mayPlay.args.body.value.map((instruction) => [instruction.id, instruction.op]),
    [["kharox.play-unit-from-trash", "effect.play"]]
  );
  // 契约 3.9：“可以……”一律把被选指令包在 body 里，不用 choice + linkedTo。
  assert.equal(mayPlay.linkedTo, undefined);

  assert.equal(playUnit.op, "effect.play");
  // 356.1.b.1：ignoring its cost 把基础 Energy 与 Power 置零。
  assert.deepEqual(playUnit.args.cost, {
    kind: "constant",
    value: {
      finalized: true,
      energy: 0,
      power: [],
      xp: 0,
      ignore: ["energy", "power"]
    }
  });
  assert.deepEqual(playUnit.targets, [
    {
      id: "kharox.unit-in-opponent-trash",
      filter: { type: "unit", zone: "trash", controller: "opponent" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ven-114-166 Kharox golden: [Burn 3] burns the chosen opponent's top 3 cards in order", () => {
  // 441.1/441.4：烧的是**被选对手**的牌库顶，按顶到底顺序进入其弃牌区。
  const base = world()
    .player("controller")
    .player("opponent")
    .deck(["their-top", "their-second", "their-third", "their-fourth"], {
      owner: "opponent"
    })
    .build();
  const kernel = base.clone({ controller: "controller" });
  kernel.setPicks("kharox.chosen-opponent", ["opponent"]);

  const outcome = resolveChainBody([burnThree], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.burnedPlayer, "opponent");
  assert.equal(outcome.results[0].result.linkedValues.burnedCount, 3);
  assert.deepEqual(trashIds(kernel, "opponent"), ["their-top", "their-second", "their-third"]);
  assert.deepEqual(deckIds(kernel, "opponent"), ["their-fourth"]);
  // 我的区域完全不受影响。
  assert.deepEqual(trashIds(kernel, "controller"), []);
});

test("ven-114-166 Kharox golden: the Burn 3 itself is executable through the real primitive", () => {
  // 与上一条同一原语、同一参数（effect.mill 的 pick 通道），单独走 runInstruction 的
  // 事务入口，证明“由被选玩家烧牌”这条路径确实由已合入原语完成（非手工结算）。
  const base = world()
    .player("controller")
    .player("opponent")
    .deck(["their-top", "their-second", "their-third", "their-fourth"], {
      owner: "opponent"
    })
    .build();
  const kernel = base.clone({ controller: "controller" });
  const run = runInstruction(
    mill,
    { amount: 3, pick: "kharox.chosen-opponent" },
    { world: kernel, picks: { "kharox.chosen-opponent": ["opponent"] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.burnedPlayer, "opponent");
  assert.deepEqual(trashIds(kernel, "opponent"), ["their-top", "their-second", "their-third"]);
});

test("ven-114-166 Kharox golden: a short deck burns only what is available (CR 441.4)", () => {
  const base = world()
    .player("controller")
    .player("opponent")
    .deck(["their-only-card"], { owner: "opponent" })
    .build();
  const kernel = base.clone({ controller: "controller" });
  kernel.setPicks("kharox.chosen-opponent", ["opponent"]);

  const outcome = resolveChainBody([burnThree], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.burnedCount, 1);
  assert.deepEqual(trashIds(kernel, "opponent"), ["their-only-card"]);
  assert.deepEqual(deckIds(kernel, "opponent"), []);
});

test.todo(
  "ven-114-166 Kharox: [Empower] expansion (827.1.c.1: 6 Energy + 2 Chaos Power, 'use only if not " +
    "Empowered') and the [Empowered] dependent ability (828.1.b.1) need an Empower/Empowered " +
    "KeywordDef and an Empowered status predicate (442.1.a / 828.1.d) — none is merged"
);

test.todo(
  "ven-114-166 Kharox: 'choose an opponent' locks a chosen player through Finalize and 'play it, " +
    "ignoring its cost' receives a finalized zero-cost plan (CR 355.9.a / 356.1.b.1) — the " +
    "contract's targets() returns ObjectRef[] only and no cost-plan generator is wired (RIFT-89)"
);

test.todo(
  "ven-114-166 Kharox: the become-Empowered trigger runs end to end (empowered-changed payload with " +
    "previousCount/currentCount and the increase direction, 828.1.c) — scoring/events wiring is not merged"
);
