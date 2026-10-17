import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Bandle Soldier — CR v1.5 824.1 (Level 3), 369.3/143.4/359.2.c
 * (enter ready). 入场替代已可执行，Level 的控制者 XP 条件仍不可求值。
 * level-active:3 是描述性占位，非空字符串不能作为该条件的执行证据。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    // 824.1.a：印刷的 “[Level 3]” 是带数值的关键词；Dependent Ability 由卡牌程序持有（824.1.b.2）。
    keyword: "level",
    value: 3
  },
  {
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      filter: { source: "self", exhausted: true }
    },
    // 824.1.c：“当控制者有 3 点或更多 XP 时 Dependent Ability 生效”。
    // 描述性占位：此非空字符串会被 expression 视为真，整卡必须由 status 闸门阻断。
    condition: { kind: "expression", value: { kind: "constant", value: "level-active:3" } },
    with: [
      {
        id: "bandle-soldier.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-121fc6b958b52f3a54986facd825169683558bc6c00ae71fbb3323be8b3a1f7c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5 824.1.b.1/824.1.c/824.1.c.1/824.1.d）：[Level 3][>] 仍缺控制者 XP 的 Expr/条件查询与 Dependent Ability 绑定；Level 展开输出 condition.predicate/controller-xp，而 static binder 没有该效果的 layer 映射，解释器也没有 PlayerSnapshot.xp 的读取表达式（条件谓词 RIFT-359）。入场替代本身已由 bindReplacement/createEngineStaticBinder 消费 effect.ready 形式，按 143.4/359.2.c/369.3 改写入场状态且不产生 object-readied。程序的 level-active:3 字符串只记录未实现意图，不能当作可执行 XP 条件（expression 会把非空字符串视为真）；整卡保持 judge-required。",
  abilities,
  sourceText: "[Level 3][>] I enter ready. (While you have 3+ XP, get the effect.)"
} satisfies CardProgram;
