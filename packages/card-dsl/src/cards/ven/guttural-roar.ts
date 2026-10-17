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
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：
 * - 旧 judgeReason 的「continuous.might 无卡牌侧入口（RIFT-91）」已不成立：
 *   continuous.might 指令已注册并经 runAbilityBody 真实执行（arithmetic 图层注册、
 *   317.2.c 的 end-of-turn 到期经 layers.expireAt("turn-end") 断言）。
 * - 真实缺口只剩 "[Empowered]" 状态谓词：生产 ObjectSnapshot（effects/contract.ts）
 *   没有 empowered 字段；具名 expression 谓词 "is-empowered" 在生产解释器求值抛
 *   MissingInformation（实测生产执行结果为 +2 分支 skipped / +4 分支 executed，
 *   partial outcome），不能作为可执行证据；条件谓词属进行中任务 RIFT-359。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，缺口不近似实现。
 * 程序里保留具名谓词 is-empowered 与互斥条件形状，绝不近似成恒真、也不把两条
 * 数量合并成一条固定的 +2。golden 覆盖身份/结构与 +4 分支的真实执行。
 * 依赖：Empowered 状态谓词（进行中任务 RIFT-359）。
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
    "一处已合入、一处仍缺，均不近似实现：「Give a unit +2/+4 :rb_might: this turn」的 continuous.might 指令已注册并经 " +
    "runAbilityBody 真实执行（+4 分支 executed，arithmetic 图层注册 + 317.2.c end-of-turn 到期经 layers.expireAt 断言，" +
    "331.4 的所有 this-turn 效果同到；生产解释器只对不可求值的谓词分支按 611.2.a/b 忽略）。唯一缺口：「If it's [Empowered]」的 " +
    "828.2 状态谓词没有已合入实现——生产 ObjectSnapshot（effects/contract.ts）没有 empowered 字段，具名 expression 谓词 " +
    "is-empowered 在生产解释器求值抛 MissingInformation（实测 +2 分支 skipped / +4 分支 executed 的 partial outcome），" +
    "不能作为可执行证据；条件谓词属进行中任务 RIFT-359。本卡按 135.2.b.5.b 保留互斥条件形状（+2 挂该谓词的否定、" +
    "+4 挂该谓词本身）与共用目标的声明，绝不写成恒真条件、也不把两条数量合并成固定 +2。" +
    "依赖：Empowered 状态谓词（进行中任务 RIFT-359）。",
  abilities,
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit +2 :rb_might: this turn. If it's [Empowered], give it +4 :rb_might: this turn instead."
} satisfies CardProgram;
