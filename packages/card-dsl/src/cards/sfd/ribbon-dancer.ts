import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ribbon Dancer (sfd-038-221) — Unit, Calm, Ionia.
 * energy 3, power: none printed, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-038-221，逐字）:
 *   "When I move to a battlefield, give another friendly unit +1 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）:
 * - "When I move to a battlefield"（421.1、449.1/449.2、458/458.1）：Move 是永久物在两个
 *   Location 之间的移动，Recall 不是 Move，不触发移动类能力；封闭时点 object-moved 表示
 *   一次成功的 Move。filter 用内层锚点 source: "self" 指称本卡（已合入 sfd/corinna-veraza、
 *   ogn/noxian-drummer 采用同一写法，并用 toZone: "battlefield" 表达「移动到战场」）。
 * - "give another friendly unit +1 :rb_might: this turn"：带回合期限的临时 Might 修改，
 *   属算术图层（continuous.might），不是 Buff 计数——effect.buff 文件头明确临时 Might
 *   修改归 continuous.might（CR 703 的 Buff 与它是两回事）。「another friendly unit」是被
 *   选择的对象（355.7/355.9.b），「another」排除来源自身。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 临时 Might 修改没有可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，
 *   effects/instructions/ 下也没有任何注册 continuous.might 的原语（layers 引擎能求值，
 *   但没有把结算中的持续效果经 ResolveContext.addContinuous 落地的指令），不能近似为
 *   effect.buff 计数。
 * - object-moved 触发缺可判定载荷：events/action-adapter.ts 为 move-location 生成的事件
 *   不填 toZone/toKind（timing-points.ts 声明的 payloadFields），因此 toZone: "battlefield"
 *   永不命中；内层 filter 锚点（source: "self"）也没有消费方（events/pipeline-match.ts 只读
 *   EventPattern 的 object/source/target/player/fromZone/toZone/amount/details）。
 * 依赖：continuous.might 指令原语（RIFT-9 清单；RIFT-91 已合入 layers 求值侧）、RIFT-120
 * （移动时点载荷与卡牌触发注册）、RIFT-89（费用/目标批次）。不近似实现。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: {
        event: "object-moved",
        toZone: "battlefield",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        id: "ribbon-dancer.give-plus-1",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "this-turn" }
        },
        targets: [
          {
            id: "ribbon-dancer.other-friendly-unit",
            filter: {
              type: "unit",
              controller: "controller",
              zone: "board",
              exclude: "source"
            },
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
  canonicalCardId: "card.hash-1d9968343e4ab4ff83ad67e03bc124632358c3526c2bbddcc0667b4849c03538",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「give another friendly unit +1 :rb_might: this turn」是带回合期限的临时 Might 修改，属算术图层：" +
    "契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 下也没有注册 continuous.might 的原语" +
    "（layers 引擎能求值 arithmetic 层与 end-of-turn 期限，但没有把结算中的持续效果经 ResolveContext.addContinuous 落地的指令；" +
    "effect.buff 文件头明确临时 Might 归 continuous.might，不能近似为 Buff 计数）。" +
    "同时 object-moved 触发缺可判定载荷：events/action-adapter.ts 为 move-location 生成的事件不填 toZone/toKind" +
    "（timing-points.ts 声明的 payloadFields），因此 toZone: \"battlefield\" 永不命中；内层 filter 锚点 source: \"self\" 也没有消费方" +
    "（events/pipeline-match.ts 只读 EventPattern 的 object/source/target/player/fromZone/toZone/amount/details；449.1/449.2 的起点终点、" +
    "458/458.1 的 Recall 排除据此无法执行）。依赖：continuous.might 指令原语（RIFT-9 清单；RIFT-91 的图层求值侧已合入）、" +
    "RIFT-120（移动时点载荷与卡牌触发注册）。不近似实现。",
  abilities,
  sourceText: "When I move to a battlefield, give another friendly unit +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;
