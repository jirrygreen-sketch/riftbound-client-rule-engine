import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Simian Ancestor (sfd-047-221) — Unit, Calm, Ionia.
 * energy 5, power 1 (Calm), Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-047-221，逐字）:
 *   "When you buff me, ready me."
 *
 * 规则依据（CR v1.5）:
 * - "When you buff me"：383 / 427.1 的 Buff 触发；订阅 buff-added 时点
 *   （events/timing-points.ts，ruleRefs 427.1/702.2.a；action-adapter.ts 把
 *   `buff` 动作映射到该时点），filter 的 object 指向本卡自身并把 "you" 绑定为
 *   能力控制者（190.6.d）。"me" 是被 Buff 的宿主，不是新选择的目标（355.10.c
 *   的 cost/trigger 例外：触发条件里的对象不是目标）。427.1.c 的官方例子正是
 *   这句话：单位被选为 Buff 动作的对象、但已有 Buff 计数器而没有真正被 Buff 时，
 *   能力不触发——触发取决于动作是否真的放置了计数器，由内核按实际结果发出
 *   buff-added 时点。
 * - "ready me"：416.1 的 Ready 动作；"me" 指能力宿主，用契约 3.6 的符号选择器
 *   "self" 表达（effect.ready 的 objects: { kind: "source" } 同义），由解释器在
 *   运行时绑定对象引用。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - buff-added 时点与 effect.ready 原语均已合入，但缺少把卡牌程序的 triggered
 *   能力注册成事件订阅的生产适配层（CardProgram → TriggerRegistration），本仓库
 *   尚无该消费方（RIFT-120），因此触发无法进入链；golden 只能用参考内核直接执行
 *   body 的那条 effect.ready。
 * - "When you buff me" 的 "you"（谁获得/可花费 Buff）是能力控制者而非当前动作的
 *   执行者，绑定在注册层完成；注册层缺失前不写成其它条件近似。
 * 依赖：RIFT-120（卡牌程序触发注册与链接线）。不近似实现（不把触发改写为其它时点，
 * 也不手改状态）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    // 427.1 的 buff 触发按 buff-added 时点订阅；内层锚点用契约 3.6 的选择器
    // source: "self"（运行时由解释器/注册层绑定为宿主），与已合入的
    // ogn/mistfall「When you buff …」同一写法。
    trigger: {
      at: "buff-added",
      filter: { event: "buff-added", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "simian-ancestor.ready-self",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-971a51eafa8489e035057774061242847cfa0865c5aa2018f634cc048d093610",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "buff-added 时点（events/timing-points.ts，action-adapter.ts 把 buff 动作映射为 427.1/702.2.a 的 buff-added）与 " +
    "effect.ready（416）原语都已合入并有执行测试，但没有任何已合入消费方把 CardProgram 的 triggered 能力注册成事件订阅" +
    "（CardProgram → TriggerRegistration 的生产适配层缺失，见 RIFT-120），触发无法按 383.3 进入链；" +
    "golden 只用参考内核直接执行 body 的 effect.ready（416.1）。不近似实现（不把触发改写为其它时点，也不手改状态）。" +
    "依赖：RIFT-120（卡牌程序触发注册与链接线）。",
  abilities,
  sourceText: "When you buff me, ready me."
} satisfies CardProgram;

export default program;
