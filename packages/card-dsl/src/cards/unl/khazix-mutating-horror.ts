import type { CardProgram } from "../../ir/index.js";

/**
 * Kha'Zix, Mutating Horror (unl-143-219) — Unit, Chaos, tags Kha'Zix / The Void / Champion。
 * catalog：energy 4、power 1、might 4。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-143-219，逐字）：
 *   [Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)
 *   When I attack or defend, if an enemy unit is alone here, give me +2 :rb_might: this
 *   turn and gain 2 XP.
 *
 * 规则依据（CR v1.5）：
 * - [Ambush]（822.1.a–822.1.d）：被动关键词，功能上等于“可被打到我控制有单位的战场”
 *   （822.1.b/822.1.c 扩展 349 打出流程的合法位置）并在此期间具有 Reaction；822.2 多个实例冗余。
 *   卡内只声明 `{ kind: "keyword", keyword: "ambush" }`，展开归关键词/合法位置管线。
 * - “When I attack or defend”：Attack/Defend Trigger（383.4.e / 383.4.f），时点
 *   attack-declared / defense-declared（timing-points.ts，refs 323.2/383.4.e/383.4.f/466.2.c）。
 * - “if an enemy unit is alone here” 紧跟在触发条件之后，按 383.2.a.1 属于触发条件
 *   （不是效果的一部分，须在触发时判定）。“alone” 按 740.2.a：同位置没有其他友方单位；
 *   “an enemy unit is alone here” 读作“此处恰有一个敌方单位、且它没有友军同伴”，用
 *   count = 1 的条件表达（敌方锚点为 740.1.b，here 为 sameLocationAs: "source"）。
 * - “give me +2 [M] this turn”：带 end-of-turn 期限的临时 Might 修正（143.2.a、479.4 的
 *   算术层、317.2.c 的 “this turn” 到期）。effect.buff 的文件头明确临时 Might 修改归 layers 的
 *   continuous.might，不是 Buff 计数器（702/703）。
 * - “and gain 2 XP”：effect.xp 已合入（730.1/733），与前面是同一从句里的两个独立动作
 *   （359.3.e.14.c），互不链接。
 *
 * status = judge-required（缺口不近似实现）：
 * - “give me +2 [M] this turn” 没有可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改
 *   动作，effects/instructions/ 下没有可注册的 continuous.might 原语（ctx.addContinuous 目前没有
 *   卡牌指令消费者），也没有把该持续效果注册进 layers 的入口（RIFT-91）；写成 Buff counter 会
 *   变成另一种游戏对象（702.3/703）。
 * - attack-declared / defense-declared 在已合入代码里没有发射方（combat/ 尚未接入事件管线，
 *   同 rad/ezreal-dashing、sfd/lucian-gunslinger 的记录），触发无法在真实内核里被订阅。
 * - [Ambush] 的展开（合法打出位置 + Reaction 许可改写）没有已合入实现（rad/evelynn-consuming
 *   记录同一缺口）。
 * 已合入且被 golden 真实执行的是 “gain 2 XP” 那半句：effect.xp 通过解释器 + 参考内核真实增加 2 XP。
 *
 * 依赖：RIFT-91（layers 的 continuous.might 接线）、RIFT-33/RIFT-120（战斗时点发射与卡牌触发
 * 注册）、关键词批次（Ambush 展开）。
 */
export default {
  canonicalCardId:
    "card.hash-6080c717cf342299d6073468f9de4f808e7a244d4edd6bbe1ec9d6a519127a24",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入：(1) 「give me +2 :rb_might: this turn」是带 end-of-turn 期限的临时 Might 修正，" +
    "属 layers 的 continuous.might：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ " +
    "下没有已注册的 continuous.might 原语，也没有把卡牌程序注册进 layers（RIFT-91）的入口——写成 effect.buff " +
    "会变成 702.3/703 的 Buff 计数器（另一种游戏对象），故不近似。" +
    "(2) attack-declared / defense-declared（383.4.e/383.4.f）在已合入代码里没有发射方：combat/ 未接入事件管线，" +
    "触发无法被真实订阅（同 rad/ezreal-dashing、sfd/lucian-gunslinger 的记录）。" +
    "(3) [Ambush]（822.1.b/822.1.c 的合法位置与 Reaction 许可改写）没有已合入展开（同 rad/evelynn-consuming 的记录）。" +
    "触发条件「if an enemy unit is alone here」按 383.2.a.1 / 740.2.a 保留在 TriggerSpec.condition。" +
    "已合入且由 golden 真实执行的是 “gain 2 XP”（effect.xp，730.1）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "ambush" },
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } },
        // 383.2.a.1：“if an enemy unit is alone here” 紧跟在触发条件之后，属于触发条件本身。
        // 740.2.a：alone = 同位置没有其他友方单位（此处敌方单位在场上无同伴）；
        // “here” = 来源当前位置（359.3.f），用 sameLocationAs 锚点。
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "alone-enemy-units-here",
            filter: {
              type: "unit",
              controller: "opponent",
              sameLocationAs: "source"
            }
          },
          operator: "eq",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "khazix-mutating-horror.grant-might",
          // “give me +2 [M] this turn”——143.2.a / 479.4 的算术层临时修正，期限到本回合末
          // （317.2.c）。该 op 没有已注册实现（见 judgeReason），不改为 Buff counter。
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            // “me” 是能力宿主：用符号选择器 "self"，不伪造目标（355.10.d）。
            object: { kind: "constant", value: "self" }
          }
        },
        {
          id: "khazix-mutating-horror.gain-xp",
          // “and gain 2 XP” 与前一动作独立（359.3.e.14.c），不链接。
          op: "effect.xp",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    },
    {
      kind: "triggered",
      trigger: {
        at: "defense-declared",
        filter: { event: "defense-declared", filter: { source: "self" } },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "alone-enemy-units-here",
            filter: {
              type: "unit",
              controller: "opponent",
              sameLocationAs: "source"
            }
          },
          operator: "eq",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "khazix-mutating-horror.defend-grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            object: { kind: "constant", value: "self" }
          }
        },
        {
          id: "khazix-mutating-horror.defend-gain-xp",
          op: "effect.xp",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When I attack or defend, if an enemy unit is alone here, give me +2 :rb_might: this turn and gain 2 XP."
} satisfies CardProgram;
