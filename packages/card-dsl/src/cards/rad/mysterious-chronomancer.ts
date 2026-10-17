import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mysterious Chronomancer (rad-050-167) — Unit, 5 energy, 4 Might, Mind.
 *
 * 原文："When you play me, [Predict 2]. (Look at the top 2 cards of your Main Deck. "
 *       "Recycle any of them and put the rest back in any order.)\n"
 *       "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)"
 *
 * 规则依据（CR v1.5）：
 * - "When you play me"：Play Effect（383.4.a / 420.4.a），但 [Predict 2] 本身是 437 的
 *   Limited Action 关键词式引用（437.1 / 437.3 的 "Predict X"，437.3.a：省略数值按 1；
 *   这里印刷值为 2）。按 README 第 5 节，卡牌只声明关键词、不重写展开；展开（看顶、
 *   可选回收、任意顺序放回顶部，437.1.a）应由 effects/keywords/<predict>.ts 负责。
 * - [Disarm 2]：831.1.b / 831.1.d（攻击触发，功能等价于 "When I attack, give an enemy
 *   unit here -2 [M] this turn"）；831.1.c 的 X = 2，声明时带 value: 2。
 *
 * status 判定（README 第 2 节）：executable（2026-10-17 复核）。Predict 的组合原语
 * （inspect/recycle/order）与 Disarm KeywordDef 均已合入，且 golden 通过解释器真实执行。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body: [
      {
        id: "mysterious-chronomancer.predict-look",
        op: "effect.inspect",
        args: {
          player: { kind: "object-property", object: "source", property: "controller" },
          zone: { kind: "constant", value: "deck" },
          scope: { kind: "constant", value: "top" },
          picksSpecId: { kind: "constant", value: "mysterious-chronomancer.predict-top-2" },
          amount: { kind: "constant", value: 2 },
          choose: { kind: "constant", value: true },
          chooseCount: { kind: "constant", value: { min: 0, max: 2 } },
          choiceId: { kind: "constant", value: "mysterious-chronomancer.predict" },
          pickedKey: { kind: "constant", value: "predict-looked-at" },
          choosePicksKey: { kind: "constant", value: "predict-recycle" }
        }
      },
      {
        id: "mysterious-chronomancer.predict-recycle",
        op: "effect.recycle",
        linkedTo: "mysterious-chronomancer.predict-look",
        args: {
          objects: {
            kind: "linked",
            instructionId: "mysterious-chronomancer.predict-look",
            key: "predict-recycle"
          }
        }
      },
      {
        id: "mysterious-chronomancer.predict-put-back",
        op: "effect.order",
        linkedTo: "mysterious-chronomancer.predict-recycle",
        args: {
          destination: { kind: "constant", value: "top" },
          count: {
            kind: "arithmetic",
            operator: "sub",
            operands: [
              { kind: "constant", value: 2 },
              {
                kind: "linked-value",
                instructionId: "mysterious-chronomancer.predict-recycle",
                key: "recycledCount"
              }
            ]
          },
          chooseOrder: { kind: "constant", value: true }
        }
      }
    ]
  },
  { kind: "keyword", keyword: "disarm", value: 2 }
];

const program = {
  canonicalCardId:
    "card.hash-6b0bcf2f0d70419ac960f2e10f95b86b212de65ad51127d9ca67749bf9316641",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText:
    "When you play me, [Predict 2]. (Look at the top 2 cards of your Main Deck. " +
    "Recycle any of them and put the rest back in any order.)\n" +
    "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)"
} satisfies CardProgram;

export default program;
