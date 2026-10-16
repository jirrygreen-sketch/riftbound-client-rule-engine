import type { CardProgram } from "../../ir/index.js";

/**
 * Eye of Twilight (ven-147-166) — Legend, Calm/Order, tag Shen.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-147-166，逐字）：
 *   [Action][>] :rb_exhaust:: Give a friendly unit [Tank] this turn. (It must be
 *   assigned combat damage first.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 806.1.d / 135.2.e.7.b：[Action][>] 是修饰其后启动能力的许可关键词；契约 3.1 用
 *   activated.timing = "action" 记录（与 RIFT-238 的 Defender of Tomorrow 同写法）。
 * - 204.1.b / 415.5：「:」前的 :rb_exhaust: 是启动能力的 Base Cost（Exhaust 此来源）；
 *   合并费用管线支持 payments: [{ kind: "exhaust", object: "self" }]（RIFT-89）。
 * - 355.9 / 355.10：「a friendly unit」的单个对象是被选目标，结算时若失效则 ignored
 *   （359.3.e.7）。
 * - 815 / 815.1 / 815.1.b / 815.3：[Tank] 是被动能力关键词，功能等价于「战斗伤害步骤中，
 *   必须先给我分配致命伤害，之后才能给同一控制者的其它无 [Tank] 单位分配伤害」；它是单位
 *   的可引用特征。本卡的授予带 “this turn” 期限（回合结束到期）。
 *
 * status = judge-required（三处缺口均不近似实现）：
 * 1. 缺 Tank 关键词定义：effects/keywords/ 的已合入批次（RIFT-81~88）不含 Tank，
 *    keywords/registry.generated.ts 没有该展开；按 README 第 5 节本卡只声明关键词身份，
 *    不手写展开。
 * 2. 「give … [Tank] this turn」是带 end-of-turn 期限的关键词授予，需要卡牌侧的
 *    continuous.grant-keyword 指令原语；effects/instructions 没有该 op（RIFT-91 只合入了
 *    图层引擎 LayerEngine / ContinuousEffectSpec，卡牌侧入口缺失）——与 sfd-007-221
 *    Gem Jammer、sfd-062-221 Bubble Bot、venue-153-166 Matriarch of War 同一缺口。
 *    程序里以描述性 op 记录该授予意图，并在 golden 里断言它是未注册原语。
 * 3. Tank 的战斗含义落在战斗伤害分配（815.1.b / 815.1.c.2）：combat/ 目前只证明「无
 *    assignment modifier」的窄路径（base-combat-allocation.ts 的
 *    DuelBaseCombatSourceEffectProof.keywordPriority: "proven-none"），没有 [Tank]
 *    的分配优先级实现，因此即使授予落地也不能宣称整卡可执行。
 * 依赖：新增 Tank KeywordDef、continuous.grant-keyword 指令原语（RIFT-91）、
 * combat/ 的分配优先级实现；费用与 effect.exhaust 本体已合入，golden 用真实费用计划 +
 * 真实解释器执行「3 能量…」以外的费用与横置部分（见测试说明）。
 */
const eyeOfTwilight = {
  canonicalCardId: "card.hash-58b622a816049405488a25adae394668eeed8847e5a9ff884d3f09ce03886a4d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) 缺 Tank KeywordDef——effects/keywords/ 的已合入批次（RIFT-81~88）不含 Tank，" +
    "keywords/registry.generated.ts 没有其展开（CR 815.1.b/815.3）。 " +
    "(2) “Give a friendly unit [Tank] this turn” 需要带 end-of-turn 期限的关键词授予指令原语 " +
    "continuous.grant-keyword，effects/instructions 没有该 op（RIFT-91 只合入图层引擎，" +
    "卡牌侧入口缺失；与 Gem Jammer / Bubble Bot / Matriarch of War 同一缺口），程序里以描述性 op 记录。 " +
    "(3) Tank 的战斗语义（815.1.b / 815.1.c.2 的伤害分配优先级）在 combat/ 未实现——" +
    "base-combat-allocation.ts 只证明 “无 assignment modifier” 的窄路径（keywordPriority: \"proven-none\"）。 " +
    "依赖新增 Tank KeywordDef、continuous.grant-keyword 指令原语（RIFT-91）与 combat/ 分配优先级；" +
    "effect.exhaust 本体与 Exhaust 费用已合入，golden 用真实费用计划与解释器执行该部分。不近似实现。",
  abilities: [
    {
      kind: "activated",
      // [Action][>]：能力级许可关键词（806.1.d），按契约 3.1 记在 activated.timing。
      timing: "action",
      cost: {
        kind: "activated",
        // :rb_exhaust: = Exhaust 此来源（204.1.b、415.5）。本卡没有印刷 Energy / Power 费用。
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          id: "eye-of-twilight.grant-tank",
          // 「Give a friendly unit [Tank] this turn」：带 end-of-turn 期限的关键词授予。
          // 该 op 未注册（emphasized in judgeReason 第 2 条）；把授予写成 data 以便审查，
          // 不手写一套 Tank 逻辑（README 第 5 节）。
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Tank" },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "eye-of-twilight.unit" }
          },
          targets: [
            {
              id: "eye-of-twilight.unit",
              // “a friendly unit”：单个由你控制的单位（355.9/355.10；359.3.e.7）。
              filter: { type: "unit", zone: "board", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action][>] :rb_exhaust:: Give a friendly unit [Tank] this turn. " +
    "(It must be assigned combat damage first.)"
} satisfies CardProgram;

export default eyeOfTwilight;
