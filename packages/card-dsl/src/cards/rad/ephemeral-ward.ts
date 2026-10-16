import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ephemeral Ward (rad-039-167) — Unit, 4 energy + 2 Calm power, no printed Might.
 *
 * 原文："Your units have +2 :rb_might:.\nWhen you play a unit, kill this."
 *
 * 规则依据（CR v1.5）：
 * - "Your units have +2 [M]"：静态持续效果，arithmetic 层的 Might 加算（143.2.a 的
 *   Effective Might / 475 图层）。作用范围是你控制的所有单位（含本体）。
 * - "When you play a unit, kill this."：Play Effect（420.4.a："打出"完成的时点
 *   card-played）；filter 限定被打出的牌是单位且由本卡的操控者打出；本体是"this"，
 *   用 effect.kill 的 self:true 表达（429.1 的效果性消灭）。原文没有 "another"，
 *   因此打出本卡自身也满足条件，不做额外排除。
 *
 * status 判定（README 第 2 节）：judge-required。缺口：
 * - "Your units have +2 [M]" 的持续效果没有已合入的卡牌侧消费路径：LayerEngine 只消费
 *   经 ResolveContext.addContinuous 注册的 ContinuousEffectSpec，而 CardProgram 的
 *   static 能力目前没有注册进图层引擎的接线（RIFT-91 落地了图层本身，尚未落地
 *   "CardProgram static → 注册持续效果" 这一步），故静态 +2 [M] 不可执行。
 *   依赖：RIFT-91（layers-continuous）与后续把卡牌 static 能力接入图层的接线任务。
 * kill 部分只用已合入的 effect.kill，见 golden 测试（参考内核真实执行）。
 */

const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 2 },
      filter: { type: "unit", controller: "controller", zone: "board" }
    }
  },
  {
    kind: "triggered",
      trigger: {
        at: "card-played",
        // "When you play a unit"：打出完成时点（420.4.a），玩家是能力控制者、牌是单位；
        // 原文没有 "another"，打出本卡自身也满足条件。
        filter: { event: "card-played", filter: { type: "unit", player: "controller" } }
      },
    optional: false,
    body: [
      {
        id: "ephemeral-ward.kill-this",
        op: "effect.kill",
        args: {
          self: { kind: "constant", value: true },
          reason: { kind: "constant", value: "card-played-unit" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-9ec6311582c4337e549c7a39070aeaf28ae3996142538fa2fb11c3b16cebcf5b",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「Your units have +2 [M]」是 arithmetic 层静态持续效果，但 CardProgram 的 static 能力没有注册进 " +
    "图层引擎的已合入路径（LayerEngine 只消费经 ResolveContext.addContinuous 注册的 " +
    "ContinuousEffectSpec；RIFT-91 落地了图层本身，卡牌 static → 持续效果的接线仍未合入），" +
    "缺少 continuous.might 的卡牌侧消费方。依赖：RIFT-91（layers-continuous）及其后续接线。" +
    "「When you play a unit, kill this」只用已合入的 effect.kill（self:true，429.1），" +
    "golden 测试用链式解释器 + 参考内核真实执行。",
  abilities,
  sourceText: "Your units have +2 :rb_might:.\nWhen you play a unit, kill this."
} satisfies CardProgram;

export default program;
