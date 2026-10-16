import type { CardProgram } from "../../ir/index.js";

/**
 * Poro Herder (ogn-061-298) — Unit, 3 energy + 1 Calm power, Might 3, Freljord.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-061-298):
 *   When you play me, if you control a Poro, buff me and draw 1. (If I don't
 *   have a buff, I get a +1 :rb_might: buff.)
 *
 * Rules evidence (Core Rules v1.5):
 * - "When you play me" is the Play Effect trigger (383.4.a, 383.4.a.1), i.e.
 *   the merged `card-played` timing point filtered to this card.
 * - "if you control a Poro" is an additional conditional statement immediately
 *   after the trigger condition, so it belongs to the Trigger Condition and is
 *   evaluated before the ability goes on the chain (383.2.a.1); it is written
 *   on the TriggerSpec. "Poro" is a tag on the unit (105 tags; the local deck
 *   catalog tags 14 identities with "Poro"), and "you control" is the
 *   controller selector the production ChainEngine context maps from `self` to
 *   the ability controller (chain/engine.ts context()).
 * - "buff me" places the single Buff counter of 702.2.a/702.3 with the host
 *   anchored by the contract 3.6 "self" selector (merged object filter anchor);
 *   the parenthetical is reminder text for 702/703. "draw 1" is the merged
 *   effect.draw (414.3), whose player defaults to the ability controller
 *   (190.6.d implied "you").
 * - The two instructions are separate: the buff can legitimately do nothing
 *   when this unit already has a Buff (702.3.a, 427.1.c), and the draw is a
 *   distinct sentence that still happens (359.3.e.11, 359.3.e.14.a).
 *
 * Status: judge-required. The two instructions and the trigger subscription are
 * merged (the golden test executes the buff + draw body, including the
 * already-buffed and stale-target paths), but the Trigger Condition itself has
 * no merged execution path:
 * - the Events pipeline requires a host `testTrigger` adapter for any trigger
 *   with a condition (events/pipeline.ts throws "Trigger condition adapter
 *   required"); only engine-core's test helper installs one
 *   (test/chain/helpers.mjs) — nothing in the merged production/server code
 *   provides it (RIFT-120 chain/events wiring).
 * - the controller placeholder inside a trigger-condition filter has no merged
 *   resolver: the reference test kernel's filter matcher compares the raw
 *   placeholder string (test-kernel.ts matchesFilter) and does not resolve
 *   `self`; only the ChainEngine's ResolveContext query normalizes it, and that
 *   path is not reachable for trigger conditions yet.
 * Not approximated: counting every Poro on the board (including the opponent's)
 * would implement a different ability than the printed "you control a Poro".
 * Dependencies: RIFT-120 (chain/event pipeline wiring) and a trigger-condition
 * resolver for card-program filters.
 */
export default {
  canonicalCardId: "card.hash-d30257c95bd0d16256944f4942f276da6f4e29317a22692f8f2bd04d8b0b5212",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发条件无法执行：「if you control a Poro」按 383.2.a.1 属触发条件（进链前判定），但合入的事件管线对带条件的触发要求宿主提供 testTrigger 适配器" +
    "（events/pipeline.ts 抛 Trigger condition adapter required），只有 engine-core 的测试 helper（test/chain/helpers.mjs）安装它，生产/服务端没有；" +
    "且触发条件过滤器里的控制者占位符没有已合入的解析方（参考测试内核的 matchesFilter 按原样比较、不解析 self；" +
    "只有 ChainEngine 的 ResolveContext query 会归一化，而该路径对触发条件不可达）。" +
    "依赖：RIFT-120（链/事件管线接线）与触发条件过滤器解析。不近似实现——把场上任意 Poro（含对手的）都算作条件满足会实现成另一张卡。" +
    "buff me 与 draw 1 本体（effect.buff、effect.draw）已合入并在 golden 中真实执行。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } },
        // 383.2.a.1: part of the Trigger Condition, checked before the ability
        // is placed on the chain. "a Poro" is the printed tag (105).
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "objects",
            filter: { type: "unit", tag: "Poro", controller: "self", zone: "board" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "poro-herder.buff-me",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "poro-herder.me" }
          },
          targets: [
            {
              id: "poro-herder.me",
              // "me" is the ability host; the symbolic self selector is bound
              // by the interpreter (contract 3.6).
              filter: { object: "self", type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // A separate sentence (359.3.e.14.a): still draws even when the buff
          // places no counter (702.3.a / 427.1.c).
          id: "poro-herder.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "When you play me, if you control a Poro, buff me and draw 1. (If I don't have a buff, I get a +1 :rb_might: buff.)"
} satisfies CardProgram;
