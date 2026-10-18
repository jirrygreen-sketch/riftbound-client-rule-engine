import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Udyr, Wildman (ogn-157-298) — Unit（能量 6，力量 1，Might 6，Body；Udyr/Freljord/Champion）。
 *
 * 原文：
 *   Spend my buff: Choose one you've not chosen this turn —
 *   Deal 2 to a unit at a battlefield. Stun a unit at a battlefield. Ready me.
 *   Give me [Ganking] this turn.
 *
 * 规则依据（CR v1.5）：
 * - 377.1 / 204.1.b："Spend my buff:" 是启动能力的 Base Cost（冒号前的费用）；
 *   702.2.b 的 spend a buff 是受限动作，cost/README.md 已支持
 *   `payments[{kind: "spend-buff", object: "self", amount}]` 的费用形态。
 * - 381 / 381.1：未标注速度的启动能力只能在控制者 Main Phase 的 Open State 启动，
 *   故 timing 为 "action"。
 * - 355.3 / 403.2："Choose one…" 是 Finalize 时的模式选择，用 choice.mode
 *   （contract 3.9：count 1、different true；模式各自带 body）。
 * - 418.1/418.1.e："Deal 2 to a unit at a battlefield" 是固定 2 点伤害（不涉及分摊）。
 * - 424：Stun 是状态；effect.stun 已是合入原语（"a unit at a battlefield" 用
 *   location 过滤）。
 * - 416.1/416.2："Ready me" 用 effect.ready 的 source 选择。
 * - 801.3.a："Give me [Ganking] this turn" 是限时关键词授予（Granted Keyword，
 *   810 的 Ganking 权限），需要限时持续效果而非直接改写特征。
 *
 * status 判定：judge-required（复核 2026-10-18）。
 * - “Choose one you've not chosen this turn” 仍缺跨启动的本回合模式账本；
 *   choice.mode 的 different 只在一次结算内去重。355.3 / 403.2 要求 Finalize 时
 *   选择模式及相应目标，chain/engine.ts 仍拒绝 choice.mode，缺 choice-plan adapter。
 * - Ganking 的 KeywordGrantLayerEngine 已能展开授予并规范化 movement 许可，
 *   但默认 ChainEngine / attachProgramLifecycle 未接入动态关键词二次展开；
 *   不能只由普通 LayerEngine 读到关键词就声称 Standard Move 许可已生效。
 * - chain/interpreter-adapter.ts 的 LITERAL_FIELDS 未解包 effect.stun.target，
 *   原始 Stun 模式 body 经该适配器会抛 target must be a spec id string；
 *   直接 runAbilityBody 的局部 Stun 成功不能证明该生产桥接路径已可用。
 * - golden 真实执行 spend-buff 费用、各模式 body 和 Ganking 的回合结束到期，
 *   并单独验证关键词适配器中的移动许可；这些局部证据不替代模式 Finalize 和账本。
 * 不删掉“本回合未选过”的限制，不近似实现。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    cost: {
      payments: [
        {
          kind: "spend-buff",
          object: "self",
          amount: { kind: "constant", value: 1 }
        }
      ]
    },
    timing: "action",
    body: [
      {
        id: "udyr.choose-mode",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              {
                id: "udyr.damage-mode",
                body: [
                  {
                    id: "udyr.deal-2",
                    op: "effect.damage",
                    args: {
                      amount: { kind: "constant", value: 2 },
                      target: { kind: "constant", value: "udyr.damage-target" }
                    },
                    targets: [
                      {
                        id: "udyr.damage-target",
                        filter: { type: "unit", location: { type: "battlefield" } },
                        min: 1,
                        max: 1,
                        selection: "one"
                      }
                    ]
                  }
                ]
              },
              {
                id: "udyr.stun-mode",
                body: [
                  {
                    id: "udyr.stun-unit",
                    op: "effect.stun",
                    args: { target: { kind: "constant", value: "udyr.stun-target" } },
                    targets: [
                      {
                        id: "udyr.stun-target",
                        filter: { type: "unit", location: { type: "battlefield" } },
                        min: 1,
                        max: 1,
                        selection: "one"
                      }
                    ]
                  }
                ]
              },
              {
                id: "udyr.ready-mode",
                body: [
                  {
                    id: "udyr.ready-self",
                    op: "effect.ready",
                    args: { objects: { kind: "constant", value: { kind: "source" } } }
                  }
                ]
              },
              {
                id: "udyr.ganking-mode",
                body: [
                  {
                    id: "udyr.grant-ganking",
                    op: "continuous.grant-keyword",
                    args: {
                      keyword: { kind: "constant", value: "Ganking" },
                      duration: { kind: "constant", value: "end-of-turn" },
                      objects: { kind: "constant", value: { kind: "source" } }
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-fa80adfa87e517c318ff696460904b28aeb38024b68666372f0109ecf2757882",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "当前缺口（复核 2026-10-18）：(1)「Choose one you've not chosen this turn」缺跨启动的" +
    "本回合选择记忆账本，choice.mode 的 count/different 只在单次结算内去重。" +
    "(2) 355.3 / 403.2 要求 Finalize 时选择模式及对应目标，chain/engine.ts 仍拒绝 choice.mode" +
    "（Mode choices require a Finalize/Resolve choice-plan adapter），生产链缺该 choice-plan adapter。" +
    "(3) 默认 ChainEngine 使用普通 LayerEngine，attachProgramLifecycle 尚未接入 " +
    "KeywordGrantLayerEngine 的动态授予展开，Ganking 模式在默认链路仅添加关键词，未产生 " +
    "810.1.c / 144.4.c.1 的 Standard Move 许可。(4) chain/interpreter-adapter.ts 的 " +
    "LITERAL_FIELDS 缺 effect.stun.target 解包，原始 Stun 模式经该适配器抛 target must be a spec id string。" +
    "不近似实现。",
  abilities,
  sourceText:
    // 逐字保留 catalog 原文：四个模式之间只有 "."、没有空格或换行（数据疑点已上报，未修改）。
    "Spend my buff: Choose one you've not chosen this turn —\n" +
    "Deal 2 to a unit at a battlefield.Stun a unit at a battlefield.Ready me.Give me [Ganking] this turn."
} satisfies CardProgram;

export default program;
