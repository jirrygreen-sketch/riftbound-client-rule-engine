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
 * status 判定（cards/README.md 第 2 节，2026-10-18 复核）：judge-required，缺口仍是同一处事件词表。
 * - buff-added 时点定义（events/timing-points.ts，427.1/427.1.b/427.1.c）、buff 动作 →
 *   buff-added 的派生（events/action-adapter.ts 对 buff 动作发出 427.1/702.2.a）、
 *   effect.ready 原语与 CardProgram → TriggerRegistration 的绑定层都已合入：
 *   programs/triggers.ts 会把本卡的 `{ event: "buff-added", filter: { source: "self" } }`
 *   交给 translateTriggerFilter，正确翻译成把 "me" 绑定到宿主的
 *   `{ event: "buff-added", object: { objectId: <host> } }`（golden 实测）。
 * - 但 events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 是封闭词表，只含
 *   zone-entered…final-point 这批动作事件名，不含 buff-added；events/pipeline.ts 的
 *   registerTrigger 调用 assertTriggerSpec，因此在合并的绑定层上注册本卡触发会直接
 *   抛 TriggerSpecValidationError（golden 实测 registerProgramTriggers 报 invalid-event-type）。
 *   该词表缺失前的注册等于跳过校验，不允许。
 * - 触发条件 "you" 是能力控制者（190.6.d），由注册层传 controller 绑定；不写成其它条件近似。
 * 依赖：EventPattern 词表补齐 buff-added（时点本身已存在），随后绑定层即可注册。
 * 不近似实现（不把触发改写为其它时点，也不手改状态）。
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
    "当前唯一缺口：events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 封闭词表不含 buff-added（实测 validateTriggerSpec 返回 invalid-event-type）。" +
    "已合入且可执行：buff-added 时点定义（events/timing-points.ts；events/action-adapter.ts 把 buff 动作映射为 427.1/702.2.a 的 buff-added）、" +
    "effect.ready（416）原语，以及 CardProgram → TriggerRegistration 绑定层（programs/triggers.ts）：" +
    "绑定层把本卡 `{ event: \"buff-added\", filter: { source: \"self\" } }` 翻译为把 \"me\" 指向宿主的 " +
    "`{ event: \"buff-added\", object: { objectId: <host> } }`（golden 实测）。" +
    "缺口后果：events/pipeline.ts 的 registerTrigger 对该 filter 调用 assertTriggerSpec，因此经绑定层注册本卡触发实测抛 TriggerSpecValidationError" +
    "（path=trigger.filter.event，code=invalid-event-type），触发器进不了唯一事件管线；该词表缺失前的注册等于跳过校验，不允许。" +
    "golden 另用参考内核直接执行 body 的 effect.ready（416.1），并用真实 action-adapter 证明 buff 动作确实发出 buff-added。" +
    "依赖：EventPattern 词表补齐 buff-added（时点本身已存在）。不近似实现（不把触发改写为其它时点，也不手改状态）。",
  abilities,
  sourceText: "When you buff me, ready me."
} satisfies CardProgram;

export default program;
