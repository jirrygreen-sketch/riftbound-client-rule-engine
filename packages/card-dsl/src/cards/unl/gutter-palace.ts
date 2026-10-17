import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Gutter Palace (unl-088-219) — Gear, Mind。
 * energy 4、power null（无印刷 Power）、might null（无印刷 Might）、tags []。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-088-219，逐字）：
 *   At the start of your Beginning Phase, if you have exactly 4 cards in hand
 *   and exactly 4 units at battlefields, you win the game.
 *   Discard 1, :rb_exhaust:: Play a 1 :rb_might: Bird unit token with [Deflect].
 *
 * 规则依据（CR v1.5）：
 * - 315.2.a.1 / 383.2.a：At the start of your Beginning Phase 是 Trigger Condition，
 *   对应封闭时点 beginning-start；your 由该能力的控制者判定。
 * - 383.2.a.1：紧跟 Trigger Condition 的 if ... 从句属于 Trigger Condition 本身
 *   （CR 原文的 Loose Cannon 例证），因此两个计数条件写在 TriggerSpec.condition，
 *   不写进 body 指令的 condition。
 * - 194 / 196、470.1 / 470.3：you win the game 是直接胜负判定，由 effect.win 提交
 *   { type: win }（该原语文件头明确：它不替代计分、不检查 Victory Score）。
 * - 355.10.d.2：计数条件里的对象是按特征程序化选定的集合，不是选择、也不是目标。
 * - 423 / 423.1 / 423.3：Discard 1 出现在冒号之前，是费用（作为费用时必须能完成），
 *   由 cost 的 discard 支付分量表达，不用 effect.discard。
 * - 415.4 / 415.5 / 357.2：:rb_exhaust: 是「横置自身」的费用；Gear 启动能力默认在控制者
 *   Main Phase 的 Open State 执行（151 / 151.2），即 timing: action。
 * - 187.7 / 440.2.c / 185.2.a / 355.2：Play a 1 :rb_might: Bird unit token with [Deflect]
 *   是无域、1 Might、Bird 标签、带 [Deflect] 的单位 token，按打出 token 的规则在链上生成后
 *   打出；地点未印刷，按 355.2 在打出流程中选择合法 Location。
 *
 * status = judge-required：
 * - 缺 187.7 的 Bird token 定义与 Deflect 的 token 能力装配。
 * - effect.token.argsSchema 不接受 LocationExpr，链适配器保留原始 Expr 而未适配目的地。
 * - 启动费用的 PickSpec 尚未动态绑定为 Finalize 的精确手牌引用。
 * - EventPipeline 已能求值 exact-count 条件，但直接使用宿主 context.query；
 *   本卡的 controller 相对玩家与 battlefield 类型过滤尚无统一宿主查询接线。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "beginning-start",
      filter: { event: "beginning-start", player: "self" },
      // 383.2.a.1：紧跟 Condition 的两个 exactly 计数从句属于触发条件本身。
      // 计数是程序化集合（355.10.d.2），不带 TargetSpec。
      condition: {
        kind: "all",
        conditions: [
          {
            kind: "compare",
            left: {
              kind: "count",
              subject: "cards-in-your-hand",
              filter: { zone: "hand", owner: "controller" }
            },
            operator: "eq",
            right: { kind: "constant", value: 4 }
          },
          {
            kind: "compare",
            left: {
              kind: "count",
              subject: "your-units-at-battlefields",
              // 190.6.d：隐含的 you 是能力控制者；at battlefields 是位置限制
              // （355.10.b），拼法与 layers/filter.ts 的 location 字符串比较一致。
              filter: {
                zone: "board",
                type: "unit",
                controller: "controller",
                location: "battlefield"
              }
            },
            operator: "eq",
            right: { kind: "constant", value: 4 }
          }
        ]
      }
    },
    optional: false,
    body: [
      {
        id: "gutter-palace.win",
        op: "effect.win",
        // player 缺省即能力控制者（190.6.d）；不写死座位。
        args: {}
      }
    ]
  },
  {
    kind: "activated",
    // 151 / 151.2：Gear 启动能力默认在控制者 Main Phase 的 Open State 执行。
    timing: "action",
    cost: {
      kind: "activated",
      payments: [
        {
          kind: "discard",
          // 423.1.a：弃哪张牌由执行动作的玩家选择（结算期选择，不是目标）。
          // options 是静态 IR 无法给出的精确运行时引用（见 judgeReason 第 3 点）。
          choice: {
            id: "gutter-palace.discard-one",
            options: ["card-in-controller-hand"],
            min: 1,
            max: 1,
            selection: "one",
            filter: { zone: "hand", owner: "controller" }
          }
        },
        // 415.5：:rb_exhaust: 代表 Exhaust this。
        { kind: "exhaust" }
      ]
    },
    body: [
      {
        id: "gutter-palace.play-bird-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "bird" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：Play ... token 先在链上生成再由打出流程接手。
          mode: { kind: "constant", value: "play" },
          // 355.2 / RIFT-357：地点在打出流程中选择；LocationExpr 的候选过滤
          // 覆盖控制者 Base 与控制者所控制的 Battlefield。
          location: {
            kind: "location",
            value: {
              kind: "choose",
              id: "gutter-palace.bird-location",
              filter: { type: "any", controller: "controller" }
            }
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-bcbe9b5d738a83a45e624acaf6d4f8ec5125c1fc1bc5704e46f6776a7abae109",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 CR 187.7 的 Bird token 定义及其 [Deflect] 能力装配：effect.token 仅定义 recruit/sand-soldier/mech/reflection/tentacle。缺 355.2 的目的地适配：LocationSelector 能选择合法位置，但 effect.token 的 argsSchema 不接受 LocationExpr，链适配器仍传入原始表达式。缺启动费用 PickSpec 到 Finalize 精确手牌引用的动态绑定（423.1.a/423.3）。beginning-start 的 exact-count 条件还需统一宿主查询：EventPipeline 直接使用 PipelineHost.context().query，未转换本卡 controller 相对玩家与 battlefield 类型过滤（315.2.a.1/383.2.a.1）。",
  abilities,
  sourceText:
    "At the start of your Beginning Phase, if you have exactly 4 cards in hand and exactly 4 units at battlefields, you win the game.\n" +
    "Discard 1, :rb_exhaust:: Play a 1 :rb_might: Bird unit token with [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose it with a spell or ability.)"
} satisfies CardProgram;
