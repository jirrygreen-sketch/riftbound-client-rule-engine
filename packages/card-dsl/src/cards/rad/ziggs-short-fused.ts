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
 * status = judge-required（见 judgeReason）。本次复核后仍缺三项依赖，均已按合入情况
 * 逐条更新；括号能力提醒文本归属 token 定义，不单独实现。
 * 1. 缺 187.12 的 Bomb gear token 定义：effect.token 的冻结定义表只有 recruit /
 *    sand-soldier / mech / reflection / tentacle，且 TokenSpec 只承载印制统计与
 *    keywords（无能力字段），无法携带 Bomb 的 [Deploy] 与 [Deathknell]；
 *    golden 锁定它在 "bomb" 上返回 negated(impossible, blockedReason
 *    "token-definition-or-abilities-judge-required")。
 * 2. “to a battlefield” 的合法地点不可由静态 IR 生成：effect.token 的 location 必须是
 *    字面 LocationRef，locations + choiceId 形式需要作者侧完整的合法地点列表，IR 没有
 *    “当前所有战场”这样的集合表达式（355.2.a）；地点由 Finalize 的地点提供方解析
 *    （进行中的 RIFT-357 location selection）。
 * 3. Bonus Damage 授予没有消费方：effect.damage 只在结算时对传入的 bonus 表达式做加总
 *    与施加（712–715、418.4/418.5），其文件头明确把“授予来源”交给持续效果/图层；
 *    effects/instructions 与 layers/ 都没有“友方 gear 的能力获得 +1 Bonus Damage”的
 *    注册与消费实现（同 Annie, Fiery ogs-001-024 / Void Gate 的判定）。
 * 依赖：effect.token 定义表扩展（承载自带能力的 token）、进行中的 RIFT-357（location
 * selection / 当前战场枚举）、RIFT-82（Deathknell trigger.leave 展开）、Bonus Damage
 * 的图层授予消费方；CardProgram 绑定（RIFT-257）与 card-played 生产方已合入。
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
        // 440.2.c / 185.2.a：在链上创建 Bomb gear token 后交给 play。location 是
        // 占位战场 id（IR 无法枚举当前合法战场，见 judgeReason 第 2 点），由地点
        // 提供方（进行中的 RIFT-357）替换为真实 LocationRef；占位符自身不是合法战场。
        id: "ziggs.play-bomb",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "bomb" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          location: {
            kind: "constant",
            value: { type: "battlefield", id: "battlefield-chosen-by-effect" }
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
    "本次复核后仍缺三项依赖，均不近似实现：" +
    "(1) CR 187.12 的 Bomb gear token 定义不在 effect.token 的冻结定义表内（只有 recruit / sand-soldier / mech / reflection / tentacle）；" +
    "TokenSpec 只承载印制统计与 keywords、没有能力字段，无法携带 Bomb 的 [Deploy]（830）与 [Deathknell]（808）；" +
    "对 \"bomb\" 执行返回 negated(impossible, blockedReason \"token-definition-or-abilities-judge-required\")。" +
    "(2) 「to a battlefield」的打出位置不可由静态 IR 生成：effect.token 的 location 必须求值为字面 LocationRef，" +
    "locations + choiceId 形式需要作者侧给出完整的合法地点列表，而 IR 没有“当前所有战场”的集合表达式（355.2.a）；" +
    "打出位置不是目标（355.10.b），由 Finalize 的地点提供方解析（进行中的 RIFT-357 location selection）。" +
    "(3) 「Abilities of friendly gear deal 1 Bonus Damage」需要图层/持续效果把 +1 Bonus Damage 授予友方 gear 造成的 Deal 动作：" +
    "effect.damage 只在结算时对传入的 bonus 表达式做加总与施加（CR 712–715、418.4/418.5），其文件头明确把授予来源交给持续效果/图层，" +
    "而 effects/instructions 与 layers/ 都没有该注册/消费实现（同 Annie, Fiery / Void Gate 的判定）。" +
    "已按现有契约写出的部分：‘When you play me’ 是时点 card-played 的触发能力（383.4.a / 420.4.a）。" +
    "依赖：effect.token 定义表扩展（承载自带能力的 token）、进行中的 RIFT-357（location selection / 当前战场枚举）、" +
    "RIFT-82（Deathknell trigger.leave 展开）、Bonus Damage 的图层授予消费方；CardProgram 绑定（RIFT-257）与 card-played 生产方已合入。",
  abilities,
  sourceText:
    "When you play me, play a Bomb gear token to a battlefield. " +
    "(It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)\n" +
    "Abilities of friendly gear deal 1 Bonus Damage."
} satisfies CardProgram;

export default program;
