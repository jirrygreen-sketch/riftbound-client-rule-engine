import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Bandle Soldier — CR v1.5 824.1 (Level 3), 369.3/143.4/359.2.c
 * (enter ready). 入场状态改写已可执行，Level 的控制者 XP 条件仍不可求值。
 * condition 保留契约中的 controller-xp 查询形状；该查询目前仍没有玩家 XP
 * 求值方，不能作为执行证据（真正的 level-active 谓词由 Level KeywordDef 发布，
 * 其消费方仍缺）。
 */
const levelCondition = {
  kind: "compare",
  left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
  operator: "gte",
  right: { kind: "constant", value: 3 }
} as const;

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
    // 824.1.c：保留控制者 XP 门槛的 IR 形状；解释器当前不读取 PlayerSnapshot.xp。
    condition: levelCondition,
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
    "Condition 的现有分支都不读玩家 XP，Level 展开里的 query: \"controller-xp\" 无求值方；本卡 replacement.condition 保留同一查询形状，不能把对象数量当 XP。" +
    "入场替代本身已可执行：bindReplacement/createEngineStaticBinder 消费 effect.ready 形式，按 143.4/359.2.c/369.3 改写入场状态且不产生 object-readied" +
    "（golden 用生产 binder 实证）。replacement/bind.ts 的 matchesEnterAction 还跳过 ability.condition，" +
    "RIFT-700 模板以原文要求断言 0 XP 时横置入场并保留失败 TODO，3 XP 的入场证据不能证明 Level 已接线。" +
    "整卡保持 judge-required。契约变更请求：可读取实时控制者 PlayerSnapshot.xp 的条件与 Dependent Ability 绑定；" +
    "依赖 RIFT-268/258/259 的后续接线及 RIFT-260 入场条件求值。",
  abilities,
  sourceText: "[Level 3][>] I enter ready. (While you have 3+ XP, get the effect.)"
} satisfies CardProgram;
