import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Conscription (unl-140-219) — Spell, 5 energy + 2 Chaos power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-140-219，逐字):
 *   You may spend 5 XP as an additional cost to play this.
 *   Choose an enemy unit at a battlefield with 3 :rb_might: or less. If you paid
 *   the additional cost, choose any enemy unit at a battlefield instead. Take
 *   control of it, exhaust it, and recall it.
 *
 * 规则依据（CR v1.5）:
 * - 「You may spend 5 XP as an additional cost to play this.」是可选追加费用
 *   （356.2.b / 356.2.b.1：措辞含 "as an additional cost" 与 "may"），由被动能力
 *   规定，在费用步骤 2 决定是否支付、步骤 4 支付；XP 是 729/730.2 的玩家资源，
 *   支付即减少已标记 XP。费用组件用 cost.additional 形状声明（与已合入的
 *   sfd/zaun-punk 同一写法），可选性由 optional/stage 表达。
 * - 「If you paid the additional cost, choose any enemy unit at a battlefield
 *   instead.」按 356.4.f.1 以「玩家决定支付」为凭证切换目标范围；冻结 IR 没有
 *   费用结果绑定（调研记为 condition.result），因此两个目标范围的分支无法在
 *   数据里开闸。
 * - 「Choose an enemy unit at a battlefield」是 Choice（355.5），所以敌方单位是
 *   目标（355.7 / 355.9.a.1）；「at a battlefield」按 355.10.b 只是目标的
 *   location 限制，不额外指向战场。
 * - 「Take control of it」是 127.1 / 188–192 的控制权改变，由已合入的
 *   effect.control 提交 take-control 动作（默认 permanent）。
 * - 「exhaust it」是 415.1 的横置（effect.exhaust）；「recall it」是 457 的
 *   Recall，不是 Move（458/458.1），已合入的 effect.move 明确标注 mode
 *   "recall" 为 BLOCKED：封闭 move-location 动作无法区分 Recall 与 Move，原语
 *   返回 negated/impossible 与 blockedReason，且不得用普通移动近似（458）。
 *
 * Status: judge-required. Re-checked 2026-10-17 against merged source:
 * the cost plan really builds and pays a caller-supplied 5 XP optional component
 * (cost/cost-plan.ts optionalAdditional), the merged condition.result predicate
 * can read that receipt, and effect.control / effect.exhaust execute on a locked
 * target. Still missing: (1) programs/play.ts rejects the card's cost.additional
 * declaration outright ("Additional costs are not bound"), so Finalize never
 * receives the optional component or its receipt; (2) programs/filters.ts
 * translateObjectFilter rejects mightLte, so the printed "3 Might or less"
 * restriction is never applied to the target range; (3) effect.move's recall mode
 * still returns negated/impossible with blockedReason, because CR 457-460 need an
 * action distinct from move-location.
 */
const abilities: Ability[] = [
  {
    // 356.2.b / 356.2.b.1：由被动能力规定的可选追加费用「支付 5 XP」。
    // 可选性与舞台按费用计划的 optional-additional 形状声明；卡牌接线缺口见 judgeReason。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "conscription.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        {
          kind: "xp",
          amount: { kind: "constant", value: 5 }
        }
      ]
    }
  },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 5 },
      power: { kind: "constant", value: 2 }
    },
    body: [
      {
        id: "conscription.take-control",
        op: "effect.control",
        args: {
          objects: { kind: "constant", value: { target: "conscription.enemy-unit" } }
        },
        targets: [
          {
            id: "conscription.enemy-unit",
            // 355.10.b：敌方单位是目标，「at a battlefield」只是 location 限制；
            // mightLte 记录 143.2.a 的有效 Might 上限，生产过滤器翻译器仍拒绝该
            // 字段（见 judgeReason 第 2 点），因此它不是可执行的 Finalize 限制。
            filter: {
              type: "unit",
              zone: "board",
              controller: "opponent",
              location: "battlefield",
              mightLte: 3
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        // 「exhaust it」：415.1 的横置，作用于同一条文本里的 "it"（355.10.c：
        // 同一指示代词不产生新的选择），因此链接到控制权指令（359.3.e.14）。
        id: "conscription.exhaust",
        op: "effect.exhaust",
        linkedTo: "conscription.take-control",
        args: { target: { kind: "constant", value: "conscription.enemy-unit" } }
      },
      {
        // 「and recall it」：457 的 Recall（不是 Move，458/458.1）。原语接受
        // mode "recall"，但明确阻断执行并给出 blockedReason，不替换成普通移动。
        id: "conscription.recall",
        op: "effect.move",
        linkedTo: "conscription.exhaust",
        args: {
          objects: { kind: "constant", value: { target: "conscription.enemy-unit" } },
          to: { kind: "constant", value: "controller-base" },
          mode: { kind: "constant", value: "recall" },
          linkKey: { kind: "constant", value: "recalled" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-25d95fca3a71b0c54c47c59f37cb281740cdfe6478a2d0f9c23309aaff471bcd",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "仍缺三段接线（2026-10-17 复核，均不近似实现）：" +
    "(1) programs/play.ts::translateCost 直接拒绝本卡的 cost.additional 声明（\"Additional costs are not bound for ...\"），" +
    "Finalize 因此拿不到 optionalAdditional 组件与其支付回执，据回执切换目标范围（CR 356.2.b/356.2.b.1/356.4.f.1）无法执行；" +
    "费用计划本身已能真实构建并支付调用方提供的 5 XP 组件，condition.result 也已能读回执，缺的只是卡牌声明→费用计划的绑定；" +
    "(2) 有效 Might 上限（CR 143.2.a）：programs/filters.ts 的 translateObjectFilter 仍拒绝 mightLte（\"Unsupported filter field mightLte\"），" +
    "TargetSpec 也没有动态数值谓词入口，Finalize 目标的 3 Might 上限不生效；" +
    "(3) Recall（CR 457–460）：effect.move 的 recall 模式仍显式返回 negated/impossible 与 blockedReason" +
    "（\"Recall requires an action distinct from Move\"），缺独立 Recall 动作，不能以 move-location 近似。" +
    "已合入并可执行：effect.control 与 effect.exhaust（golden 已对锁定单位真实执行）、XP 费用计划与支付。",
  abilities,
  sourceText:
    "You may spend 5 XP as an additional cost to play this.\n" +
    "Choose an enemy unit at a battlefield with 3 :rb_might: or less. If you paid the additional cost, choose any enemy unit at a battlefield instead. Take control of it, exhaust it, and recall it."
} satisfies CardProgram;

export default program;

