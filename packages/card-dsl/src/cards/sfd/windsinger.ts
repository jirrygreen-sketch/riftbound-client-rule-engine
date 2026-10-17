import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Windsinger — sfd-138-221 (CR v1.5 811.1, 383.3.a, 355.9.b/c).
 * The first you may is a Finalize decision, represented by optional:true.
 * Effective-Might/another target predicates and full Hidden integration remain
 * blocked; returning an already locked unit uses the real return-to-hand action.
 */
const RETURN_TARGET = "windsinger.other-small-unit";

const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: true,
    body: [
      {
        id: "windsinger.return-to-hand",
        op: "effect.zone",
        args: {
          target: { kind: "constant", value: RETURN_TARGET },
          to: { kind: "constant", value: "hand" },
          amount: { kind: "constant", value: 1 }
        },
        targets: [
          {
            id: RETURN_TARGET,
            filter: {
              type: "unit", zone: "board", location: "battlefield",
              exclude: "source", mightLte: 3
            },
            min: 1, max: 1, selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-75f4edacd5ddc4bb087703bc231650c3942cea51f1bdb7b370bd27a6da6fd390",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "(1) 目标的有效 Might 上限 mightLte:3（143.2.a、355.9.b）及 another 的 exclude:source 尚未由 programs/filters.ts 接到生产目标查询，依赖 RIFT-359；不能忽略过滤条件。(2) 首个 you may 按 383.3.a 必须在 Finalize 决定；programs/triggers.ts 的 optional 尚未映射到 mayAtFinalize，不能改成结算期 choice.optional。(3) Hidden 的 cost.hidden 尚未接通 811.1.b 的 Hide、面朝下/下回合解锁及 Reaction 免费打出，也缺 811.1.d.3 的原战场 Play Effect 目标限制。通用 card-played 注册和 effect.zone 回拥有者手牌子效果已存在，不再作为缺口。",
  abilities,
  sourceText:
    "Hidden (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, you may return another unit at a battlefield with 3 :rb_might: or less to its owner's hand."
} satisfies CardProgram;

export default program;
