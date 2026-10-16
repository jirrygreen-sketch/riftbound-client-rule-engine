import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Nilah, Joyful Ascetic (unl-115-219) — Unit，能量 3，力量 1，Might 4，领域 Body，
 * 标签 Nilah/Kathkan/Demon/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-115-219，逐字）:
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
 *   "[Ganking] (I can move from battlefield to battlefield.)\n" +
 *   "When I move, gain 1 XP."
 *
 * 规则依据（CR v1.5）:
 * - [Accelerate]：805.1.a-d（单位上的可选附加费用关键词），805.1.b 的功能等价文本正是
 *   印刷的提醒文字（固定 [1][C]），805.4 多个实例冗余，805.5 是否拥有它是可引用的特征。
 *   提示文字是提醒文本（135.2.d.3），不另写能力。
 * - [Ganking]：810.1.a/b 的被动能力关键词（等价于 "I may move to a battlefield from
 *   another battlefield with a standard move."），810.1.c 说明它给 Standard Move 增加
 *   许可、810.2 冗余、810.3 是可引用特征。展开归关键词注册表（契约 3.7）。
 * - "When I move"：421.1 / 449.1 的 Move；封闭时点是 object-moved（events/
 *   timing-points.ts，ruleRefs 421.1/449.1/449.2/458）。449.1/449.2 规定 Standard Move
 *   的起点终点，458.1 的 Recall 不是 Move，因此该时点必须只由真实 Move 产生。
 * - "gain 1 XP"：728 / 729 / 730.1（获得 XP 就是增加该玩家标记的 XP），用已合入的
 *   effect.xp；获得者缺省为能力控制者（ctx.controller，190.6.d 的隐含 you）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。三处缺口，均不近似实现：
 * 1. [Accelerate]（805）与 [Ganking]（810）的 KeywordDef 已合入（effects/keywords/
 *    Accelerate.ts、Ganking.ts），但没有运行时消费方把卡牌的 keyword 能力展开并注册：
 *    cost/cost-plan.ts 只消费调用方传入的 optionalAdditional（accelerate 就绪入场在
 *    chain/engine.ts 只读已生成的费用计划），layers 也不读 Ganking 的
 *    continuous.movement 许可，移动系统没有该许可的读取入口。
 * 2. "When I move" 的触发载荷不完整：events/action-adapter.ts 只为 move-location 动作
 *    发 object-moved，Standard Move / Ganking 的战场间移动还没接入唯一事件管线，事件也不
 *    携带起点终点与“是本次 Move 的对象”这一事实（449.2、458.1 的 Recall 排除），因此无法
 *    诚实订阅（同 ogn/miss-fortune-captain、sfd/corinna-veraza）。
 * 3. 缺 CardProgram → TriggerRegistration 适配器（RIFT-120 后续），触发能力没有注册路径。
 * body 的 gain 1 XP（effect.xp，730.1）已合入，golden 用解释器 + 参考内核真实执行。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  { kind: "keyword", keyword: "ganking" },
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      // 421.1 / 449.1：本卡自己的 Move（不含 Recall，458.1）。
      filter: { event: "object-moved", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "nilah-joyful-ascetic.gain-1-xp",
        op: "effect.xp",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-b06729f7cdfbc0accaea6ca7e4a0d2414ea996cb784e53eb818963a32a5666d5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Accelerate]（805）与 [Ganking]（810）的展开文件已合入，但没有运行时消费方把卡牌的 keyword 能力展开并注册：" +
    "cost/cost-plan.ts 只消费调用方传入的 optionalAdditional（accelerate 的就绪入场在 chain/engine.ts 只读已生成的费用计划），" +
    "layers 不读 Ganking 的 continuous.movement 许可、移动系统也没有该许可的读取入口（依赖 RIFT-86、RIFT-83/91）。" +
    "“When I move”缺触发载荷与发射路径：events/action-adapter.ts 只为 move-location 动作发 object-moved，" +
    "zones/movement 的 Standard Move / Ganking 战场间移动未接入唯一事件管线，事件也不携带起点终点与“本次 Move 的对象”这一事实" +
    "（449.1/449.2；458.1 的 Recall 不是 Move），因此该触发无法诚实订阅（同 ogn/miss-fortune-captain）。" +
    "另缺 CardProgram → TriggerRegistration 适配器（RIFT-120 后续）。gain 1 XP（effect.xp，730.1）已合入并在 golden 中真实执行。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "When I move, gain 1 XP."
} satisfies CardProgram;
