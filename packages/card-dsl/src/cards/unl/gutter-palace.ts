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
 * status = judge-required（README 第 2 节），缺口逐条列出且不近似实现：
 * (1) Bird token 没有定义：冻结的 effect.token 定义表只有 recruit / sand-soldier / mech /
 *     reflection / tentacle；187.7 的 Bird 还带 [Deflect] 关键词（809），带自身能力或关键词的
 *     token 定义按该原语文件头保持 blocked。
 * (2) token 的进入地点未印刷：355.2 在打出流程中选择合法 Location，冻结 IR 没有运行期
 *     Location 选择器（原语清单的 target.location 未合入），静态候选列表无法枚举「控制者 Base
 *     或其控制的战场」。程序里的 locations 是声明式占位，effect.token 会拒绝该形状（fail closed），
 *     绝不落到猜出来的地点。
 * (3) Discard 1 费用要求 Finalize 提供精确的手牌对象引用：cost/plan-values.ts 的 reference 只
 *     接受运行时 ObjectRef，静态 IR 按 README 第 3 节禁止写运行时引用（同 sfd/sky-crusier；
 *     依赖 RIFT-89 费用计划与 RIFT-102 引用收口）。
 * (4) beginning-start 没有已合入发出者（turn/ 阶段流程未发该时点，链层只把它用作清理时钟，
 *     同 rad/mechanical-bandit 记录）；exactly 4 cards in hand 的手牌数量也没有已合入的表达式
 *     读取入口（PlayerSnapshot.handSize 未进入 Expr/Condition，同 ogn/loose-cannon 记录）。
 * (5) 没有订阅方把 CardProgram 的 triggered ability 注册为 TriggerRegistration（契约 3.5）。
 * effect.win 本体已合入，golden 用解释器真实执行。
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
          // 355.2：地点在打出流程中选择；静态 IR 无法枚举运行期合法 Location，
          // 因此这里是声明式占位（见 judgeReason 第 2 点），执行时会被原语拒绝。
          locations: { kind: "constant", value: ["runtime:valid-play-location"] },
          choiceId: { kind: "constant", value: "gutter-palace.bird-location" }
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
    "五处依赖未合入，均不近似实现：(1)「Play a 1 :rb_might: Bird unit token with [Deflect]」不可执行：CR 187.7 的 Bird 是无域 1 Might、" +
    "Bird 标签、带 [Deflect]（809）的单位 token，而冻结的 effect.token 定义表只有 recruit / sand-soldier / mech / reflection / tentacle，" +
    "带自身关键词或能力的 token 定义按该原语文件头保持 blocked。" +
    "(2) token 的进入地点未印刷：355.2 要求在该牌的打出流程中选择合法 Location，而冻结 IR 没有运行期 Location 选择器" +
    "（原语清单的 target.location 未合入），静态候选列表无法枚举「控制者 Base 或其控制的战场」；程序里的 locations 只是声明式占位，" +
    "effect.token 会拒绝该形状（fail closed），不落到猜出来的地点。" +
    "(3)「Discard 1」作为费用要求 Finalize 提供精确手牌引用：cost/plan-values.ts 的 reference 只接受运行时 ObjectRef，" +
    "静态 IR 按 README 第 3 节禁止写运行时引用（同 sfd/sky-crusier；依赖 RIFT-89 费用计划与 RIFT-102 引用收口）。" +
    "(4) beginning-start 没有已合入发出者（turn/ 阶段流程未发该时点，链层只把它当清理时钟，同 rad/mechanical-bandit），" +
    "且「exactly 4 cards in hand」的手牌数量没有已合入表达式入口（PlayerSnapshot.handSize 未进入 Expr/Condition，同 ogn/loose-cannon）。" +
    "(5) 没有订阅方把 CardProgram 的 triggered ability 注册为 TriggerRegistration（契约 3.5、RIFT-120 后续）。" +
    "effect.win 本体已合入，golden 用解释器真实执行。",
  abilities,
  sourceText:
    "At the start of your Beginning Phase, if you have exactly 4 cards in hand and exactly 4 units at battlefields, you win the game.\n" +
    "Discard 1, :rb_exhaust:: Play a 1 :rb_might: Bird unit token with [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose it with a spell or ability.)"
} satisfies CardProgram;
