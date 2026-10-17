import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/ava-achiever.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const c = value => ({ kind: "constant", value });

test("Ava Achiever program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Ava Achiever identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-2c1a169269b0950e25c0db04cc22a192284b006d0d720477f488d2f0ddef6e3b"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // cost.pay/cost.modify are merged (RIFT-261); the reason now names the
  // remaining finalize/pick wiring instead of a missing primitive.
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /finalized cost plan/);
  assert.match(program.judgeReason, /picks/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(
    program.sourceText,
    "When I attack, you may pay :rb_rune_mind: to play a card with [Hidden] from your hand here, ignoring its cost."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: attack trigger (once per combat) with a single choice.optional wrapper", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "attack-declared");
  // 383.4.e.2.a：攻击触发每次战斗只检查一次。
  assert.equal(ability.trigger.once, "per-combat");
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);

  // 契约 §3.9："you may …" 必须把被选择的指令包进 choice.optional 的 body，
  // 不得写成 choice + 后续 linkedTo。
  assert.equal(ability.body.length, 1);
  const [choice] = ability.body;
  assert.equal(choice.id, "ava.opt-in");
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.linkedTo, undefined);
  assert.equal(choice.args.body.kind, "constant");

  const body = choice.args.body.value;
  assert.deepEqual(
    body.map(instruction => instruction.id),
    ["ava.pay", "ava.play-hidden"]
  );

  // ":rb_rune_mind:" = 1 Mind Power（134/163.1）。
  assert.equal(body[0].op, "cost.pay");
  assert.deepEqual(body[0].args.power, c(["Mind"]));
  assert.equal(body[0].linkedTo, undefined);

  const play = body[1];
  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, "ava.pay");
  // 355.7：非公开区域（手牌）的选择不是目标 → 用 picks，不是 targets。
  assert.equal(play.targets, undefined);
  assert.deepEqual(play.args.pick, c("ava.hidden-card"));
  // 356.1.b.1：ignoring its cost → base Energy/Power 皆置 0 的 finalized 计划。
  assert.deepEqual(play.args.cost, c({ finalized: true, energy: 0, power: [] }));
  // 359.3.f/359.3.f.2："here" 在执行时读取来源当前位置。
  assert.deepEqual(play.args.location, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.equal(play.picks.length, 1);
  const [pick] = play.picks;
  assert.equal(pick.id, "ava.hidden-card");
  assert.deepEqual(pick.filter, { zone: "hand", owner: "controller", keyword: "hidden" });
  assert.equal(pick.selection, "one");
  assert.equal(pick.min, 1);
  assert.equal(pick.max, 1);
});

test("golden: declining the optional payment skips the whole payment/play body", () => {
  const kernel = world()
    .unit("ava", { might: 4 })
    .hand("hidden-card", { types: ["unit"], keywords: [{ id: "hidden" }] })
    .build();
  kernel.setAnswers({ "ava.opt-in/optional": false });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(result => result.id),
    ["ava.opt-in"]
  );
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
  // 拒绝执行：没有任何支付，牌仍留在手里。
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.getObject("hidden-card").zone, "hand");
});

test("golden: choosing to proceed really plays the [Hidden] card with a zero-cost plan", () => {
  // 效果里两个部分都包在同一 choice.optional 下；被选择执行时才逐条执行，链接只作用
  // 于显式写了 linkedTo 的那条（055：能做多少做多少）。
  const kernel = world()
    .unit("ava", { might: 4 })
    .hand("hidden-card", { types: ["unit"], keywords: [{ id: "hidden" }] })
    .build();
  kernel.setAnswers({ "ava.opt-in/optional": true });

  // ava.pay 依赖尚未合入的卡面费用指令（RIFT-261），因此这里只把 body 拆到
  // “pay 之后的 play 指令”为止，验证 effect.play 能真实打出这张 [Hidden] 牌
  // （356.1.b.1 的零费用计划 + 359.3.f 的 here 位置）。
  const play = ability.body[0].args.body.value[1];
  const location = { type: "battlefield", id: "battlefield-1" };
  // 已注册的原语期望“未求值的 Expr 参数”，因此走 chain 的适配器（resolveChainBody），
  // 它保留 Expr 包络、由原语自己做 schema 校验与求值。
  const run = resolveChainBody(
    [
      {
        ...play,
        linkedTo: undefined,
        args: { ...play.args, location: c(location) },
        picks: [
          {
            id: "ava.hidden-card",
            options: ["card-with-hidden-in-controller-hand"],
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ],
    kernel.clone({ picks: new Map([["ava.hidden-card", [kernel.ref("hidden-card")]]]) })
  );

  assert.equal(run.results[0].result.status, "executed");
  assert.equal(run.results[0].result.linkedValues.played, 1);
});

test.todo(
  "Ava Achiever: binding the pick filter ({ zone: hand, Hidden }) into concrete resolution-time " +
    "options, then paying 1 Mind Power and playing the card with a 0/0 finalized cost plan " +
    "(RIFT-8x pick/finalize wiring; cost.pay / cost.modify with the printed projection are " +
    "merged per RIFT-261), plus the attack-declared emission (RIFT-120); the trigger binding " +
    "itself is merged (RIFT-257)."
);
