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
 * status = judge-required（见 judgeReason）。本次复核后仍缺四项真实依赖，均已按当前
 * 合入情况核实；括号能力提醒文本归属 token 定义，不单独实现。
 * 1. 缺 187.12 的 Bomb gear token 定义：effect.token 的冻结定义表只有 recruit /
 *    sand-soldier / mech / reflection / tentacle，且 TokenSpec 只承载印制统计与
 *    keywords（无能力字段），无法携带 Bomb 的 [Deploy] 与 [Deathknell]；对 "bomb"
 *    执行返回 negated(impossible, blockedReason
 *    "token-definition-or-abilities-judge-required")。
 * 2. 「to a battlefield」的 LocationExpr 选择器已能解析当前战场，但 effect.token 的解释器
 *    分发仍把已求值参数交给只接受 Expr 的冻结 argsSchema，动态地点尚未接到 token 原语；
 *    因此 token 执行边界仍需要一个具体 LocationRef。
 * 3. Bomb 的 Deploy/Deathknell 展开仍缺消费方：continuous.location 的 Finalize 目的地
 *    校验、Deploy hold 触发的注册与地点过滤尚未接通；Deathknell [Effect] 正文所需的
 *    trigger.leave 原语仍未注册，因此 “deal 2 to an enemy unit here and kill all other
 *    Bombs you control here” 的 here 地点与集合消灭形态都没有展开。
 * 4. Bonus Damage 授予没有消费方：effect.damage 只在结算时对传入的 bonus 表达式做加总
 *    与施加（712–715、418.4/418.5），effects/instructions 与 layers/ 都没有把“友方
 *    gear 的能力获得 +1 Bonus Damage”注册并消费到 Deal 动作的实现。
 * 位置选择器、CardProgram 绑定与 card-played 生产方均已有实现；因此仅保留上述四项
 * 真实缺口，不把已合入能力写成 judgeReason。
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
        // 的 choose/filter 让 Finalize 从当前战场候选中给出具体 LocationRef。
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
    "本次复核后仍缺四项真实依赖，均不近似实现：" +
    "(1) CR 187.12 的 Bomb gear token 定义不在 effect.token 的冻结定义表内（只有 recruit / sand-soldier / mech / reflection / tentacle）；" +
    "TokenSpec 只承载印制统计与 keywords、没有能力字段，无法携带 Bomb 的 [Deploy]（830）与 [Deathknell]（808）；" +
    "对 \"bomb\" 执行返回 negated(impossible, blockedReason \"token-definition-or-abilities-judge-required\")。" +
    "(2) LocationExpr 选择器虽已能解析当前战场，但 effect.token 的解释器分发仍把已求值参数交给只接受 Expr 的冻结 argsSchema，" +
    "动态地点尚未接到 token 原语，执行边界仍需要具体 LocationRef。" +
    "(3) Bomb 的 Deploy/Deathknell 展开仍缺消费方：continuous.location 的 Finalize 目的地校验、" +
    "Deploy hold 触发的注册与地点过滤尚未接通；Deathknell [Effect] 正文所需的 trigger.leave 原语仍未注册，" +
    "因此 \"deal 2 to an enemy unit here and kill all other Bombs you control here\" 的 here 地点与集合消灭形态都没有展开。" +
    "(4) \"Abilities of friendly gear deal 1 Bonus Damage\" 需要图层/持续效果把 +1 Bonus Damage 授予友方 gear 造成的 Deal 动作：" +
    "effect.damage 只在结算时对传入的 bonus 表达式做加总与施加（CR 712–715、418.4/418.5），" +
    "而 effects/instructions 与 layers/ 都没有该注册/消费实现。" +
    "已按现有契约写出的部分：‘When you play me’ 是时点 card-played 的触发能力（383.4.a / 420.4.a）；" +
    "CardProgram 绑定和 card-played 生产方也已可用。",
  abilities,
  sourceText:
    "When you play me, play a Bomb gear token to a battlefield. " +
    "(It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)\n" +
    "Abilities of friendly gear deal 1 Bonus Damage."
} satisfies CardProgram;

export default program;
