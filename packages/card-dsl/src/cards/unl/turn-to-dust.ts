import type { CardProgram } from "../../ir/index.js";

/**
 * Turn to Dust (unl-070-219) — Spell, 2 energy, no printed power, no Might,
 * Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-070-219，逐字）：
 *   "Give a gear [Temporary]. (Kill it at the start of its controller's
 *    Beginning Phase, before scoring.)"
 *
 * 规则依据（CR v1.5）：
 * - 「Give a gear [Temporary]」：把 [Temporary] 关键词授予一个由玩家选择的
 *   装备。「a gear」未特别说明时指 Board 上的对象（355.9.a.1），且由玩家选择
 *   （355.10 的豁免都不适用）→ 目标（355.7 / 355.9）。
 * - 授予关键词属于 ability 图层的持续效果（契约 3.4「关键词授予落在 ability
 *   图层」），不是一次状态改变动作；Temporary 本身的展开（816.1.b：在该永久物
 *   控制者的 Beginning Phase 开始时、计分前消灭它）由关键词注册表负责，卡牌
 *   只声明授予。816.3：是否具有 Temporary 是可读取特征。
 * - 括号内是 Temporary 的释义（816.1.b 的功能等价文本），不是独立指令。
 *
 * status = judge-required（不近似实现）：
 * - 没有卡牌可用的关键词授予原语：已合入代码里唯一的关键词授予形态是卡牌自身
 *   static 能力的 ContinuousEffect（sfd/breakneck-mech、gem-jammer、forecaster
 *   等），正在结算的法术无法创建它；effects/instructions/ 下没有
 *   continuous.grant-keyword / continuous.keyword 文件，也没有原语调用
 *   ctx.addContinuous 来授予关键词（同 cleave / bounty-hunter 的缺口）。
 * - RIFT-265 已合入 effects/keywords/Temporary.ts（816.1.b 的展开），但它只把
 *   已印在宿主上的关键词展开为触发，不提供运行时授予路径。
 * 依赖：duration/关键词授予原语（RIFT-9 清单的 continuous.keyword）。
 */
const turnToDust = {
  canonicalCardId: "card.hash-d499c08d49d46da72e1362f82b24b913abf3b6fbc0e80676cbb858f169d91e75",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺可执行的关键词授予路径：CR 816.3 / 契约 3.4 把「Give a gear [Temporary]」归为 ability 图层的持续关键词授予，" +
    "但已合入代码里唯一的关键词授予形态是卡牌自身 static 能力的 ContinuousEffect（sfd/breakneck-mech、gem-jammer、forecaster），" +
    "正在结算的法术无法创建它；effects/instructions/ 下没有 continuous.grant-keyword / continuous.keyword 原语文件，" +
    "也没有原语调用 ctx.addContinuous 来授予关键词（同 cleave / bounty-hunter 的缺口）。" +
    "RIFT-265 的 effects/keywords/Temporary.ts 只展开已印在宿主上的 816.1.b 触发，不提供运行时授予路径。" +
    "依赖：RIFT-9 清单的 continuous.keyword 关键词授予原语；不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // 未注册 op：关键词授予的意图形状（见 judgeReason）。
          id: "turn-to-dust.grant-temporary",
          op: "continuous.grant-keyword",
          args: { keyword: { kind: "constant", value: "Temporary" } },
          targets: [
            {
              id: "turn-to-dust.gear",
              filter: { zone: "board", type: "gear" },
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
    "Give a gear [Temporary]. (Kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default turnToDust;
