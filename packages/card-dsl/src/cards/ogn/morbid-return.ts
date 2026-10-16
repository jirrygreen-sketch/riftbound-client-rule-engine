import type { CardProgram } from "../../ir/index.js";

/**
 * Morbid Return (ogn-170-298) — Spell, 2 energy, Chaos.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Return a unit from your trash to your hand.
 *
 * Modeling notes (Core Rules v1.5):
 * - `action` keeps the printed [Action] keyword (806; spell intrinsic timing
 *   159.2.a); its `continuous.timing` expansion and the chain admission are
 *   owned by the keyword registry and chain/ (contract 3.7).
 * - "Return a unit from your trash to your hand" names a card in a public
 *   zone, so the choice is a Target (355.10.a: the Trash is a Public zone,
 *   and 355.9.a.1 keeps "unit" meaning a Unit; 355.9.a's own example is
 *   "Recycle a unit from your trash"). It is the merged effect.zone primitive
 *   with a TargetSpec and `to: "hand"` — a zone change (448.2), not a Move.
 * - The filter uses the frozen filter vocabulary (events/trigger-spec.ts):
 *   `zone: "trash"` selects the zone, and `owner: "self"` scopes it to the
 *   ability controller's Trash ("your trash"; each player has their own
 *   Trash, 108.2.a, and "self" is the controller selector the chain layer
 *   resolves — chain/engine.ts normalizes `controller`/`owner` "self" to the
 *   item's controller). The destination routing to the OWNER's hand is the
 *   action layer's job, so the card does not add a player argument.
 * - Printed cost (2 Energy, no printed Power — `power: null` in the catalog,
 *   which is not 0) is bound by the card identity at Finalize
 *   (356.1.c / printed-cost binding); the program intentionally declares no
 *   CostSpec rather than re-stating or rewriting the printed values.
 *
 * Status: judge-required — the effect body itself uses only merged primitives
 * and is executed in the golden test, but the printed [Action] line cannot be
 * honoured yet: keywords/Action.ts expands to a `continuous.timing` static
 * ability (806.1.c / 159.2.a), and the runtime path that turns it into an
 * action timing is still missing. ChainEngine.canAct() gates a Showdown play on
 * the caller-supplied draft.speed (chain/engine.ts) and never reads the
 * layers/rules `actionTimings` query, and no CardProgram -> ChainDraft play
 * adapter exists (chain/engine.ts describePlay is optional and unimplemented).
 * The CardProgram binding owner for both halves is RIFT-257; without it the
 * card cannot be played in a Showdown, so it is not executable end to end
 * (cards README §2, §5).
 */
const morbidReturn = {
  canonicalCardId: "card.hash-6d8e159513836dafac8b110c3107086e5b6f6971b99ba6ddfb0e749be264be76",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 [Action] 时机许可的可执行路径：keywords/Action.ts 已合入并展开为 static continuous.timing" +
    "（806.1.c / 159.2.a），但把它接进实战的绑定仍缺——(1) 没有 CardProgram 程序绑定（RIFT-257）把该 static 声明注册进图层；" +
    "(2) 链侧 ChainEngine.canAct() 只读 phase/showdown/priority 与调用方提供的 draft.speed，从不消费 layers/rules 的 actionTimings 查询，" +
    "Showdown 中的 Action 许可无从取得；(3) 没有任何 CardProgram → ChainDraft 打出适配（chain/engine.ts describePlay 可选且未实现）。" +
    "effect.zone 半段（trash → 拥有者手牌）只用已合入原语并有执行测试；依赖 RIFT-257（程序绑定与打出适配）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "morbid-return.return-unit",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "morbid-return.unit-in-trash" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "morbid-return.unit-in-trash",
              filter: { type: "unit", zone: "trash", owner: "self" },
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Return a unit from your trash to your hand."
} satisfies CardProgram;

export default morbidReturn;
