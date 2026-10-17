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
 *   静态 IR 无法枚举；按已合入的 effect.move 契约，to 只能是字面 LocationRef、controller-base 或
 *   由调用方提供的 { kind: "choose", id, options } 列表（ogn/ride-the-wind 记录同一缺口）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17），三处缺口均不近似实现：
 * - 可选追加费用没有卡牌侧可执行通路：没有原语收取 356.2 的追加费用，也没有把卡牌程序声明的支付组件接进
 *   已合入 cost/ 计划的入口（buildCostPlan 只消费调用方传入的 optionalAdditional；cost.pay / cost.modify
 *   与收费种类属未合入的 RIFT-261）；「横置你的传奇」还需要 Legend Zone 的合法对象空间——契约 ZoneId 词汇
 *   （effects/contract.ts）不含 legend-zone，参考内核亦无该区域（sfd/royal-entourage 记录同一缺口）。
 * - 「if you paid the additional cost」需要 356.4.f.1 的支付回执：冻结 IR 无费用结果绑定
 *   （调研记为 condition.result），第二条指令无法按已付/未付开闸；不伪造恒真条件。
 * - 「to an open battlefield」的 Move 目的地在 Finalize/结算时由规则流程推导（355.4、449、170.11.c）：
 *   冻结 IR 没有「当前所有 open battlefield」的集合表达式，也没有把该局面信息变成 move.to 的
 *   已合入机制；卡牌程序的触发注册同样属未合入的 RIFT-257。Move 与「任意数量」的目标形状本身已按
 *   已合入原语写出，golden 用玩家已选定的具体战场替换 to 后真实执行（与 ogn/ride-the-wind 同一口径）。
 * 依赖：RIFT-257（触发/打出绑定）、RIFT-261（可选追加费用接线与回执）、Legend Zone 契约变更申请、
 * open-battlefield 地点集合的 Finalize 接线。
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
          // 355.4 / 170.11.c：目的地是规则流程推导出的「一个 open battlefield」；静态 IR 只记录
          // effect.move 的 choose 形状与描述性选项集，不写死某个战场（见 judgeReason）。
          to: {
            kind: "constant",
            value: {
              kind: "choose",
              id: "bard-mercurial.destination",
              options: ["runtime:open-battlefields"]
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
    "三处缺口，均不近似实现：(1)「You may exhaust your legend as an additional cost to play me」是 356.2.b/356.2.b.1 的 Optional Additional Cost，" +
    "没有原语收取追加费用（cost.pay / cost.modify 与收费种类属未合入的 RIFT-261），也没有把卡牌程序声明的支付组件接进已合入 cost/ 计划的入口" +
    "（buildCostPlan 只消费调用方传入的 optionalAdditional）；「your legend」还要求 Legend Zone（107.4.b/c、355.9.a.4）的合法对象空间，" +
    "而冻结 ZoneId 词汇（effects/contract.ts）不含 legend-zone、参考内核亦无该区域（同 sfd/royal-entourage 的缺口）。" +
    "(2)「if you paid the additional cost」需要 356.4.f.1 的支付回执（以支付决定为凭证，与实付量无关）：冻结 IR 没有费用/动作结果绑定（调研记为 condition.result），" +
    "第二条指令无法按已付/未付开闸；不伪造恒真条件，也不用费用改写冒充「已支付」。" +
    "(3)「to an open battlefield」的 Move 目的地（355.4、421.1/449、170.11.c：open = 无单位驻守且未被控制）由当前局面推导，" +
    "冻结 IR 没有「所有 open battlefield」的集合表达式，也没有把该信息变成 move.to 的已合入机制；不写死某个战场（ogn/ride-the-wind 记录同一缺口）。" +
    "卡牌程序的触发注册（card-played 订阅）同样属未合入的 RIFT-257。Move 与「任意数量」目标形状已按已合入原语写出，golden 用玩家选定的战场真实执行。" +
    "依赖：RIFT-257（触发/打出绑定）、RIFT-261（费用接线与回执）、Legend Zone 契约变更申请、open-battlefield 地点集合的 Finalize 接线。",
  abilities,
  sourceText:
    "You may exhaust your legend as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, move any number of your units to an open battlefield."
} satisfies CardProgram;

export default program;
