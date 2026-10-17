import type { CardProgram } from "../../ir/index.js";

/**
 * Lost to the Sands — CR v1.5 806, 355.3, 355.9.b, 429.6.
 * The catalog joins the two mode bullets as "battlefield.Kill"; sourceText is
 * retained verbatim. The interpreter executes both original mode bodies with
 * the production layer filter. Re-probed 2026-10-17: Finalize still needs a
 * mode choice plan, and nested mode targets still need a target lifecycle
 * adapter. programs/play.ts validateSurface and chain/engine.ts
 * assertFinalizationSurface reject choice.mode, and both also reject nested
 * instruction targets; RIFT-358's ordered picks cover zoneSlice/linked sources
 * only, not mode selection. Printed costs and Action timing are supported and
 * are not missing dependencies.
 */
export default {
  canonicalCardId: "card.hash-ebc16c621c62d012f80adc1a2faa4b87722a2ea924309743bafb7b413e043f1c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 CR 355.3 的模式 Finalize/Resolve 选择计划：programs/play.ts validateSurface 与 chain/engine.ts " +
    "assertFinalizationSurface 仍拒绝 choice.mode（describePlay 实测抛 “Mode choices require a Finalize/Resolve choice-plan adapter”）；" +
    "必须先在 Finalize 选择模式，再只锁定该模式的目标并在 Resolve 重验，不能把模式选择推迟到解释器结算。" +
    "两条模式中的嵌套目标还需要目标生命周期适配（同一函数对 nested target 抛 “Nested instruction targets require a target lifecycle adapter”）；" +
    "已合入的 RIFT-358 ordered pick 只提供 zoneSlice/linked 来源，不覆盖模式选择。[Action]、印刷费用计划及 effect.damage/effect.kill 本体不属于缺口。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "lost-to-the-sands.choose-one",
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            prompt: { kind: "constant", value: "Choose one —" },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "lost-to-the-sands.damage-mode",
                  body: [
                    {
                      id: "lost-to-the-sands.deal-4",
                      op: "effect.damage",
                      args: {
                        amount: { kind: "constant", value: 4 },
                        target: { kind: "constant", value: "lost-to-the-sands.unit" }
                      },
                      targets: [
                        {
                          id: "lost-to-the-sands.unit",
                          filter: { type: "unit", zone: "board", location: "battlefield" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                },
                {
                  id: "lost-to-the-sands.kill-mode",
                  body: [
                    {
                      id: "lost-to-the-sands.kill-gear",
                      op: "effect.kill",
                      args: { target: { kind: "constant", value: "lost-to-the-sands.gear" } },
                      targets: [
                        {
                          id: "lost-to-the-sands.gear",
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Choose one —\n" +
    "Deal 4 to a unit at a battlefield.Kill a gear."
} satisfies CardProgram;
