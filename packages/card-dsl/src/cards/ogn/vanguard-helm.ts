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
 * Status: judge-required (re-reviewed 2026-10-17):
 * - "buffed" is expressible and verified against the merged matcher: 702.3
 *   allows only one Buff on a Unit at a time and effect.buff refuses to place a
 *   second one, so `characteristics: { buffs: 1 }` is exactly 702.2.a's "has a
 *   Buff counter"; events/pipeline-match.ts compares it with `===` against the
 *   dying unit's snapshot, and a golden asserts it matches a buffed unit and
 *   rejects an unbuffed one.
 * - the death event's payload filter must be bound to the dying unit of THIS
 *   trigger, and the trigger must be collected with the dying unit's last-known
 *   information (383.2.c.3.b / 429.1.a.1.b). The pipeline already collects
 *   object-killed with the pre-leave snapshot, and the card-program →
 *   TriggerRegistration adapter supplies `activeZones` and the trigger body.
 *   Binding currently stops on the body target's unsupported `other` filter,
 *   so the trigger cannot reach production resolution yet.
 *   (The "friendly" half is verified against the merged matcher: for
 *   `object-killed` the payload's `player` is the dying unit's controller, so
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
    "触发绑定缺失（复核 2026-10-17）：buffed 谓词已可用——702.3 规定一名单位至多一个 Buff 且 effect.buff 不重复放置，" +
    "因此 characteristics:{buffs:1} 精确等于 702.2.a 的「身上有 Buff counter」，已对合入匹配器（events/pipeline-match.ts）实测" +
    "（buffed 单位命中、未 buff 单位不命中，golden 断言）；friendly 半段的 player:self 同样与 object-killed 载荷的控制者对齐。" +
    "剩余缺口是生产绑定器拒绝正文目标 filter 中的 `other` 字段（programs/filters.ts 报 Unsupported filter field other），" +
    "因此本卡虽已有 CardProgram → TriggerRegistration 接线，仍不能把“another friendly unit”目标送入生产结算；" +
    "pipeline 以离场前快照收集 object-killed 的机制已具备。" +
    "Buff 正文（另一个友方单位，740.1.a；effect.buff 的 702.2.a/427.1.b 语义）只用已合入结构，由 golden 以调用方提供的 Finalize 目标真实执行。" +
    "整卡因触发绑定保持 judge-required，不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          // "a buffed friendly unit": the dying unit must be a unit controlled by
          // this ability's controller (740.1.a) and must have a Buff counter
          // (702.2.a). 702.3 caps a unit at one Buff, so buffs:1 is the exact
          // "has a Buff counter" predicate; the merged matcher compares
          // characteristics with === against the dying unit's snapshot.
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
