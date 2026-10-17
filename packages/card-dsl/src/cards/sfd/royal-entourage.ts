import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Royal Entourage (sfd-039-221) — Unit, Calm, Shurima.
 * energy 3, power 1 (Calm), Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-039-221，逐字）:
 *   "When you play me, ready or exhaust a legend."
 *
 * 规则依据（CR v1.5）:
 * - "When you play me"：383.4.a/420.4.a 的 Play Effect，时点 card-played，filter 用
 *   self: true 指称本卡。
 * - "ready or exhaust a legend"：当前 blocked 声明按契约 3.9 写成 choice.mode，
 *   每个分支各带一条已合入原语（effect.ready / effect.exhaust）；选择时点与目标计划仍须复核。
 * - 355.10.g 只豁免「you」控制的传奇；「a legend」不能直接套用该例外。
 *   以下 choose 数据保留为 blocked 建模，待传奇目标/非目标选择计划完成；它不证明
 *   当前两分支均可用于真实传奇。
 * - 416.1/415.1：ready 与 exhaust 各自是独立 GameAction，由两条原语提交。
 *
 * Current review:
 * CR v1.5 383.4.a/420.4.a: a self-scoped Play Effect.
 * Ready and Exhaust primitives and interpreter mode choices exist. The full
 * card still needs a Legend Zone, a Finalize mode plan and exhaust.choose
 * argument adaptation. CR 355.10.g only exempts legends "you" control from
 * targeting; the current generic non-target legend choices remain declarative.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "royal-entourage.mode",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              {
                id: "royal-entourage.ready-mode",
                body: [
                  {
                    id: "royal-entourage.ready-legend",
                    op: "effect.ready",
                    args: {
                      objects: {
                        kind: "constant",
                        value: {
                          kind: "choose",
                          id: "royal-entourage.choose-legend-to-ready",
                          filter: { type: "legend" },
                          min: 1,
                          max: 1,
                          prompt: "Choose a legend to ready."
                        }
                      }
                    }
                  }
                ]
              },
              {
                id: "royal-entourage.exhaust-mode",
                body: [
                  {
                    id: "royal-entourage.exhaust-legend",
                    op: "effect.exhaust",
                    args: {
                      choose: {
                        kind: "constant",
                        value: {
                          id: "royal-entourage.choose-legend-to-exhaust",
                          filter: { type: "legend" },
                          prompt: "Choose a legend to exhaust."
                        }
                      },
                      amount: { kind: "constant", value: 1 }
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-a32cc7d6df90c5796f8d933adb5747a302972d467cce6c5c691af4ece82b4429",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "仍缺 CR v1.5 107.4/174.2.b 的 Legend Zone：ZoneId/ZoneDestination 没有 legend-zone，game/lifecycle.ts 的 legend 仍创建在 chain，不能把合成 Board legend 的原语执行当作整卡证据。choice.mode 可在解释器执行，但 ChainEngine.assertFinalizationSurface 缺 Finalize 模式计划；effect.exhaust 的 choose 也只收字面选择对象，当前 Expr 包装未由 primitiveArgs 解包。另需按 355.9/355.10.g 复核「a legend」的目标建模：只有「you」控制的传奇例外，不能把任意传奇一律改为非目标选择。依赖：Legend Zone 契约/生命周期、模式计划、choose 参数适配及传奇目标计划。",
  abilities,
  sourceText: "When you play me, ready or exhaust a legend."
} satisfies CardProgram;

export default program;
