import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Arena Kingpin (unl-001-219) — Unit, 5 Energy, Might 3, Fury, tags Yordle/Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-001-219，逐字）：
 *   "I enter ready.\n:rb_exhaust:: Give a unit +3 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - 143.4 / 359.2.c：单位默认以横置状态进入 Board；"I enter ready." 按 369.3
 *   （该条以 Master Yi, Honed 的 "I enter ready." 举例说明入场替代效果）是把
 *   "横置进场"替换为"就绪进场"，因此按契约 3.1 写成 replacement 能力，with 体是
 *   就绪结果。805.6.a 的同型语义：这类替代不经过"先横置再就绪"的中间状态，因此
 *   effect.ready 文件头明确本原语不能模拟入场替代。
 * - 145.1 / 377.1：冒号之前是费用；本例的 ":rb_exhaust:" 是 415.5 的 "Exhaust this"
 *   （= Exhaust me）。145.2 / 377.3 规定单位启动能力在控制者的 Main Phase Open State
 *   执行并进入链，按契约 3.1 写成 activated.timing "action"（无 [Reaction] 印刷）。
 * - 「Give a unit +3 :rb_might: this turn」：355.9 的 "a unit" 由控制者在 Finalize 选择，
 *   是选目标（TargetSpec，不是 pick）；+3 是本回合的 Effective Might 算术修正
 *   （143.2.a 的三种 Might 形式 / 475 图层），归 layers 的 continuous.might，
 *   不是 702 的 Buff 计数器（effect.buff 文件头同款边界）。
 *
 * status = executable：RIFT-257/260 已把入场替代在 chain 入场前绑定，RIFT-258
 * 的 Might 图层原语和 activated/cost 管线也已合入；golden 通过 createProgramBinding
 * 和真实 fixture 覆盖入场就绪、支付 Exhaust、+3 Might 以及回合结束失效。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    // 369.3：以"单位进入的方式"描述的替代效果；自身以横置状态进入的事件被替代。
    replaces: { event: "object-enters-board", filter: { self: true, exhausted: true } },
    with: [
      {
        id: "arena-kingpin.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      // 415.5：[E] 是费用即 "Exhaust this"；无印刷 Energy 费用（不加 energy: 0）。
      payments: [{ kind: "exhaust", object: "self" }]
    },
    body: [
      {
        id: "arena-kingpin.grant-might",
        // 143.2.a / 475：本回合的 Might 算术修正，由已合入的 continuous.might
        // 原语写进 arithmetic 图层；objects 是 RIFT-258 之后的合入参数形状。
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          amount: { kind: "constant", value: 3 },
          duration: { kind: "constant", value: "end-of-turn" },
          objects: {
            kind: "constant",
            value: { kind: "target", id: "arena-kingpin.unit" }
          }
        },
        targets: [
          {
            id: "arena-kingpin.unit",
            // "a unit"（355.9）：Board 上的任意单位，不带控制者限制。
            filter: { zone: "board", type: "unit" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-42a7a3191d0a9e6cd6ac270c7dc6e9f36ee510fbfccf82e3b005ffd797864187",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities,
  sourceText: "I enter ready.\n:rb_exhaust:: Give a unit +3 :rb_might: this turn."
} satisfies CardProgram;
