import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ziggs, Short-Fused (rad-023-167) — Unit, 5 energy, 1 power (Fury), 5 Might,
 * tags Bandle City/Ziggs/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-023-167）：
 *   When you play me, play a Bomb gear token to a battlefield. (It has [Deploy]. When it
 *   dies, deal 2 to an enemy there and kill your other Bombs there.)
 *   Abilities of friendly gear deal 1 Bonus Damage.
 *
 * 规则依据（CR v1.5）：
 * - “When you play me”：Play Effect（383.4.a；时点 card-played）。
 * - “play a Bomb gear token to a battlefield”：185.2.a / 440.2.c 规定被“打出”的 token
 *   先在链上生成再进入打出流程（effect.token 的 mode "play"）；187.12 是 Bomb 的定义
 *   （无域 gear token，带 [Deploy] 与 [Deathknell][>] “Deal 2 to an enemy unit here and
 *   kill all other Bombs you control here.”）。“to a battlefield”按 355.10.b 是打出位置
 *   的许可/限制，地点本身不是目标。
 * - 括号内的 [Deploy] / [Deathknell] 是同一个 Bomb token 的能力提醒文本，不是本卡的
 *   第二条独立能力（其展开归 830 / 808 与 token 定义）。
 * - “Abilities of friendly gear deal 1 Bonus Damage.”：418.4 / 418.5 把 Bonus Damage 定义
 *   为授予 Deal 动作的内在属性，712–715 规定其加总与施加；本句的授予范围是“友方 gear 的
 *   能力”（418.6.b.2 能力可作为 Deal 的来源），属持续效果/图层授予。
 *
 * status = judge-required（见 judgeReason）。effect.token 的链上创建/打出交接、
 * LocationExpr 战场选择、continuous.location 的注册/图层查询/Finalize 校验、
 * hold 事件的 battlefieldId 及非单位 Deploy 的清理召回豁免均已有源码实现。
 * 仍缺 Bomb 定义及能力承载、effect.token 的解释器参数适配、Deploy 声明到现有
 * location 规则的绑定与 hold.here 过滤、Deathknell 正文绑定，以及友方 gear 能力
 * Bonus Damage 的自动授予/消费。不能用其它 token 或手动传入 bonus 证明整卡可执行。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "self" } }
    },
    optional: false,
    body: [
      {
        // 440.2.c / 185.2.a：在链上创建 Bomb gear token 后交给 play；LocationExpr
        // 的 choose/filter 声明非目标的战场选择，解释器参数接线缺口见 judgeReason。
        id: "ziggs.play-bomb",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "bomb" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          location: {
            kind: "location",
            value: {
              kind: "choose",
              id: "bomb-token-battlefield",
              filter: { type: "battlefield" }
            }
          },
          linkKey: { kind: "constant", value: "bombToken" }
        }
      }
    ]
  },
  {
    // “Abilities of friendly gear deal 1 Bonus Damage.” — 418.4/418.5/713 的授予；
    // 消费方是持续效果/图层（见 judgeReason），这里的字段是声明性数据。
    kind: "static",
    effect: {
      kind: "continuous.bonus-damage",
      layer: "ability",
      amount: { kind: "constant", value: 1 },
      appliesTo: "deal-actions",
      filter: { type: "gear", controller: "controller", zone: "board" }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-143c51170da933db17fe250dec223607e32fd758ab3825c4f009ce0d78c4d1b5",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "仍缺以下接线，保持裁定且不近似实现：" +
    "(1) CR 187.12 的 Bomb gear token 未加入 effect.token 定义表；TokenSpec 只有印制特征与 keywords，" +
    "缺少承载其 Deploy（830）与 Deathknell 正文（808）的 token 程序绑定。" +
    "(2) effect.token 的 argsSchema 要求 Expr，而 runAbilityBody 分发已求值参数；" +
    "仍缺包括 LocationExpr 战场选择结果在内的 token 参数适配。" +
    "(3) Deploy 的 continuous.location 静态声明尚未转换为现有 location permission/restriction 规则；" +
    "其 hold 过滤器的 here 字段仍被 programs/filters 拒绝，缺少与事件 details.battlefieldId 的宿主地点匹配（830.1.b）；" +
    "Deathknell 展开仍引用未注册的 trigger.leave，Bomb 的死亡正文尚未绑定到 token（187.12 / 808.1）。" +
    "(4) continuous.bonus-damage 的 appliesTo:deal-actions 尚不能由静态绑定器消费；" +
    "缺少把友方 gear 能力的 +1 Bonus Damage 自动传入 effect.damage 的图层/Deal 查询（418.4–418.6、712–715）。",
  abilities,
  sourceText:
    "When you play me, play a Bomb gear token to a battlefield. " +
    "(It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)\n" +
    "Abilities of friendly gear deal 1 Bonus Damage."
} satisfies CardProgram;

export default program;
