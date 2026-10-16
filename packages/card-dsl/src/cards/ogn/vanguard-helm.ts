import type { CardProgram } from "../../ir/index.js";

/**
 * Vanguard Helm (ogn-228-298) — OGN Gear, 2 energy, 0 Order power, no Might.
 *
 * Printed text:
 *   When a buffed friendly unit dies, buff another friendly unit.
 *   (If it doesn't have a buff, it gets a +1 :rb_might: buff.)
 *
 * Modelling notes (Core Rules v1.5):
 * - "When a buffed friendly unit dies" is a triggered ability subscribed to
 *   the death event. 429.1 / 429.1.a.1: dying is a permanent going from the
 *   Board to its Trash; the `object-killed` timing point carries it, and the
 *   dying permanent's last-known characteristics are collected before the zone
 *   change (383.2.c.3, 429.1.a.1.b). "friendly" is 740.1.a (shared controller)
 *   and "buffed" is 702.2.a (a unit with a Buff counter is Buffed for as long
 *   as the buff remains).
 * - "buff another friendly unit" is the merged `effect.buff` primitive in
 *   "buff" mode (702.2.a / 427.1.b): exactly one other friendly unit is chosen
 *   as a target (355.7 "Chooses … are Targeted"), "another" excludes the source
 *   (740.1.a). Reminder text (702.3.a / 427.1.c: a unit that already has a Buff
 *   stays a legal choice and simply is not Buffed again) is behaviour of the
 *   primitive and is not re-implemented here.
 *
 * Status: judge-required — the trigger cannot be honestly bound with merged
 * code:
 * - "buffed" has no merged predicate in the trigger-filter vocabulary.
 *   EventPattern/ObjectFilter (events/trigger-spec.ts) offers objectId, cardId,
 *   type, controller, owner, zone, location, states, tags and characteristics; a
 *   Buff counter is not surfaced as a state. The closest honest spelling is the
 *   descriptive `characteristics: { buffs: 1 }` recorded below, which the merged
 *   matcher (events/pipeline-match.ts) compares with `===` against the event
 *   snapshot; that is NOT 702.2.a's "has a Buff counter" (buffs >= 1) — an object
 *   carrying a second Buff would be Buffed but fail this filter — so the key is
 *   recorded for review only and is never the executable predicate. (Tracked with
 *   the same gap as ogn-269-298 The Boss / ogn-090-298 Spirits' Refuge.)
 * - the death event's payload filter must be bound to the dying unit of THIS
 *   trigger, and the trigger must be collected with the dying unit's last-known
 *   information (383.2.c.3.b / 429.1.a.1.b). The card-program →
 *   TriggerRegistration adapter that supplies `activeZones`, the trigger body /
 *   cost and the payload-object binding for card programs is still unmerged
 *   (RIFT-120 follow-up), so the trigger shown below is not registered by any
 *   merged path. (The "friendly" half is verified against the merged matcher:
 *   for `object-killed` the payload's `player` is the dying unit's controller, so
 *   `player: "self"` does restrict it to this ability's controller.)
 * The Buff body itself uses only merged structures: contract 3.2 targets, the
 * ""another"-style exclusion via the other: true filter key (740.1.a) and the
 * merged effect.buff primitive. The golden test executes that body with
 * caller-supplied Finalize targets, exactly as the production target pipeline
 * must supply them.
 */
const vanguardHelm = {
  canonicalCardId: "card.hash-508405483bcf2bc67687c4f5d80ef7423b4e9e22a91044db31c0218d8f206753",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发条件缺已合入的谓词与接线：" +
    "(1) buffed（702.2.a：身上有 Buff counter 即为 Buffed）在 EventPattern/ObjectFilter（events/trigger-spec.ts）里没有谓词——" +
    "可用字段只有 objectId/cardId/type/controller/owner/zone/location/states/tags/characteristics，Buff counter 不作为 states 暴露；" +
    "最接近的写法是描述性键 characteristics: { buffs: 1 }，但合入匹配器（events/pipeline-match.ts）用 === 比较，" +
    "并不等于 702.2.a 的\"至少有一个 Buff counter\"（身上有第二个 Buff 的单位仍是 Buffed，却不会命中），" +
    "因此该键只作评审标记，绝不是可执行谓词。" +
    "(2) 缺少把卡牌程序注册成触发器的 card-program → TriggerRegistration 适配器（activeZones、触发正文/费用与事件对象绑定，RIFT-120 后续接线）：" +
    "合入代码里没有任何路径会用本卡声明的 filter 注册该触发，也没有按 383.2.c.3.b / 429.1.a.1.b 用离场前最后已知信息收集该死亡单位。" +
    "（friendly 半段已对合入匹配器实测：object-killed 载荷的 player 是被消灭单位的控制者，故 player: self 确实限定为本能力控制者。）" +
    "Buff 正文（另一个友方单位，740.1.a；effect.buff 的 702.2.a/427.1.b 语义）只用已合入结构，由 golden 以调用方提供的 Finalize 目标真实执行；整卡因触发绑定保持 judge-required，不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          // "a buffed friendly unit": the dying unit must be a unit controlled by
          // this ability's controller (740.1.a) and must have a Buff counter
          // (702.2.a). "buffs" is a descriptive characteristics key: the merged
          // filter vocabulary has no "buffed" predicate, and it is never treated
          // as matching by accident (see judgeReason).
          object: { type: "unit", characteristics: { buffs: 1 } },
          player: "self"
        }
      },
      optional: false,
      body: [
        {
          // "buff another friendly unit" — one targeted other friendly unit
          // (355.7; "another" excludes the source per 740.1.a). effect.buff
          // implements 702.2.a / 702.3.a / 427.1.c: a unit that already has a
          // Buff is a legal choice that simply is not Buffed again.
          id: "vanguard-helm.buff-another-unit",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "vanguard-helm.other-friendly-unit" }
          },
          targets: [
            {
              id: "vanguard-helm.other-friendly-unit",
              filter: { type: "unit", controller: "controller", zone: "board", other: true },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When a buffed friendly unit dies, buff another friendly unit. " +
    "(If it doesn't have a buff, it gets a +1 :rb_might: buff.)"
} satisfies CardProgram;

export default vanguardHelm;
