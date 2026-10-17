import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Bandle Soldier — CR v1.5 824.1 (Level 3), 369.3/143.4/359.2.c
 * (enter ready). 入场替代已可执行，Level 的控制者 XP 条件仍不可求值。
 * level-active:3 是描述性占位，非空字符串不能作为该条件的执行证据，因此本卡
 * 文件里的 condition 不是可执行 XP 门槛（真正的 level-active 谓词由 Level
 * KeywordDef 发布，其消费方仍缺）。
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
    // 描述性占位：expression 把非空字符串视为真，所以该字段不能代表 824.1.c 的
    // 生效条件；它只是作者侧记录。整卡保持 judge-required（见 judgeReason）。
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
    "当前缺口（CR v1.5 824.1.b.1/824.1.c/824.1.c.1/824.1.d）：[Level 3][>] 仍缺控制者 XP 的求值路径与 Dependent Ability 绑定。" +
    "Level KeywordDef（已合入）展开出 condition.predicate/predicate level-active/query controller-xp 的 static 能力，" +
    "但该形状仍没有消费方：(1) createEngineStaticBinder 的 layerFor 没有 condition.predicate 映射" +
    "（实测抛 Static ability kind condition.predicate has no layer mapping），依赖能力根本无法注册；" +
    "(2) 解释器表达式集合也没有读取 PlayerSnapshot.xp 的形态（object-property/object-attribute 只读对象快照，" +
    "RIFT-359 扩充的是 played-from-hand / event-printed / result 谓词，不含玩家 XP），" +
    "Condition 的现有分支都不读玩家 XP，Level 展开里的 query: \"controller-xp\" 无求值方。" +
    "入场替代本身已可执行：bindReplacement/createEngineStaticBinder 消费 effect.ready 形式，按 143.4/359.2.c/369.3 改写入场状态且不产生 object-readied" +
    "（golden 用生产 binder 实证）。程序的 level-active:3 字符串只记录未实现意图，不能当作可执行 XP 条件" +
    "（expression 会把非空字符串视为真）；整卡保持 judge-required。依赖：condition.predicate 的图层映射与 controller-xp 谓词求值。",
  abilities,
  sourceText: "[Level 3][>] I enter ready. (While you have 3+ XP, get the effect.)"
} satisfies CardProgram;
