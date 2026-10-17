import type { CardProgram } from "../../ir/index.js";

/**
 * Leona, Zealot (ogn-079-298).
 * CR v1.5 194.3.a: use the actual mode's Victory Score, not a hardcoded eight.
 * CR 359.2.c / 805.6.a: enter ready is replacement, not a ready action afterward.
 * The arithmetic effect is continuous, not a Buff or a temporary stun trigger.
 * Its printed minimum of 1 is an explicit card constraint; do not use a zero clamp.
 * Player-query and replacement.enter declarations are blocked pending their consumers.
 */
const program = {
  canonicalCardId: "card.hash-da797609bf7c16ecdf7c10aed579c7d786c25395e580819421a8f380186df025",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "replacement.enter 已有绑定路径，但该替代的 condition 仍依赖读取各对手分数及当前 Victory Score 的玩家谓词（CR 194.3.a / 359.2.c），" +
    "当前 evaluateCondition 无 players/scoreAtLeast/victory-score 求值，不能把入场就绪模拟为无条件 effect.ready。" +
    "持续 -8 Might 的 stunned/enemy/here 过滤及 minimum:1 钳制也无法从 CardProgram 静态绑定到图层（CR 478）：" +
    "静态 binder 不支持 relative opponent 与 same-location 动态对象过滤。依赖：玩家分数谓词与动态静态过滤绑定；不固定 Victory Score 为 8。",
  abilities: [
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        filter: {
          object: "self",
          exhausted: true
        }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "players",
          filter: {
            relation: "opponent",
            scoreAtLeast: {
              relativeTo: "victory-score",
              offset: -3
            }
          }
        },
        operator: "gte",
        right: {
          kind: "constant",
          value: 1
        }
      },
      with: [
        {
          id: "enter-ready",
          op: "replacement.enter",
          args: {
            objects: {
              kind: "constant",
              value: "self"
            },
            exhausted: {
              kind: "constant",
              value: false
            }
          }
        }
      ]
    },
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        layer: "arithmetic",
        mode: "add",
        amount: {
          kind: "constant",
          value: -8
        },
        minimum: 1,
        filter: {
          type: "unit",
          zone: "board",
          controller: "opponent",
          stunned: true,
          sameLocationAs: "self"
        }
      }
    }
  ],
  sourceText: "If an opponent's score is within 3 points of the Victory Score, I enter ready.\nStunned enemy units here have -8 :rb_might:, to a minimum of 1 :rb_might:."
} satisfies CardProgram;

export default program;
