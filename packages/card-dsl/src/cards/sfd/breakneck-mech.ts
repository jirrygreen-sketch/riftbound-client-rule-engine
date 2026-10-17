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
 *   binding (RIFT-260) matches against the chained entry move; a later
 *   effect.ready would emit an extra "becomes ready" event and miss the entry
 *   replacement, so the body stays the declared entry action.
 *
 * Status: judge-required. The declared structures match the merged binding
 * shapes and are exercised by the golden, but two merged consumers are still
 * missing, so the card is not executable:
 * - the card-program -> LayerEngine registration path for a static ability
 *   (contract 3.5 / RIFT-257) does not exist, so the Deflect/Ganking grant is
 *   registered by no production caller; and the target.tax expansion of the
 *   granted Deflect has no legality/tax consumer yet;
 * - card-played-to-chain binding for the replacement is the caller's job
 *   (RIFT-257), including the condition's object-count re-evaluation.
 */
export default {
  canonicalCardId: "card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1)「Your Mechs have [Deflect] and [Ganking]」是静态持续授予（802.2 式的特征程序化能力），" +
    "Deflect（809）与 Ganking（810）的 KeywordDef 已合入，但静态 CardProgram → LayerEngine 的注册路径（契约 3.5 / RIFT-257）" +
    "尚未合入，没有任何生产调用方注册该 ability 层效果；且授予的 Deflect 展开为 target.tax，目标合法性与附加费用仍无消费者。" +
    "(2)「I enter ready if you control another Mech」的替代形状已按合并的 replacement 绑定（RIFT-260）写成入场改写" +
    "（effect.ready 以 objects: { kind: \"source\" } 指向即将进场的来源，见 keywords/Accelerate.ts 同形），但把它从" +
    "card-played 绑定到链/进入流程的卡牌程序接线（RIFT-257）未合入，condition 的对象计数也需该调用方在匹配时求值。" +
    "不近似实现：不把入场就绪改成事后 effect.ready（会多产生一次成为就绪事件并错过入场替代），也不把关键词授予写成其他效果。" +
    "依赖：RIFT-257（CardProgram → 链 / LayerEngine 绑定）、target.tax 消费方。",
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
