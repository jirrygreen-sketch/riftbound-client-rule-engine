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
 * Status: judge-required. The declared structures are exercised by the golden,
 * and attachProgramLifecycle does bind card statics/replacements/triggers, but
 * three real gaps remain, so the card is not executable:
 * - the granted Deflect expands to target.tax, which no merged reader turns
 *   into a TargetTaxSpec: target-plan.ts consumes caller-supplied options.tax
 *   / taxAdapter, programs/statics.ts layerFor rejects the kind outright
 *   ("no layer mapping"), and chain/engine.ts only collects taxes from that
 *   caller adapter;
 * - the granted Ganking expands to a plain permission string while
 *   layers/rules/query.ts reads permission.routes, so the expansion shape
 *   never yields a battlefield-to-battlefield route;
 * - replacement/bind.ts matches the entry action before evaluating the
 *   replacement condition, so "if you control another Mech" is not enforced
 *   on the entry path.
 * The condition itself now uses the canonical spelling (`tags` plus the
 * `exclude: "self"` anchor) because layers/filter.ts has no `tag`/`other`
 * keys; the removed spelling always evaluated to zero objects.
 */
export default {
  canonicalCardId: "card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "复核 2026-10-17，三处缺口，均不近似实现：(1)「Your Mechs have [Deflect] and [Ganking]」已由 attachProgramLifecycle 的" +
    "createEngineStaticBinder 绑定到静态图层（continuous.grant-keyword 有图层读者），但授予的 Deflect 展开为 target.tax，" +
    "当前没有任何读取方把它派生为 target-plan.ts 消费的 TargetTaxSpec：该文件只接受调用方传入的 options.tax / taxAdapter，" +
    "programs/statics.ts 的 layerFor 对该 kind 直接抛 ProgramBindingError（no layer mapping），" +
    "chain/engine.ts 的 taxAdapter 也只把已产生的税收进附加费用数组，不会从图层推导 Deflect 税，对手选择本方 Mech 时的合法性/加费不生效。" +
    "(2) Ganking 展开的 continuous.movement.permission 是纯字符串 \"battlefield-to-battlefield\"，而 layers/rules/query.ts 的" +
    " movement() 读 permission.routes（对象形状），因此纯字符串产生不出 route，canGank 仍为 false。" +
    "(3)「I enter ready if you control another Mech」的入场改写已在 replacement/bind.ts 中绑定并生效，但 matchesEnterAction 在" +
    " testCondition 之前直接 return true，能力 condition 不在入场匹配路径求值，\"another Mech\" 门控不会被强制。" +
    "已修：该 condition 原先用单数 tag / other 键，layers/filter.ts 只认 tags 列表、也没有 other-exclusion 语义，" +
    "计数恒为 0；现按引擎词汇改写为 tags: [\"Mech\"] 加 exclude: \"self\" 锚点（契约 3.6），\"another Mech\" 的计数在" +
    "解释器与链的 query 归一化下都正确（golden 用合并的 evaluateCondition 真实求值）。" +
    "另按 CR 133.3.a/133.8 修正授予范围：Mech 是标签，不额外限制为 unit。" +
    "执行证据：test/cards/templates/static-replacement-effect-ready-677.test.mjs；仅覆盖已支持部分，整卡与条件边界仍阻塞。" +
    "依赖：target.tax 图层派生、Ganking permission 形状调和、入场替代 condition 求值。",
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
