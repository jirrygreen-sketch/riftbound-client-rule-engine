import type { CardProgram } from "../../ir/index.js";

/**
 * Breakneck Mech (sfd-071-221) — Unit, Body, tag Mech.
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
 *   ability covering every Mech unit the controller controls. The Deflect
 *   (809) and Ganking (810) KeywordDef files are merged, so the granted
 *   keywords expand through the registry.
 * - "I enter ready if you control another Mech" replaces the default
 *   exhausted entry rather than readying afterwards. 359.2.c/369.3/805.6 make
 *   this an entry-orientation replacement, which the merged replacement
 *   binding matches against the chained entry move; a later
 *   effect.ready would emit an extra "becomes ready" event and miss the entry
 *   replacement, so the body stays the declared entry action.
 *
 * Status: judge-required. The declared structures are exercised by the golden,
 * and attachProgramLifecycle does bind card statics/replacements/triggers, but
 * four real gaps remain, so the card is not executable:
 * - the granted Deflect expands to target.tax, which no merged reader turns
 *   into a TargetTaxSpec: target-plan.ts consumes caller-supplied options.tax
 *   / taxAdapter, and chain/engine.ts only collects taxes from that adapter
 *   without deriving any layer registration;
 * - the granted Ganking expands to a plain permission string while
 *   layers/rules/query.ts reads permission.routes, so the expansion shape
 *   never yields a battlefield-to-battlefield route;
 * - replacement/bind.ts matches the entry action before evaluating the
 *   replacement condition, so "if you control another Mech" is not enforced
 *   on the entry path;
 * - the condition's count filter uses the singular tag/other keys, which
 *   layers/filter.ts silently ignores when it evaluates the count query.
 */
export default {
  canonicalCardId: "card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1)「Your Mechs have [Deflect] and [Ganking]」已由 attachProgramLifecycle 的" +
    "createEngineStaticBinder 绑定到静态图层（continuous.grant-keyword 有图层读者），但授予的 Deflect 展开为 target.tax，" +
    "当前没有任何读取方把它派生为 target-plan.ts 消费的 TargetTaxSpec：该文件只接受调用方传入的 options.tax / taxAdapter，" +
    "chain/engine.ts 的 taxAdapter 也只把已产生的税收进附加费用数组，不会从图层推导 Deflect 税，对手选择本方 Mech 时的合法性/加费不生效。" +
    "(2) Ganking 展开的 continuous.movement.permission 是纯字符串 \"battlefield-to-battlefield\"，而 layers/rules/query.ts 的" +
    " movement() 读 permission.routes（对象形状），因此纯字符串产生不出 route，canGank 仍为 false。" +
    "(3)「I enter ready if you control another Mech」的入场改写已在 replacement/bind.ts 中绑定并生效，但 matchesEnterAction 在" +
    " testCondition 之前直接 return true，能力 condition 不在入场匹配路径求值，\"another Mech\" 门控不会被强制。" +
    "(4) 该 condition 的 count 过滤器使用单数 tag / other 键，layers/filter.ts 求值 queryObjects 时静默忽略这两个键" +
    "（只认 tags 列表），且没有 other-exclusion 语义，\"another Mech\" 的对象计数必然算错。" +
    "依赖：target.tax 图层派生、Ganking permission 形状调和、入场替代 condition 求值、相对对象计数过滤器。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "grant-keyword",
        keywords: ["Deflect", "Ganking"],
        // "Your Mechs"：由本能力控制者控制、标签为 Mech 的场上单位。
        filter: { type: "unit", tag: "Mech", controller: "controller", zone: "board" }
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
            tag: "Mech",
            controller: "controller",
            zone: "board",
            other: true
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
