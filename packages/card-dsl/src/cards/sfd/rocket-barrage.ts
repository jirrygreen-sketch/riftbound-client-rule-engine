import type { CardProgram } from "../../ir/index.js";

/**
 * Rocket Barrage — sfd-077-221 (Spell, 4 energy + 1 Mind power, Mind, tags []).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, sfd-077-221, verbatim;
 * the local catalog glues the two mode sentences together, see the data note
 * below):
 *   [Repeat] :rb_energy_4::rb_rune_mind: (You may pay the additional cost to
 *   repeat this spell's effect, and may make different choices.)
 *   Choose one —
 *   Deal 4 to a unit in a base.Kill a gear.
 *
 * Catalog evidence: energy 4, power 1 (Mind), might null, domains ["Mind"], tags [].
 * Data note (not changed here): the catalog text has no separator between
 * "in a base." and "Kill a gear."; sourceText keeps the catalog text verbatim.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Repeat] (820) is an Optional Additional Cost keyword on Spells (820.1.a);
 *   the printed cost is 4 Energy plus one Mind power (820.1.c, 820.1.c.1), may
 *   be paid once (820.1.c.3), and 820.2/820.2.a require the choices to be made
 *   again for the additional execution. The additional cost is declared on the
 *   play ability in the merged CostSpec vocabulary (cost/plan-values.ts reads
 *   energy plus a Power payment with allowedDomains); the keyword expansion is
 *   owned by effects/keywords/Repeat.ts.
 * - "Choose one —": a bulleted list of two modes is chosen while finalizing the
 *   spell (355.3), expressed as choice.mode with count 1 and distinct modes
 *   (contract 3.9).
 * - "Deal 4 to a unit in a base." chooses one unit, so the unit is a target
 *   (355.7, 355.9.a.1) and "in a base" is a location restriction
 *   (355.10.b) spelled as the merged location filter ("base"). The Deal is the
 *   merged effect.damage (418) and its source defaults to this spell (418.6.a).
 * - "Kill a gear." names a gear in a public zone, so it is a target (355.7,
 *   429.6) killed by the merged effect.kill (429).
 *
 * Status: judge-required. Both mode instructions and the mode choice use merged
 * primitives and are executed by the golden test (one scenario per mode), but
 * the Finalize collection of the optional [Repeat] additional cost and the
 * paid-instance to interpreter-repeat wiring (with re-made mode choices) are
 * unmerged, so the whole card is not executable (820.1.c.1, 820.1.d.1, 820.2).
 * Re-checked 2026-10-17: RIFT-89/261 merged the cost planner and the cost
 * kinds, but nothing consumes this card's declared Repeat additional cost —
 * programs/play.ts translateCost rejects `kind: "additional"`
 * ("Additional costs are not bound") and the `optional` field
 * ("Unsupported play cost field optional"), no consumer turns the Repeat
 * keyword expansion's repeat.cost static ability into CostPlanInput
 * (createEngineStaticBinder throws "Static ability kind repeat.cost has no layer
 * mapping"), and chain/engine.ts assertFinalizationSurface still rejects
 * choice.mode ("Mode choices require a Finalize/Resolve choice-plan adapter"),
 * so the printed mode selection cannot be finalized at all.
 */
const rocketBarrage = {
  canonicalCardId: "card.hash-b104ab4f2d5ede379d04e1002cd97a70d95148d73cddde15852f5dce8b204e9e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前接线缺口（复核 2026-10-17），均不近似实现：" +
    "(1) [Repeat] :rb_energy_4::rb_rune_mind:（820.1.c.1/820.1.d.1）的附加费用已按 CostSpec 声明" +
    "（kind additional、4 energy + 1 Mind power、可选支付 choice），但没有任何已合入消费方把 PlayAbility 声明的该费用接进 CostPlanInput——" +
    "programs/play.ts 的 translateCost 对 kind \"additional\" 抛 \"Additional costs are not bound\"、对 optional 字段抛 \"Unsupported play cost field optional\"。" +
    "(2) Repeat 展开的 repeat.cost 静态声明同样没有消费方（createEngineStaticBinder.bindStatic 抛 \"Static ability kind repeat.cost has no layer mapping\"），" +
    "把已支付实例数接到解释器 repeat 节点并重做模式选择（820.2/820.2.a）的接线也不存在。" +
    "(3) 正文的 choice.mode 二选一（355.3，契约 3.9）在链的 Finalize 被 assertFinalizationSurface 直接拒绝" +
    "（ChainContractBlockedError \"Mode choices require a Finalize/Resolve choice-plan adapter\"），实测本卡经 createProgramBinding 的生产打出草稿即抛该错误。" +
    "effect.damage / effect.kill 本体均已合入，golden 分别真实执行两个模式；" +
    "另：本地卡牌数据把两个模式句连成 \"…in a base.Kill a gear.\"（缺分隔），sourceText 按逐字要求保留。" +
    "依赖：PlayAbility 与 repeat.cost 静态声明的费用计划消费方、解释器 repeat 节点的已支付实例接线，" +
    "以及 Finalize/Resolve 的 choice.mode 计划适配器。不近似实现（不把模式选择改成固定分支）。",
  abilities: [
    {
      kind: "play",
      // 印刷基础费用（4 energy + 1 Mind power）由 catalog 在 Finalize 绑定；此处 cost
      // 只声明 [Repeat] 的可选附加费用（820.1.c.1）。
      cost: {
        kind: "additional",
        keyword: "repeat",
        optional: true,
        payments: [
          {
            kind: "energy",
            amount: { kind: "constant", value: 4 },
            choice: {
              id: "rocket-barrage.repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          },
          {
            kind: "power",
            amount: { kind: "constant", value: 1 },
            // 印刷为 Mind 域符文；cost/plan-values.ts 的 Power 支付形状。
            allowedDomains: ["Mind"]
          }
        ]
      },
      body: [
        {
          id: "rocket-barrage.choose-one",
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "rocket-barrage.damage-mode",
                  body: [
                    {
                      id: "rocket-barrage.deal-4",
                      op: "effect.damage",
                      args: {
                        amount: { kind: "constant", value: 4 },
                        target: { kind: "constant", value: "rocket-barrage.unit-in-base" }
                      },
                      targets: [
                        {
                          id: "rocket-barrage.unit-in-base",
                          filter: { type: "unit", zone: "board", location: "base" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                },
                {
                  id: "rocket-barrage.kill-mode",
                  body: [
                    {
                      id: "rocket-barrage.kill-gear",
                      op: "effect.kill",
                      args: { target: { kind: "constant", value: "rocket-barrage.gear" } },
                      targets: [
                        {
                          id: "rocket-barrage.gear",
                          filter: { type: "gear", zone: "board" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Repeat] :rb_energy_4::rb_rune_mind: (You may pay the additional cost to repeat this spell's effect, and may make different choices.)\n" +
    "Choose one —\n" +
    "Deal 4 to a unit in a base.Kill a gear."
} satisfies CardProgram;

export default rocketBarrage;
