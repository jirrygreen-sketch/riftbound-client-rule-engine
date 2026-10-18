import type { CardProgram } from "../../ir/index.js";

/**
 * Leona, Zealot (ogn-079-298).
 * CR v1.5 194.3.a: use the actual mode's Victory Score, not a hardcoded eight.
 * CR 359.2.c / 805.6.a: enter ready is replacement, not a ready action afterward.
 * The arithmetic effect is continuous, not a Buff or a temporary stun trigger.
 * Its printed minimum of 1 is an explicit card constraint; do not use a zero clamp.
 *
 * status 判定（2026-10-17 复核）：judge-required。两处已实测的当前缺口：
 * 1. 入场就绪替代的 condition 需要读取各对手分数与当前 Victory Score（194.3.a / 359.2.c）：
 *    CountExpr 的 subject 是自由字符串，生产/参考求值只把它当集合计数（expr.ts 的 count
 *    走 queryObjects(expr.filter).length），不解释 players/relation/scoreAtLeast/victory-score。
 *    实测该条件在 Board 上没有无关对象时为 false、放入一个无关单位后反而变成 true，
 *    既不能把入场就绪当成已验证语义，也不能把条件改成恒真。
 * 2. 持续 -8 Might 的静态绑定：programs/statics.ts 的 staticFilter 对 controller: "opponent"
 *    抛 "Static controller:opponent filter needs a relative-player query"（实测绑定失败），
 *    因此该光环连注册都做不到，更谈不上消费 stunned/sameLocationAs 与逐条 minimum。
 *    layers/ops 的 applyMightMinimums 是按 478.1.c 的逐条钳制 helper，只有调用方显式遍历条目时才生效，
 *    图层引擎本体仍只做终值 0 钳制（实测 amount:-8、minimum:1 读出 might=0 而非 1）。
 * 已合入并发可验证：replacement.enter 的绑定路径（state: "ready" 形状真实改写 chain→board 入场，
 * golden 断言入场后 ready 且不产生 object-readied 事件）。
 * 依赖：玩家分数谓词、动态静态过滤绑定与逐条 minimum 钳制的图层消费。不固定 Victory Score 为 8。
 */
const program = {
  canonicalCardId: "card.hash-da797609bf7c16ecdf7c10aed579c7d786c25395e580819421a8f380186df025",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "两处已实测的当前缺口：(1) 入场就绪替代的 condition 依赖各对手分数与当前 Victory Score 的玩家谓词" +
    "（194.3.a / 359.2.c）：CountExpr.subject 是自由字符串，生产与参考求值只把它当集合计数（expr.ts 的 count " +
    "走 queryObjects(expr.filter).length），不解释 players/relation/scoreAtLeast/victory-score：" +
    "实测该条件在 Board 上没有无关对象时为 false，放入一个无关单位后反而变成 true，" +
    "既不能把入场就绪当作已验证语义，也不能把条件改成恒真。" +
    "(2) 持续 -8 Might 的静态绑定：programs/statics.ts 的 staticFilter 对 controller: \"opponent\" 抛 " +
    "\"Static controller:opponent filter needs a relative-player query\"（实测 BOUND 失败），" +
    "因此该光环连注册都做不到（更谈不上消费 stunned/sameLocationAs 与逐条 minimum）。" +
    "layers/ops 的 applyMightMinimums 是按 478.1.c 的逐条钳制 helper，但只有调用方显式遍历条目时才生效，" +
    "图层引擎本体仍只做终值 0 钳制（实测 amount:-8、minimum:1 的注册读出 might=0 而非 1）。" +
    "已合入并发可验证：replacement.enter 的 state: \"ready\" 形状真实改写 chain→board 入场（golden 断言）。" +
    "依赖：玩家分数谓词、相对玩家静态过滤绑定与逐条 minimum 钳制的图层消费；不固定 Victory Score 为 8。",
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
            // CR 369.3 / 359.2.c: the merged replacement.enter declaration
            // takes the entry orientation as `state` (the same shape used by
            // ogn/sun-disc, ogn/iron-ballista, ven/platewyrm-egg).
            state: { kind: "constant", value: "ready" }
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
