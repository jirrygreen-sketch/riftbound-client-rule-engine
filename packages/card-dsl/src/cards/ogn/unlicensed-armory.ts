import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Unlicensed Armory (ogn-023-298) — Gear, 2 Energy, Fury.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-023-298):
 *   Discard 1, :rb_exhaust:: Choose a friendly unit. The next time it dies this
 *   turn, you may pay :rb_rune_fury: to recall it exhausted instead. (Send it to
 *   base. This isn't a move.)
 *
 * 规则依据（CR v1.5）：
 * - 费用 “Discard 1, :rb_exhaust::” 是 Gear 启动能力的启动费用（151、151.2；
 *   423.3 弃牌费用不可退；415.3.a/415.5 横置作为费用），由费用计划支付，
 *   与效果弃牌（effect.discard）分开。
 * - “Choose a friendly unit.” 选目标（355.10；规则书 355.10.c 的示例明确
 *   「Choose a friendly unit. The next time it would die this turn, …」会选目标）。
 * - “The next time it dies this turn, you may pay :rb_rune_fury: to recall it
 *   exhausted instead.” 是替代效果（“would/instead” 族）：本次替代窗口只作用于
 *   本回合、只对所选单位的第一次死亡生效，替代后的结果以 Recall 收场。
 *   457–458 规定 Recall 不是 Move、不可被移动限制阻止；459/460 允许 Recall 装备与
 *   永久物并保持状态，本卡额外写明“exhausted”。
 *
 * status = judge-required：
 * - 没有已注册原语消费 `ctx.registerDelayedTrigger` / 注册延迟替代（contract 3.5 的
 *   替代族，仅引擎内部有 registerReplacement），本回合一次性的「下一次死亡」窗口无法登记；
 * - Recall 不能由 effect.move 近似：effect.move 文档明确 mode "recall" 被显式阻断
 *   （“Recall requires an action distinct from Move”，CR 457–460），内核也没有
 *   Recall 动作；
 * - 替代里的「you may pay :rb_rune_fury:」需要可选的费用支付（cost.pay 原语尚未合入，
 *   与支付凭证），并且是替代效果内的可选支付。
 * 费用半段（discard 1 + 横置自身）完全可用已合入的费用计划执行，golden 测试真实收取。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    // “Discard 1, :rb_exhaust::” — 弃 1 张牌与横置自身都是启动费用（423.3、415.3.a）。
    cost: {
      kind: "activated",
      payments: [
        {
          kind: "discard",
          amount: { kind: "constant", value: 1 },
          choice: {
            id: "unlicensed-armory.discarded-card",
            options: ["card-in-controller-hand"],
            min: 1,
            max: 1,
            selection: "one",
            zone: "hand",
            owner: "controller"
          }
        },
        { kind: "exhaust" }
      ]
    },
    timing: "action",
    body: [
      {
        // “Choose a friendly unit. The next time it dies this turn, you may pay
        // :rb_rune_fury: to recall it exhausted instead.”
        // 这是一个「下一次死亡」的延迟替代（392/393、would-instead 族），消费方是
        // 替代管线；目前没有已注册原语，见 judgeReason。/args 里的 instead 体只是
        // 数据描述，其中对所选单位使用契约 3.6 的 { target: ... } 选择器。
        id: "unlicensed-armory.register-death-replacement",
        op: "replacement.event",
        args: {
          event: { kind: "constant", value: "object-killed" },
          window: { kind: "constant", value: "next-time-this-turn" },
          optional: { kind: "constant", value: true },
          cost: { kind: "constant", value: { power: 1, domain: "Fury" } },
          instead: {
            kind: "constant",
            value: [
              {
                id: "unlicensed-armory.recall",
                op: "effect.move",
                args: {
                  objects: { kind: "target", id: "unlicensed-armory.friendly-unit" },
                  to: { kind: "constant", value: { type: "base", player: "controller" } },
                  mode: { kind: "constant", value: "recall" },
                  state: { kind: "constant", value: "exhausted" }
                }
              }
            ]
          }
        },
        targets: [
          {
            id: "unlicensed-armory.friendly-unit",
            // “a friendly unit”：己方单位（740.1.a），在 Board 上（355.10.a）。
            filter: { type: "unit", controller: "controller", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-ddece30c6d18303c9787328b9faf639d34a6e7c0fa1d4d6f6ff5202877e1a0af",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺延迟替代登记与 Recall：没有已注册原语消费 ctx.registerDelayedTrigger / 注册“本回合下一次死亡”" +
    "的延迟替代（契约 3.5 替代族，仅引擎内部有 registerReplacement）；effect.move 文档明确 " +
    "mode \"recall\" 被显式阻断（Recall 必须是与 Move 不同的动作，CR v1.5 457–460），内核也" +
    "没有 Recall 动作，不能用普通 move-location 或离区再入场近似；替代内的可选 " +
    "「you may pay :rb_rune_fury:」需要尚未合入的 cost.pay 原语与支付凭证。费用半段" +
    "（discard 1 + 横置自身）已用已合入的费用计划真实执行。依赖：RIFT-120（替代注册管线）、" +
    "RIFT-109（prim-effect-move 的 Recall 支持）、RIFT-89（cost.pay）。",
  abilities,
  sourceText:
    "Discard 1, :rb_exhaust:: Choose a friendly unit. The next time it dies this turn, " +
    "you may pay :rb_rune_fury: to recall it exhausted instead. (Send it to base. This isn't a move.)"
} satisfies CardProgram;

export default program;
