import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Undertitan (sfd-175-221) — Unit, 6 energy + 1 Order power, Might 5, tag The Void.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-175-221):
 *   When you play me, give your other units +2 :rb_might: this turn.
 *   As I'm revealed from your deck, [Add] :rb_energy_2:.
 *
 * Rules evidence (Core Rules v1.5):
 * - "When you play me" is a Play Effect (383.4.a): the card-played timing point
 *   filtered to this card. "your other units" is a set selection by
 *   characteristics — "each"/"all" effects are not targets (355.10.d) — so the
 *   body carries no TargetSpec; "other" excludes the source unit (355.9.c) and is
 *   expressed with the contract 3.6 anchor `exclude: "self"` (a bare `other: true`
 *   key is not a filter anchor and would silently let Undertitan take the +2).
 * - "give ... +2 :rb_might: this turn" is a temporary Might modification that
 *   expires at end of turn; Might is altered in the arithmetic layer (143.2.a,
 *   475–477) and the duration resolves to the layers `end-of-turn` lifetime
 *   (317.1.a / 468.7.c). It is never approximated with a Buff counter (702: Buffs
 *   are counters; effect.buff's own header sends temporary Might changes to
 *   continuous.might).
 * - "As I'm revealed from your deck" is not an instruction: 135.2.b.6 uses this
 *   exact text as its example of a replacement clause, and 369.1 / 370.1.b.1 name
 *   Undertitan as the example of a Replacement Effect over a reveal from the deck.
 *   "[Add] :rb_energy_2:" adds 2 Energy to the controller's Rune Pool (430.1, 166.1).
 *
 * Status: judge-required. The Might half now executes end to end; the replacement
 * half still lacks its registration consumer:
 * - The merged continuous.might instruction registers a per-object
 *   arithmetic-layer effect with an end-of-turn lifetime. The golden drives the
 *   card's own instruction through the interpreter, the reference kernel and the
 *   layer engine, and asserts that only the other friendly units get +2, that
 *   Undertitan itself and enemy units do not, and that the effect expires at
 *   end of turn.
 * - The replacement matcher, body, and default lifecycle binder are merged and
 *   exercised by the golden. A deck-hosted replacement still needs to be
 *   discovered before a reveal action while the host remains in the deck; the
 *   lifecycle currently attaches programs on zone-entry/chain transitions, so
 *   that initial deck registration remains a production integration gap.
 * Nothing is approximated: the +2 is never a Buff counter and the reveal clause
 * is never turned into a plain instruction.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "undertitan.grant-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" },
          // 355.10.d: "your other units" is a set selected by characteristics,
          // not a target choice; 355.9.c: "other" excludes the source unit
          // through the contract 3.6 `exclude` anchor.
          objects: {
            kind: "constant",
            value: {
              kind: "query",
              filter: {
                zone: "board",
                type: "unit",
                controller: "self",
                exclude: "self"
              }
            }
          }
        }
      }
    ]
  },
  {
    // "As I'm revealed from your deck, [Add] :rb_energy_2:." — the leading
    // clause is not an instruction (135.2.b.6) but a Replacement Effect over
    // the reveal (369.1 / 370.1.b.1); the replacement body is the merged Add of
    // 2 Energy (430.1). The missing piece is the CardProgram -> replacement
    // registration consumer (see judgeReason).
    kind: "replacement",
    replaces: {
      event: "card-revealed",
      filter: { source: "self", zone: "deck" }
    },
    with: [
      {
        id: "undertitan.add-energy-2",
        op: "effect.resources",
        args: {
          energy: { kind: "constant", value: 2 },
          linkKey: { kind: "constant", value: "resources" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-722d071685a6b301064e318e0f8ac8683e616a934d89658bf00fb0fedca48f5a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "半段可执行、半段未接线：(1)「give your other units +2 :rb_might: this turn」已可执行——continuous.might注册 arithmetic 层效果并支持 end-of-turn 期限" +
    "（317.1.a/468.7.c）；卡内选择按契约 3.6 写成 controller: \"self\" + exclude: \"self\"（\"other\" 排除来源，355.9.c），" +
    "golden 经解释器 + 参考内核 + 图层引擎真实执行（只有其他友方单位 +2、来源与敌方不变、回合结束到期）。" +
    "(2)「As I'm revealed from your deck, [Add] :rb_energy_2:」（135.2.b.6 的非指令从句）对应的 replacement/" +
    "已合入并能匹配 reveal 动作（card-revealed）、" +
    "with 体（effect.resources，430.1）也已可执行（golden 用卡自身的 replaces/with 数据驱动该绑定），" +
    "默认 lifecycle binder 已能注册并执行该 replacement；当前仍缺的是对 deck 中既有宿主的初始发现：" +
    "卡牌在 deck 内被 reveal 时，生命周期没有在 reveal 前为该宿主建立 replacement registration。" +
    "不近似实现（+2 不用 Buff 计数器近似，揭示句也不改写成普通指令）。",
  abilities,
  sourceText:
    "When you play me, give your other units +2 :rb_might: this turn.\n" +
    "As I'm revealed from your deck, [Add] :rb_energy_2:."
} satisfies CardProgram;

export default program;
