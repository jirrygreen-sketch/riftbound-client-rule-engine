import type { CardProgram } from "../../ir/index.js";

/**
 * Horns of the Dragon (ven-118-166) — Unit, Order, tag Ionia.
 * 6 Energy, no printed Power (`power: null`，不是 0), Might 6.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-118-166，逐字）：
 *   [Tank] (I must be assigned combat damage first.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 815.1：Tank 是被动能力关键词（Passive Ability keyword），出现在单位上。
 * - 815.1.b：功能上等于「战斗伤害步骤中，我必须比同一控制者下没有 [Tank] 的
 *   单位更早被分配致命伤害」。
 * - 815.1.c / 815.1.c.1 / 815.1.c.2：它改写玩家分配战斗伤害的方式；仍必须先给
 *   一个单位分配致命伤害才能继续，且在同控制者下所有 Tank 单位被分配致命伤害
 *   之前，没有 Tank 的单位不是合法分配目标（多条 Tank 之间可任选）。
 * - 815.2：多重实例冗余；815.3：「是否拥有 Tank」是可被引用的单位特征。
 * - 按契约 3.1/3.7 与 README 第 5 节，本卡只声明关键词身份
 *   （`{ kind: "keyword", keyword: "tank" }`，Tank 无数值），关键词展开与战斗
 *   伤害分配属于 effects/keywords/Tank.ts 与 combat/，卡文件不写单卡结算逻辑，
 *   也不重写一条自己的分配顺序。
 *
 * status 判定（README 第 2 节）：judge-required。
 * Tank 的 KeywordDef 已合入（effects/keywords/Tank.ts；展开为
 * static `continuous.combat`，priority "first"），但两层消费方都还没有合入：
 * 1. 战斗伤害分配：combat/base-combat-allocation.ts 明确写着 "No Tank/Backline/
 *    other assignment-priority requirement is bound here"，815.1.b /
 *    815.1.c.2 的「先分配致命伤害」无法落地；
 * 2. 关键词接线：CardProgram 的 keyword 能力由已合入的 expandProgram 解析
 *    （expandProgram → KeywordDef.expand 已可执行，golden 直接验证），但展开出的
 *    static `continuous.combat` 既没有 layers 分支（layers/engine.ts 只处理
 *    copy/trait/ability/arithmetic，continuous.combat 无对应 apply 分支），
 *    continuous.combat 指令原语本身在当前契约下也保持 blocked（无 combat consumer
 *    时返回 negated/impossible，不写假注册）。
 * Tank 的全部功能就是这条分配强制，缺它就等于缺整张卡，因此不标 executable；
 * 不把分配顺序近似成 Might 数值修正，也不手改战斗流程。
 * 依赖：战斗工作流（`continuous.combat` 消费方，含 467.2.c.6–c.9 的指派顺序）
 * 与关键词展开进图层的消费方。
 */
export default {
  canonicalCardId: "card.hash-9e6cf771d3c68dc759e26aa3068eb3f3f2873734ee60fe6d8df8ef5a2ac46dbe",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Tank]（815）的 KeywordDef 已合入（effects/keywords/Tank.ts，展开为 static continuous.combat、" +
    "priority \"first\"），已合入的 expandProgram 也能把卡牌关键词展开成该 static 能力（golden 已验证）；" +
    "但 815.1.b / 815.1.c.2（467.2.c.6–c.9 的指派顺序）仍无消费方：" +
    "combat/base-combat-allocation.ts 明确注释 \"No Tank/Backline/other assignment-priority requirement is " +
    "bound here\"，layers/engine.ts 没有 continuous.combat 分支，continuous.combat 指令原语本身也保持 " +
    "blocked（无 combat consumer 时返回 negated/impossible）。Tank 的全部功能就是这条分配强制，缺它即缺整张卡；" +
    "依赖战斗工作流（continuous.combat 消费方）。不近似实现（不改写成 Might 修正，也不手改伤害分配流程）。",
  abilities: [{ kind: "keyword", keyword: "tank" }],
  sourceText: "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;
