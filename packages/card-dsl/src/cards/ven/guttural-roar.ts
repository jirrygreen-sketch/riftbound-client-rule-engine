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
 *   continuous.might 指令已注册，golden 独立执行本卡 +2 指令的参数，断言
 *   arithmetic 图层注册、3→5 Might 及 317.2.c 的 turn-end 到期后回到 3。
 * - 真实缺口只剩 "[Empowered]" 状态谓词：生产 ObjectSnapshot（effects/contract.ts）
 *   没有 empowered 字段；expression 的非空字符串 "is-empowered" 会转成 true，
 *   不会读取目标状态，也不会因此抛 MissingInformation，不能作为条件执行证据；
 *   条件谓词属进行中任务 RIFT-359，两个状态分支继续保留 TODO。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，缺口不近似实现。
 * 程序里仅以 is-empowered 记录尚不能求值的状态条件及互斥形状，不把它视作已实现
 * 的状态查询。golden 覆盖身份/结构和独立 Might 原语，不执行整段条件分支。
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
    "continuous.might 已注册，golden 独立执行本卡 +2 指令的参数并断言 arithmetic 图层、3→5 Might 与 " +
    "317.2.c 的 turn-end 到期后恢复 3；该证据不覆盖条件分支。唯一缺口：「If it's [Empowered]」的 " +
    "828.2 状态谓词没有已合入实现——生产 ObjectSnapshot（effects/contract.ts）没有 empowered 字段，" +
    "expression 的非空字符串 is-empowered 会转成 true，不会查询目标状态，不能作为可执行的状态谓词。" +
    "本卡按 135.2.b.5.b 仅保留互斥条件形状（+2 挂该描述条件的否定、+4 挂描述条件本身）与共用目标的声明，" +
    "两个状态分支继续 TODO；不把整张卡标为 executable，也不把两条数量合并成固定 +2。" +
    "依赖：Empowered 状态谓词（进行中任务 RIFT-359）。",
  abilities,
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit +2 :rb_might: this turn. If it's [Empowered], give it +4 :rb_might: this turn instead."
} satisfies CardProgram;
