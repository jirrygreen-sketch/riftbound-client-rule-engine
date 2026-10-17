import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Corinna Veraza (sfd-179-221) — Unit, Order, Zaun.
 * energy 7, power 1 (Order), Might 6.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-179-221，逐字）:
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_order: as an additional cost to have me enter ready.)\n"
 *   "When I move to a battlefield, play three 1 :rb_might: Recruit unit tokens here."
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805）：可选附加费用关键词；展开由已合入的
 *   effects/keywords/Accelerate.ts 负责（accelerate.cost 声明 + 805.6 入场就绪替代），
 *   卡只声明关键词，不重写展开。
 * - "When I move to a battlefield"（383.1；421.1）：Move 是永久物在两个 Location 之间
 *   的移动（449.1/449.2 用起点与终点定义），封闭时点 object-moved 表示一次成功的 Move；
 *   458/458.1 的 Recall 不是 Move。触发 filter 用 EventPattern 的 toZone: "battlefield"
 *   表达「移动到战场」，"When I move" 用 filter 内层锚点 source: "self" 指称本卡
 *   （与已合入的 traveling-merchant/miss-fortune-captain 等卡同一写法）。
 * - "here"（359.3.f.1）：referents 从能力来源读取，在指令执行时检查；因此先用
 *   condition.value 在结算时读出来源当前位置（静态 IR 不能写运行时 ObjectRef），
 *   再由 effect.token 的 location 经 linked-value 读取（359.3.f.2 的执行时机）。
 *   静态位置引用无法用 ObjectSelector 表达，effect.token/effect.move 的
 *   argsSchema 也只接受运行时 ObjectRef 或 choice 形状。
 * - "play three 1 :rb_might: Recruit unit tokens"：440.2.c / 185.2.a / 350.2 / 354——
 *   被"打出"的 token 先在链上生成，再由打出流程接手；Recruit 的印刷定义见 187.1
 *   （1 Might 的 domainless 单位 token，Recruit 标签），对应已合入的 effect.token
 *   定义 id "recruit"。数量 3 是印刷常量。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - object-moved 触发缺少可判定载荷：events/action-adapter.ts 为 move-location 生成的
 *   object-moved 事件带 object = 被移动对象，但不填 toZone/toKind（timing-points.ts
 *   声明的 payloadFields），因此 toZone: "battlefield" 不会命中；events/pipeline-match.ts
 *   消费 EventPattern 的 fromZone/toZone 时只比较事件上的同名字段。
 * - 内层 filter 的 source: "self" 归属锚点也没有消费方：卡牌程序→TriggerRegistration
 *   的绑定（卡牌程序绑定 RIFT-257，未合入 HEAD）才会把宿主身份接到匹配层；现无生产模块
 *   展开卡牌 triggered 能力并注册进事件管线。
 * - [Accelerate] 的展开（effects/keywords/Accelerate.ts）已合入，但其附加费用计划消费方
 *   （Finalize 的 optionalAdditional 接线）与 cost.pay 原语属未合入的 RIFT-261 批次。
 * 依赖：move-location 事件的起点/终点载荷与卡牌触发绑定（RIFT-257/RIFT-120 后续）、
 * RIFT-261 的费用指令。
 * 不近似实现（不把任何移动都当作"移动到战场"，也不手改 token 状态或位置）。
 * token 体本身（effect.token mode "play" + 来源位置 referent）在 golden 测试里用参考内核
 * 真实执行，见下方 test 与 test.todo 的分工。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
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
        id: "corinna-veraza.read-here",
        op: "condition.value",
        args: {
          value: {
            kind: "object-property",
            object: "source",
            property: "location"
          },
          key: { kind: "constant", value: "here" }
        }
      },
      {
        id: "corinna-veraza.play-recruits",
        op: "effect.token",
        linkedTo: "corinna-veraza.read-here",
        args: {
          token: { kind: "constant", value: "recruit" },
          amount: { kind: "constant", value: 3 },
          mode: { kind: "constant", value: "play" },
          location: {
            kind: "linked-value",
            instructionId: "corinna-veraza.read-here",
            key: "here"
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-501f79047db4a7b99900a5e5d9ccc837a75c7d22b74a2584683a55e48a288d95",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "object-moved 触发没有可判定的「本卡移动」与「终点是战场」载荷：events/action-adapter.ts 的 move-location 映射生成的" +
    " object-moved 事件带 object（被移动对象）但不填 toZone/toKind（timing-points.ts 声明的 payloadFields），" +
    "因此 toZone: \"battlefield\" 不会命中；内层 filter 的 source: \"self\" 归属锚点同样没有消费方——" +
    "把卡牌 triggered 能力展开并注册成事件订阅的生产方（卡牌程序绑定 RIFT-257）未合入 HEAD，" +
    "宿主与被移动对象的同一性无从比对（449.1/449.2 的起点终点、458 的 Recall 排除由此无法执行）。" +
    "[Accelerate] 的展开（effects/keywords/Accelerate.ts）已合入，但其附加费用计划消费方（Finalize 的 optionalAdditional 接线）" +
    "与 cost.pay 原语属未合入的 RIFT-261 批次。" +
    "依赖：RIFT-257（卡牌触发/替代绑定与展开）、RIFT-261（费用指令）、move-location 事件载荷补全。" +
    "token 体（effect.token mode \"play\" 按 440.2.c/185.2.a 在链上生成后打出，位置取来源 referent，359.3.f.1）" +
    "用参考内核真实执行；触发本身不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_order: as an additional cost to have me enter ready.)\n" +
    "When I move to a battlefield, play three 1 :rb_might: Recruit unit tokens here."
} satisfies CardProgram;

export default program;
