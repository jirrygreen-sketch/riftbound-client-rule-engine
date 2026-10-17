import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Bard, Mercurial (sfd-079-221) — Unit, Mind, Bard/Champion.
 * energy 4, power 1 (Mind), Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-079-221，逐字）:
 *   "You may exhaust your legend as an additional cost to play me.\n"
 *   "When you play me, if you paid the additional cost, move any number of your units to an open
 *   battlefield."
 *
 * 规则依据（CR v1.5）:
 * - "You may exhaust your legend as an additional cost to play me"：356.2.b/356.2.b.1 的
 *   Optional Additional Cost（355.1.a 决定、356.2 施加）；横置作为费用属 cost.exhaust（415.3.a/415.5），
 *   effect.exhaust 文件头明确费用式横置不归它。"your legend" 的合法来源区域是 Legend Zone
 *   （107.4.b/c、355.9.a.4；174.2.b：传奇在对局中固定在 Legend Zone）。
 * - "When you play me"（383.4.a/420.4.a）：Play Effect，时点 card-played，{ source: "self" }。
 * - "if you paid the additional cost"：356.4.f.1——「支付」以玩家的支付决定为凭证，与实付量无关；
 *   这是 359.3.e.14.b 的直接引用游戏动作型条件。
 * - "move any number of your units"（355.12/355.13）："any number"/"up to" 的选择按目标处理且可以为 0，
 *   故 TargetSpec 用 min: 0 / selection: "up-to"，数量上限用 count 表达式读本次已选目标个数（同已合入的
 *   sfd/azir-sovereign "any number of your token units"）。"your units" = 你控制的单位（190.6.d）。
 * - "to an open battlefield"（421.1/449.1：Move 是永久物在两个 Location 之间的移动；170.11.c：
 *   Battlefield 为 open 指它既无单位驻守也不被控制）：目的地是当前局面推导出的合法 Location，
 *   使用 LocationExpr 的 choose/filter 求值；完整空战场状态的生产接线见 judgeReason。
 *
 * 当前复核：保持 judge-required；具体未接通路径见 judgeReason。
 */
const abilities: Ability[] = [
  {
    // 356.2.b/356.2.b.1：Optional Additional Cost，支付组件是 415 的横置（cost.exhaust，非 effect.exhaust）。
    // 合法来源是 Legend Zone 中的传奇（107.4、355.9.a.4）；该区域的词汇缺口见 judgeReason。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "bard-mercurial.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        {
          kind: "exhaust",
          amount: { kind: "constant", value: 1 },
          choice: {
            id: "bard-mercurial.your-legend",
            // 描述性占位：传奇位于 Legend Zone（107.4），该区域不在冻结 ZoneId 词汇里，
            // Finalize 无法枚举合法选项（见 judgeReason）。
            options: ["runtime:controller-legend-zone-legends"],
            selection: "one",
            filter: { type: "legend", owner: "self" }
          }
        }
      ]
    }
  },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        // 「if you paid the additional cost」的门控缺失（356.4.f.1 的支付回执 = condition.result 类缺口），
        // 故不加恒真条件、也不把费用改写成效果（见 judgeReason）。
        id: "bard-mercurial.move-units",
        op: "effect.move",
        args: {
          objects: { kind: "constant", value: { target: "bard-mercurial.units" } },
          // 355.4 / 170.11.c：结算时只向玩家提供无单位且未被控制的战场。
          to: {
            kind: "location",
            value: {
              kind: "choose",
              id: "bard-mercurial.destination",
              filter: { type: "battlefield", open: true }
            }
          },
          // 「any number」的上界 = 本次实际选中的单位个数（355.13、359.3.e.11）。
          amount: {
            kind: "count",
            subject: "objects",
            filter: { object: { target: "bard-mercurial.units" } }
          },
          linkKey: { kind: "constant", value: "moved" }
        },
        targets: [
          {
            id: "bard-mercurial.units",
            filter: { type: "unit", zone: "board", controller: "self" },
            min: 0,
            selection: "up-to"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-d0bb5c231d56b1471ca1416b33625cc0bae9efda10d8be949cbeec564cbf0a70",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "可选附加费用（356.2.b/356.2.b.1）尚未由 programs/play.ts 从 static cost.additional 收集进 Finalize；356.4.f.1 的支付决定收据也没有 CardProgram Condition 绑定。" +
    "“exhaust your legend” 缺 effects/contract.ts ZoneId 与 cost/payment.ts 的 legend-zone 付款对象支持（107.4.b/c、355.9.a.4），不能以基地中的传奇冒充。" +
    "开放战场谓词（170.11.c）已可表达，但生产解释器未收到完整战场 LocationState：空战场不在 context.query 的对象 location 中，需把 CombatFlow 的控制/占用状态传入地点候选查询，才能覆盖所有开放地点。",
  abilities,
  sourceText:
    "You may exhaust your legend as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, move any number of your units to an open battlefield."
} satisfies CardProgram;

export default program;
