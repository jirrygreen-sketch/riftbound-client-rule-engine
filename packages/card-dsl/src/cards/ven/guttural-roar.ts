import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Guttural Roar (ven-072-166) — Spell, 2 energy, no printed Power/Might, domain Body.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-072-166，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)\n" +
 *   "Give a unit +2 :rb_might: this turn. If it's [Empowered], give it +4 :rb_might: " +
 *   "this turn instead."
 *
 * 规则依据（Core Rules v1.5）：
 * - [Action]（806.1 / 806.1.c）：许可类关键词，授予在任意玩家回合的 Showdown 期间打出的
 *   许可；卡侧只声明 keyword（契约 3.7），展开与链许可由 keywords/Action.ts 与 chain/ 负责。
 * - "Give a unit +2 :rb_might: this turn"：单位是 Target（355.7 / 355.9.a.1）；
 *   带回合期限的临时 Might 修改属算术图层（continuous.might + 317.2.c 到期），
 *   effect.buff 文件头明确临时 Might 修改绝不归 CR 702 的 Buff 计数器。
 * - "If it's [Empowered], give it +4 :rb_might: this turn instead."：
 *   135.2.b.5.b 规定紧跟主句的条件从句只作用于该从句所在的指令；这里是**互斥数量**——
 *   满足条件时给 +4、否则给 +2，不是两次叠加。因此第一条指令（+2）带该条件的否定，
 *   第二条指令（+4）带该条件本身，两条共用同一个已锁定的目标（"it" 就是前一条选定的
 *   那个单位，不再重新选择）。"[Empowered]" 是 828.2 的可检查特征。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 临时 Might 修改没有已合入的执行原语：契约 3.6 的封闭 GameAction 集合没有 Might 修改
 *    动作，effects/instructions/ 也没有注册通过 ResolveContext.addContinuous 创建
 *    continuous.might 的 op（layers 能求值，卡牌侧无入口；RIFT-91）。
 * 2. "If it's [Empowered]" 的谓词没有已合入实现：Condition 只有 always/never/compare/all/
 *    any/not/expression，没有 empowered 状态谓词；layers/engine.ts 的 conditionMatches 只
 *    识别 always/never/type/has-tag/has-keyword，且未识别条件按 true 处理，所以不能把该
 *    从句写成就近似的真条件。程序里保留具名谓词 is-empowered 与互斥条件形状，绝不近似成
 *    恒真、也不把两条数量合并成一条固定的 +2。
 * 3. 已支持部分：互斥条件形状与共用目标的声明由 golden 结构断言覆盖；真实 Might 落地写
 *    test.todo（依赖 RIFT-91）。
 * 依赖：RIFT-91（continuous.might 卡牌侧入口与到期、Empowered 谓词）。
 */
const EMPOWERED_CONDITION = {
  kind: "expression",
  value: { kind: "constant", value: "is-empowered" }
} as const;

const abilities: Ability[] = [
  { kind: "keyword", keyword: "action" },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 2 }
    },
    body: [
      {
        // "Give a unit +2 :rb_might: this turn" — 只在目标不是 [Empowered] 时套用：
        // 紧跟其后的从句用 "instead" 改写成 +4（135.2.b.5.b），两条互斥、不叠加。
        id: "guttural-roar.give-plus-2",
        op: "continuous.might",
        condition: { kind: "not", condition: EMPOWERED_CONDITION },
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "this-turn" },
          target: { kind: "constant", value: "guttural-roar.unit" }
        },
        targets: [
          {
            id: "guttural-roar.unit",
            filter: { type: "unit", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        // "If it's [Empowered], give it +4 :rb_might: this turn instead" — 同一目标的
        // 互斥分支："it" 就是前一条指令锁定的那个单位，因此这里引用同一个 TargetSpec，
        // 不重新选择（也不重复声明 targets）。链接到前一条：目标被忽略时本指令同样被忽略
        // （359.3.e.14.a），而前一条只是被条件否定跳过时本指令仍执行（359.3.e.14）。
        id: "guttural-roar.give-plus-4-instead",
        op: "continuous.might",
        linkedTo: "guttural-roar.give-plus-2",
        condition: EMPOWERED_CONDITION,
        args: {
          amount: { kind: "constant", value: 4 },
          duration: { kind: "constant", value: "this-turn" },
          target: { kind: "constant", value: "guttural-roar.unit" }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-1ced4268c533ffec88b27ec278a78271dee36cc714cbc77853dc64a26a1cda7b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) 临时 Might 修改没有已合入执行原语：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，" +
    "effects/instructions/ 也没有注册通过 ResolveContext.addContinuous 创建 continuous.might 的 op（layers 能求值，卡牌侧无入口），" +
    "effect.buff 只处理 CR 702 的 Buff 计数，不能近似；本卡没有印刷下限（143.2.c 是一般规则）。(2)「If it's [Empowered]」的谓词没有已合入实现：" +
    "Condition 只有 always/never/compare/all/any/not/expression，没有 empowered 谓词，layers/engine.ts 的 conditionMatches 只识别 " +
    "always/never/type/has-tag/has-keyword 且未识别条件按 true 处理；本卡按 135.2.b.5.b 只保留互斥条件形状" +
    "（+2 挂该谓词的否定、+4 挂该谓词本身）与共用目标的声明，绝不写成恒真条件、也不把两条数量合并成固定 +2。" +
    "依赖：RIFT-91（continuous.might 卡牌侧入口与到期、Empowered 谓词）。",
  abilities,
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit +2 :rb_might: this turn. If it's [Empowered], give it +4 :rb_might: this turn instead."
} satisfies CardProgram;
