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
 * status = judge-required（逐个保留证据，不近似实现；2026-10-17 复核）：
 * - 187.12 Bomb gear token 定义仍未合入：effect.token 的已实现定义表只有 recruit /
 *   sand-soldier / mech / reflection / tentacle，并明确记录“需要其他能力（含 Gold）
 *   的定义保持 blocked / judge-required”。Bomb 带 [Deploy] 与 [Deathknell] 两条
 *   能力，仍需要专门的 token 定义与能力展开才能执行（bomb 请求实测 negated，
 *   blockedReason = token-definition-or-abilities-judge-required）。
 * - “to a battlefield” 已能用 LocationExpr 的 choose + battlefield 过滤表达。
 *   condition.value 绑定所选地点后，effect.token 用 linked-value 消费，兼容其 Expr schema。
 *   仍需把完整战场列表接入该表达式的候选生成：目前只从对象 location 推导候选，
 *   未出现在这些位置中的空战场需要外部 LocationState，而表达式路径尚未传入该列表
 *   （实测：无对象引用时查询不到该战场，传入 options.locations 才出现）。
 * - 括号里的 [Deploy] / [Deathknell] 是同一 token 能力的提醒文本，不是本卡的
 *   另一条独立能力；展开由 token 定义与 830 / 808 关键词负责（Deploy 的 KeywordDef
 *   已合入；Deathknell 的展开体仍引用未注册的 trigger.leave，实测 instructionDefinitionsById
 *   无该 op，也没有原语可消费 ResolveContext.registerDelayedTrigger 钩子）。
 * 已可执行并有真实证据：印刷的 1 Energy + 1 [A] Power + Exhaust 费用由已合入的
 * 费用计划构建并支付（符费用与控制器任意域 Power 匹配，见 golden）。
 * 依赖：effect.token 的 Bomb 定义、Bomb 能力展开与完整战场候选注入。
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
        id: "hexplosives-expert.choose-battlefield",
        op: "condition.value",
        args: {
          value: {
            kind: "location",
            value: {
              kind: "choose",
              id: "hexplosives-expert.battlefield",
              filter: { type: "battlefield" }
            }
          }
        }
      },
      {
        id: "hexplosives-expert.play-bomb",
        // 440.2.c / 185.2.a：在链上创建 Bomb gear token 后交给 play 动作。
        // 地点由前一条非目标选择绑定，避免把占位 id 当成真实战场。
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "bomb" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          location: {
            kind: "linked-value",
            instructionId: "hexplosives-expert.choose-battlefield",
            key: "value"
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
    "保持 judge-required：effect.token 仍缺 187.12 的 Bomb gear token 定义及其 Deploy/Deathknell 正文绑定，" +
    "bomb 请求实测 negated（token-definition-or-abilities-judge-required）；" +
    "Deathknell 展开仍引用未注册的 trigger.leave。另缺完整战场候选注入：355.2.a 的非目标地点选择已能表达，" +
    "但 queryLocationCandidates 目前从对象 location 推导候选，LocationExpr 路径未传入外部 LocationState，" +
    "无法保证包含未被对象位置引用的空战场。",
  abilities,
  sourceText:
    ":rb_energy_1::rb_rune_rainbow:, :rb_exhaust:: Play a Bomb gear token to a battlefield. " +
    "(It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)",
} satisfies CardProgram;

export default program;
