import type { CardProgram } from "../../ir/index.js";

/**
 * Back-Alley Bar (ogn-277-298) — Battlefield, domainless.
 *
 * "When a unit moves from here, give it +1 :rb_might: this turn."
 *
 * CR v1.5 anchors:
 * - 421.1 / 449.1 / 449.2: Move is the action that changes a Permanent's
 *   Location; the "object-moved" timing point declares a movement payload
 *   (fromKind / fromLocationId / toKind / toLocationId, see
 *   events/timing-points.ts), but the adapter does not populate those fields. The
 *   merged action adapter emits the timing point for a successful
 *   move-location (events/action-adapter.ts).
 * - 458 / 458.1: a Recall is not a Move and does not trigger Move abilities,
 *   so the trigger keys on the Move timing point rather than on a generic
 *   location change.
 * - 355.10.c: the moved unit is mentioned only inside the trigger condition
 *   ("a unit moves from here"), so it is not a target; there is no Finalize
 *   target choice for this ability.
 * - 143.2.a / 478 / 317.1.a: "+1 [M] this turn" is a Might modification, not a
 *   Buff counter, executed by the merged continuous.might primitive (RIFT-258)
 *   with the end-of-turn duration; effect.buff (703 Buffs are counters) is not
 *   substituted.
 *
 * Status: judge-required (re-checked 2026-10-17 with measured evidence).
 * continuous.might executes, but three event seams remain: object-moved is
 * absent from the trigger validator's event vocabulary (registerProgramTriggers
 * throws TriggerSpecValidationError / invalid-event-type and registers nothing);
 * the actual action-adapter emission carries neither the declared fromKind /
 * fromLocationId nor fromZone (those fields are only written on the
 * zone-enters/leaves branch), so "from here" cannot be compared with the Move's
 * origin (449.1); and ObjectSelector cannot name the moved unit from the event
 * (355.10.c). Recall must stay distinct from Move (458.1). The TargetSpec is a
 * blocked structural stand-in, not a target choice made by the printed text.
 * Execution evidence: test/cards/templates/triggered-object-moved-continuous-might-687.test.mjs.
 */
export default {
  canonicalCardId: "card.hash-493d66d1c2a0fe93d708e9d2f3e005dc5a57140526eb8080cdad1ce0977c081a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处实测缺口（2026-10-17），均不近似实现：" +
    "(1) 触发无法注册——programs/triggers.ts 经 events/trigger-spec.ts 的 assertTriggerSpec 校验 trigger.at/filter，" +
    "而封闭 EVENT_PATTERN_TYPES 不含 \"object-moved\"（词表用 zone-entered/zone-left 一类别名），" +
    "实测 registerProgramTriggers 抛 TriggerSpecValidationError（trigger.filter.event invalid-event-type），pipeline 触发器数为 0。" +
    "(2) 起点载荷缺失——events/action-adapter.ts 为 move-location 发出的 object-moved 事件只带 action.to，" +
    "不带 timing-points.ts 为此时点声明的 fromKind/fromLocationId/toKind/toLocationId，也不带 fromZone/toZone" +
    "（这两个字段只在同一发射的 zone-enters/leaves 分支写入），因此「from here」无法与该次 Move 的起点比较（449.1）；" +
    "filter.details.fromLocationId 的 \"self\" 是目前唯一可表达的静态占位，字面量永不等于真实战场 id，保持 fail-closed，" +
    "不能退化成「任何移动都触发」。" +
    "(3)「it」没有选择器——冻结 ObjectSelector 只有 self/source/target/pick/linked，没有触发载荷对象形态，" +
    "而 355.10.c 明确触发条件里的对象不是目标；continuous.might 的 TargetSpec 只是结构性占位，会错误要求文本未包含的目标选择。" +
    "已可执行部分：continuous.might + duration \"this-turn\"（143.2.a、317.1.a、478）经生产 body 适配器对被绑定对象真实生效并在回合结束到期。" +
    "依赖：object-moved 进入 EventPattern 词表、Move 起终点载荷（449.1/449.2，并保留 458.1 的 Recall 区分）、触发载荷对象选择器（契约变更请求）。",
  sourceText: "When a unit moves from here, give it +1 :rb_might: this turn.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        // "from here": the Move's origin is this battlefield.
        filter: {
          event: "object-moved",
          object: { type: "unit" },
          details: { fromKind: "battlefield", fromLocationId: "self" }
        }
      },
      optional: false,
      body: [
        {
          // "give it +1 [M] this turn" — the merged continuous.might primitive
          // (RIFT-258) with the end-of-turn duration. The target is a
          // structural stand-in for the trigger payload's unit until the
          // event-object selector exists (see judgeReason).
          id: "back-alley-bar.give-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "back-alley-bar.moved-unit" }
            }
          },
          targets: [
            {
              // Structural stand-in: the printed text never chooses a target
              // (355.10.c); the triggering unit would be named through the
              // missing event-object selector.
              id: "back-alley-bar.moved-unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;
