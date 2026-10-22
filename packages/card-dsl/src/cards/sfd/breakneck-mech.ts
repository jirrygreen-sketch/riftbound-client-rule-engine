import type { CardProgram } from "../../ir/index.js";

/**
 * Breakneck Mech (sfd-071-221) — Unit, Mind, tag Mech.
 *
 * Printed text:
 *   Your Mechs have [Deflect] and [Ganking]. (Opponents must pay [rainbow]
 *   to choose us with a spell or ability. We can move from battlefield to
 *   battlefield.)
 *   I enter ready if you control another Mech.
 *
 * Modeling notes (Core Rules v1.5):
 * - "Your Mechs have [Deflect] and [Ganking]" is a static continuous grant
 *   (802.2 style trait-programmatic ability): a single grant-keyword static
 *   ability covering every Mech permanent the controller controls (133.3.a/133.8). The Deflect
 *   (809) and Ganking (810) KeywordDef files are merged, so the granted
 *   keywords expand through the registry.
 * - "I enter ready if you control another Mech" replaces the default
 *   exhausted entry rather than readying afterwards. 359.2.c/369.3/805.6 make
 *   this an entry-orientation replacement, which the merged replacement
 *   binding matches against the chained entry move; a later
 *   effect.ready would emit an extra "becomes ready" event and miss the entry
 *   replacement, so the body stays the declared entry action.
 *
 * Status: executable. Production-path goldens prove that the default static
 * binder re-expands the granted Deflect into Chain Finalize's any-domain
 * target tax and the granted Ganking into the Standard Move query. The same
 * lifecycle path evaluates the "another Mech" condition before applying the
 * entry-orientation replacement, producing a ready entry only when the
 * controller has another Mech on the Board.
 */
export default {
  canonicalCardId: "card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "grant-keyword",
        keywords: ["Deflect", "Ganking"],
        // 133.3.a/133.8：“Your Mechs”按标签引用场上对象，不额外限制 type。
        filter: { tag: "Mech", controller: "controller", zone: "board" }
      }
    },
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        // 370.1.b：过滤描述被替代的入场事件——只替代默认的横置入场。
        filter: { self: true, exhausted: true }
      },
      with: [
        {
          id: "breakneck-mech.enter-ready",
          // 369.3 / 805.6：以 objects: { kind: "source" } 让即将进场的本来源直接以就绪状态入场，
          // 与 effect.ready 的原语约定一致（keywords/Accelerate.ts 同形）。
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ],
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: {
            // 引擎词汇：标签用 tags 列表；"another" 用契约 3.6 的 exclude 锚点
            // （layers/filter.ts 不认单数 tag / other 键，旧写法计数恒为 0）。
            tags: ["Mech"],
            controller: "self",
            zone: "board",
            exclude: "self"
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "Your Mechs have [Deflect] and [Ganking]. (Opponents must pay :rb_rune_rainbow: to choose us with a spell or ability. We can move from battlefield to battlefield.)\nI enter ready if you control another Mech."
} satisfies CardProgram;
