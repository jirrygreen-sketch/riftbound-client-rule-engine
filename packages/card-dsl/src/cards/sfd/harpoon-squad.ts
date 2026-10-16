import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Harpoon Squad (sfd-137-221) — Unit, Chaos, Pirate/Bilgewater.
 * energy 4, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-137-221，逐字）:
 *   "When I move from a battlefield, give me +2 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - "When I move"（383.1；421.1、449.1/449.2；458/458.1 的 Recall 不是 Move）：封闭时点
 *   object-moved 表示一次成功的 Move（"When I move" 用 filter 内层锚点 source: "self"
 *   指称本卡，与已合入 ogn/noxian-drummer、sfd/corinna-veraza、sfd/apprentice-smith 同型）；
 *   "from a battlefield" 是该次移动的起点性质，按 EventPattern 的 fromZone 写成
 *   fromZone: "battlefield"（timing-points.ts 为 object-moved 声明 fromKind/fromLocationId 等
 *   payloadFields，Section 3.5 的时点载荷形状）。
 * - "give me +2 :rb_might: this turn"：带回合期限的临时 Might 修改，属算术图层
 *   （continuous.might；143.2.a 的有效 Might、317.2.c "3d. All 'this turn' effects expire
 *   simultaneously"）。它不是 Buff 计数器：702–704 的 Buff 是计数物，effect.buff 文件头也
 *   明确 "give me +2 [M] this turn" 归 continuous.might。"me" 用契约 3.6 的符号选择器
 *   "self"（已合入 ogn/dune-drake 的同一写法），不写运行时 ObjectRef。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 缺卡牌侧 continuous.might 指令：effects/instructions/ 下没有注册该 op（RIFT-9 原语清单要求），
 *   契约 3.6 的封闭 GameAction 集合也没有 Might 修改动作，因此声明的算术图层效果无法经
 *   ResolveContext.addContinuous 落地。RIFT-91 已合入 layers/ 的求值侧（arithmetic 层 + 期限），
 *   golden 用它真实执行本卡声明的 +2（见测试第 3 节）；但"整卡可执行"还需要卡牌侧指令与触发进链。
 * - object-moved 触发缺可判定载荷：events/action-adapter.ts 为 move-location 生成的事件带 object
 *   （被移动对象）但不填 fromZone/fromKind（timing-points.ts 声明的 payloadFields），
 *   fromZone: "battlefield" 无法命中；内层锚点 source: "self" 也没有消费方
 *   （events/pipeline-match.ts 只读 EventPattern 的 object/source/target/player/fromZone/toZone/
 *   amount/details），且没有把 CardProgram 的 triggered ability 注册为 TriggerRegistration 的接线
 *   （RIFT-120）。
 * 依赖：continuous.might 指令（RIFT-9 清单；RIFT-91 图层求值侧已合入）、RIFT-120（移动时点载荷与卡牌触发注册）。
 * 不近似实现：不用 Buff 计数器冒充临时 Might，也不把任何移动都当作"从战场移动"。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: {
        event: "object-moved",
        // 449.1/449.2：起点是战场；458/458.1 的 Recall 不触发移动类能力。
        fromZone: "battlefield",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        // "give me +2 [M] this turn" — layers-contract shape; 卡牌侧指令未合入（见 judgeReason）。
        id: "harpoon-squad.give-plus-2",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "this-turn" },
          // "me" 是能力宿主：符号选择器 "self"，不是构造出来的 TargetSpec，也不是运行时引用。
          object: { kind: "constant", value: "self" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-f696312134479041b97777c95666ee948dd620df1b82a432d5d877753660bfd2",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "(1) 缺卡牌侧 continuous.might 指令：effects/instructions/ 下没有注册该 op（RIFT-9 清单要求），" +
    "契约 3.6 的封闭 GameAction 集合也没有 Might 修改动作，声明的算术图层效果无法经 ResolveContext.addContinuous 落地" +
    "（RIFT-91 只合入了 layers/ 的求值侧）；" +
    "(2) object-moved 触发缺可判定载荷：events/action-adapter.ts 的 move-location 映射生成的 object-moved 事件不填 " +
    "fromZone/fromKind（timing-points.ts 声明的 payloadFields），因此 fromZone: \"battlefield\" 无法命中，" +
    "内层锚点 source: \"self\" 也没有消费方（events/pipeline-match.ts 只读 EventPattern 的 " +
    "object/source/target/player/fromZone/toZone/amount/details），并且没有把 CardProgram 的 triggered ability " +
    "注册为 TriggerRegistration 的接线。依赖：continuous.might 指令（RIFT-9 / RIFT-91）、RIFT-120（移动时点载荷与卡牌触发注册）。" +
    "不近似实现（不用 Buff 计数器冒充临时 Might，也不把任何移动都当作「从战场移动」）。",
  abilities,
  sourceText: "When I move from a battlefield, give me +2 :rb_might: this turn."
} satisfies CardProgram;

export default program;
