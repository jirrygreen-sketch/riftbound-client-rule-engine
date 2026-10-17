import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Windsinger — sfd-138-221 (CR v1.5 811, 383.3.a, 355.9.b/c, 143.2.a).
 * Re-verified 2026-10-17 against the merged engine. The first "you may" stays
 * ability.optional, but the printed May decision only reaches the Finalize
 * prompt while a card-side mayAtFinalize binding exists.
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
    "三处当前缺口（复核 2026-10-17），均不近似实现：" +
    "(1) 目标过滤仍有两条未接通：another 的 Symbolic exclude:\"source\"（355.9.c/740.1.a）被 programs/filters.ts 的 translateObjectFilter 以 \"Unsupported filter field exclude\" 直接拒绝，" +
    "且目标有效 Might 上限 mightLte:3（143.2.a、355.9.b）没有任何生产消费者——确认 translateObjectFilter 拒绝该字段，" +
    "layers/filter.ts 的 matchesObjectFilter 也会静默忽略未知键（7 Might 单位同样通过）。不能删掉任一条件（会放过所有战场单位）。" +
    "(2) 首个 you may 按 383.3.a 应在 Finalize（383.3.a.1/.a.2）决定：TriggerRegistration.mayAtFinalize 与 ChainEngine.finalize 的 Finalize 可选决策已经存在，" +
    "但 programs/triggers.ts 只把 ability.optional 传给 TriggerRegistration.optional，输出 mayAtFinalize: undefined，因此当前只能退化为触发时选择。" +
    "(3) Hidden（811.1）展开 static cost.hidden 后没有任何消费方：programs/statics.ts 的 layerFor 对 cost.hidden 抛 " +
    "\"Static ability kind cost.hidden has no layer mapping\"；cost/kinds/hidden.ts 只做 811.1.b 的计划/支付（Hide 行动没有接入链或回合流程），" +
    "契约 ZoneId 没有面朝下区域、turn/flow.ts 的隐藏牌清理抛 hidden-cleanup-state，" +
    "811.1.d.3 的「原战场 Play Effect 目标限制」与下回合 Reaction/免费打出也没有接线。" +
    "已可执行且有真实证据：card-played 的自我触发注册（programs/triggers.ts）与 effect.zone 的「回到拥有者手牌」动作（已含 stale-reference 边界）。",
  abilities,
  sourceText:
    "Hidden (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, you may return another unit at a battlefield with 3 :rb_might: or less to its owner's hand."
} satisfies CardProgram;

export default program;
