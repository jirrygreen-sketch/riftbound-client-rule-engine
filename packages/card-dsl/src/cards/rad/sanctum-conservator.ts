import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sanctum Conservator (rad-030-167) — Unit, 5 energy, no printed Power, 5 Might, Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-030-167）：
 *   When you play a card with Energy cost :rb_energy_7: or more, ready me.
 *
 * 规则依据（CR v1.5）：
 * - “When you play a card …”：Play Effect（383.4.a；时点 card-played）。与 383.4.a.4 的
 *   “另一个对象被打出时触发”同类，触发订阅的是打出事件本身，不是本单位进场。
 * - “with Energy cost :rb_energy_7: or more”：206 规定“需要确定卡牌费用时一律使用印刷
 *   （或被复制）的费用”，206.1 进一步说明能力费用用基础费用；因此这里的判定基准是被打出
 *   卡牌的印刷能量费用（不是实际支付额）。本卡自身的费用与触发判定无关。
 * - “ready me.”：416.1 的就绪动作；effect.ready 的缺省选择就是能力来源（"ready me"），
 *   已合入。
 *
 * status = judge-required（见 judgeReason）：本项目已合入的触发过滤词汇里没有“被写出卡牌的
 * 印刷能量费用阈值”，也没有把打出事件的对象暴露给触发条件的表达式选择器（ObjectSelector
 * 只有 self / source / target / pick / linked，均指本能力自身或显式选择，不能指被触发事件里的
 * 那张牌），因此无法如实判定 7+；改写为“本单位/来源”上的条件会得到错误的语义，不能近似。
 * golden 真实执行可执行半段：“ready me”的 effect.ready（含 416.1.c 已就绪时无额外事情的边界）。
 * 依赖：RIFT-120 之后的触发事件载荷/过滤扩展（打出事件的印刷费用阈值 + 事件对象选择器）、
 * 以及卡牌程序 → TriggerRegistration 的接线。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // “you play a card” — 由本控制者打出的牌（不是本单位自己）；"with Energy cost 7 or
      // more" 是对被写出卡牌印刷费用的阈值过滤（206/206.1）。
      filter: {
        event: "card-played",
        filter: { player: "self", playedCardEnergyCostAtLeast: 7 }
      }
    },
    optional: false,
    body: [
      {
        // “ready me.” — 416.1；effect.ready 的缺省对象是能力来源。
        id: "sanctum-conservator.ready-self",
        op: "effect.ready",
        args: {}
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-6028fb37be26fd7565a2496f62a0ae6299311f364579011da70ce8cdbb0ddd08",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "触发条件无法如实判定：CR 206/206.1 规定“卡牌的费用”一律取印刷（或被复制）费用，因此本能力要检查被打出卡牌的印刷能量费用 ≥ 7，" +
    "但已合入的触发过滤词汇（events/trigger-spec.ts 的 ObjectFilter/EventPattern）没有该阈值谓词，" +
    "也没有把「被打出事件里的那张牌」暴露给条件表达式的选择器（契约 3.6 的 ObjectSelector 只有 self / source / target / pick / linked，" +
    "全部指本能力自身或显式选择，不能指被触发事件的对象）；把它改写成对来源/本单位条件的检查会得到错误语义，故不近似实现。" +
    "另：卡牌程序 → TriggerRegistration 的生产接线尚未合入（RIFT-120 之后的协调工作）。" +
    "可执行半段：effect.ready 的 “ready me”（416.1，已就绪时按 416.1.c 无额外事情），golden 真实执行；不据此宣称整卡可执行。",
  abilities,
  sourceText: "When you play a card with Energy cost :rb_energy_7: or more, ready me."
} satisfies CardProgram;

export default program;
