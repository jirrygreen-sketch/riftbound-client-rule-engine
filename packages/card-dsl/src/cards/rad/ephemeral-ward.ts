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
 * - "Your units have +2 [M]" 的算术层求值已合入（RIFT-258 的 continuous.might 能注册该形态，
 *   本卡也按图层契约声明了 ContinuousEffect），但没有任何已合入路径把 CardProgram 的 static
 *   能力注册成 ContinuousEffectSpec：registerContinuousEffect 没有调用方，engine-core 从不读取
 *   卡牌程序能力，卡牌文件无法在运行时自行注册（同一缺口见 rad/packed-amphitheater 与
 *   sfd/rumble-scrapper）。接线属 RIFT-257（卡牌程序绑定）。
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
    "「Your units have +2 [M]」的算术层（475-479 的 arithmetic 层）已能执行：continuous.might（RIFT-258）" +
    "可注册该形态，golden 用真实 LayerEngine 断言 Might 2→4。仍未合入的是「CardProgram 的 static 能力 → ContinuousEffectSpec 注册」" +
    "这条接线：registerContinuousEffect 没有调用方，engine-core 的源码从不读取卡牌程序能力，卡牌文件无法在运行时自行注册" +
    "（同 rad/packed-amphitheater、sfd/rumble-scrapper、ogn/trifarian-war-camp 的缺口），依赖 RIFT-257（卡牌程序绑定）。" +
    "「When you play a unit, kill this」只用已合入的 effect.kill（self:true，429.1），golden 测试用链式解释器 + 参考内核真实执行。" +
    "不近似实现。",
  abilities,
  sourceText: "Your units have +2 :rb_might:.\nWhen you play a unit, kill this."
} satisfies CardProgram;

export default program;
