import type { CardProgram } from "../../ir/index.js";

/**
 * Sona, Harmonious (ogn-073-298).
 * CR v1.5 317.1.a / 383.2.a.1: check battlefield presence at trigger time.
 * The condition is NOT repeated on the ready instruction, so leaving after triggering
 * does not by itself stop the effect. The printed four runes are targets (355.10).
 * Data discrepancy: the CR example says up to 4; this program retains catalog text and
 * mandatory four-target structure until that discrepancy is resolved.
 */
const program = {
  canonicalCardId: "card.hash-dfe8783713db3f1121fbe8f02d18a936119747140a56f3207d218839b579f070",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "本地印刷原文为 ready 4，CR v1.5 383.2.a.1 的 Sona 示例为 ready up to 4，数量选择口径存在数据差异，保留原文等待复核。已合入 effect.ready；自身在战场的触发时判定、己方 turn-end 与 friendly rune 过滤绑定依赖 RIFT-1/120，不能把该条件改成结算时条件。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "turn-end",
        filter: {
          event: "turn-end",
          player: "self"
        },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "objects",
            filter: {
              object: "self",
              zone: "battlefield"
            }
          },
          operator: "gte",
          right: {
            kind: "constant",
            value: 1
          }
        }
      },
      optional: false,
      body: [
        {
          id: "ready-runes",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: {
                kind: "target",
                id: "friendly-runes"
              }
            },
            amount: {
              kind: "constant",
              value: 4
            }
          },
          targets: [
            {
              id: "friendly-runes",
              filter: {
                type: "rune",
                zone: "rune-zone",
                controller: "controller"
              },
              min: 4,
              max: 4,
              selection: "any"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "While I'm at a battlefield, ready 4 friendly runes at the end of your turn."
} satisfies CardProgram;

export default program;
