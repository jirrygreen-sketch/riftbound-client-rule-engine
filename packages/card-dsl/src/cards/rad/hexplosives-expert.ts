import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Hexplosives Expert (rad-141-167) — Legend, Fury/Chaos, tags Yordle/Ziggs.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-141-167，逐字）：
 *   :rb_energy_1::rb_rune_rainbow:, :rb_exhaust:: Play a Bomb gear token to a
 *   battlefield. (It has [Deploy]. When it dies, deal 2 to an enemy there and
 *   kill your other Bombs there.)
 *
 * 规则依据（CR v1.5）：
 * - 377.1 / 404.1.a / 415.5：“:” 之前是费用——1 Energy、1 点 [A] Power 与横置来源。
 *   135.2.e.5.a 规定 [A] 作为费用可由任一域 Power 支付，合并费用管线把它表达为
 *   allowedDomains 覆盖六域的 power 支付（cost/plan-values.ts 的 domains() 校验）。
 *   本卡没有 [Reaction] / [Action]，按 381.1 是 Action 时机。
 * - 174.8 / 376：Legends 可以有启动能力，能力进链后像法术一样结算；160.1 规定传奇
 *   在其领域内是 domain identity，不影响本能力的费用结构。
 * - “Play a Bomb gear token to a battlefield”：185.2.a / 440.2.c 规定被“打出”的
 *   token 先在链上生成再进入打出流程，对应 effect.token 的 mode: "play"。
 * - 187.12：Bomb 是“无域 gear token，带 [Deploy] 与 [Deathknell][>] Deal 2 to an
 *   enemy unit here and kill all other Bombs you control here.”。该 token 自带能力
 *   （[Deploy] = 830，[Deathknell] = 808），不是纯统计 token。
 * - 355.10.b：“to a battlefield” 是打出位置的许可/限制，地点本身不是目标
 *   （“Play a unit from your hand to a battlefield” doesn’t target a battlefield）。
 *
 * status = judge-required（逐个保留证据，不近似实现）：
 * - 187.12 Bomb gear token 定义仍未合入：effect.token 的已实现定义表只有 recruit /
 *   sand-soldier / mech / reflection / tentacle，并明确记录“需要其他能力（含 Gold）
 *   的定义保持 blocked / judge-required”。Bomb 带 [Deploy] 与 [Deathknell] 两条
 *   能力，属于同一类被显式排除的定义；golden 锁定 effect.token 在该定义上返回
 *   negated(impossible, blockedReason "token-definition-or-abilities-judge-required")。
 * - “to a battlefield” 的合法地点无法由冻结 IR 生成：effect.token 的 location 必须
 *   求值为字面 LocationRef（{type:"battlefield", id}），options 形式（locations +
 *   choiceId）要求作者侧提供完整的合法地点列表，而 IR 的 Expr 没有“当前所有战场”
 *   这样的集合表达式（355.2.a 的合法位置由规则流程产生）；地点选择属 RIFT-90 目标
 *   计划与 RIFT-257 卡牌绑定的后续。
 * - 括号里的 [Deploy] / [Deathknell] 是同一 token 能力的提醒文本，不是本卡的
 *   另一条独立能力；展开由 token 定义与 830 / 808 关键词负责（Deploy 的 KeywordDef
 *   已合入，Deathknell 的展开体仍引用未注册的 trigger.leave）。
 * 已可执行并有真实证据：印刷的 1 Energy + 1 [A] Power + Exhaust 费用由已合入的
 * 费用计划构建并支付（符费用与控制器任意域 Power 匹配，见 golden）。
 * 依赖：effect.token 的定义表扩展（RIFT-62）、地点选择（RIFT-90）、RIFT-257。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 1 },
      // [A]（135.2.e.5.a：作为费用可由任一域 Power 支付）是**一个** Power 需求，
      // allowedDomains 覆盖六域；写成 power 域列表会变成六个各自限定单域的需求，
      // 与印刷符号不同。
      payments: [
        {
          kind: "power",
          amount: { kind: "constant", value: 1 },
          allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
        },
        { kind: "exhaust", object: "self" }
      ]
    },
    body: [
      {
        id: "hexplosives-expert.play-bomb",
        // 440.2.c / 185.2.a：在链上创建 Bomb gear token 后交给 play 动作。
        // location 用字面 “某个战场” 的占位 id：IR 无法枚举当前合法战场（见
        // judgeReason），占位不会让指令成功，golden 锁定它被原语拒绝。
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
  }
];

const program = {
  canonicalCardId:
    "card.hash-35388dd2b47ca5aff627f64dbadee600be5e2d4c7d1f00c2d412147b43679458",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 187.12 的 Bomb gear token 定义：effect.token 的已实现定义表只有 recruit / sand-soldier / mech / reflection / " +
    "tentacle，并明确把“需要其他能力的定义”（Bomb 带 [Deploy] 与 [Deathknell]）保持 blocked / judge-required，" +
    "原语在该 id 上返回 negated(impossible, blockedReason token-definition-or-abilities-judge-required)（golden 断言）。" +
    "打出位置 “to a battlefield” 同样不可表达：effect.token 的 location 必须求值为字面 LocationRef，" +
    "locations + choiceId 需要作者侧给出完整合法地点列表，而冻结 IR 没有“当前所有战场”的集合表达式（355.2.a；属 RIFT-90 目标计划与 RIFT-257 卡牌绑定的后续）。" +
    "已可执行并有真实证据：1 Energy + 1 [A] Power + Exhaust 的费用由已合入的费用计划构建并支付。" +
    "依赖：effect.token 定义表扩展（RIFT-62）、RIFT-90、RIFT-257；不近似实现。",
  abilities,
  sourceText:
    ":rb_energy_1::rb_rune_rainbow:, :rb_exhaust:: Play a Bomb gear token to a battlefield. " +
    "(It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)",
} satisfies CardProgram;

export default program;
