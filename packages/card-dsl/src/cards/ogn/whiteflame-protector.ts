import type { CardProgram } from "../../ir/index.js";

/**
 * Whiteflame Protector (ogn-082-298).
 * CR v1.5 383.4.a / 478 / 317.1: mandatory self play trigger, +8 Might until turn end.
 * Any unit is a legal target, including an enemy or this unit. There is no
 * other/friendly/here restriction. Temporary Might must not be encoded as Buff counters.
 */
const program = {
  canonicalCardId: "card.hash-b9737e97366888566c3b22952ffcbbb0194dfeed8bd919f0e724f6d93433206e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "缺已注册的 continuous.might 指令及 CardProgram 目标/期限到图层的桥接（CR 478 / 317.1；RIFT-91）。图层引擎已存在，但不等于该原始指令可执行；+8 this turn 不是 Buff，不用 effect.buff 近似实现。自身 card-played 触发绑定依赖 RIFT-1/120。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          object: "self"
        }
      },
      optional: false,
      body: [
        {
          id: "grant-might",
          op: "continuous.might",
          args: {
            target: {
              kind: "constant",
              value: "unit"
            },
            amount: {
              kind: "constant",
              value: 8
            },
            duration: {
              kind: "constant",
              value: "end-of-turn"
            }
          },
          targets: [
            {
              id: "unit",
              filter: {
                type: "unit",
                zone: "board"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play me, give a unit +8 :rb_might: this turn."
} satisfies CardProgram;

export default program;
