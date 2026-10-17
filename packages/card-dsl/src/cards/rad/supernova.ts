import type { CardProgram } from "../../ir/index.js";

/**
 * rad-059-167 Supernova（本地目录：能量 9、Power 1、领域 Order）。
 *
 * 原文："Deal 10 to a unit. Draw 2."
 *
 * ⚠ 数据问题（不改数据，随任务回复上报）：本地 deck-catalog 把本印刷记为
 *   cardType "Unit" 且 might null，但同源官方图（catalog.json 里本 printing 的
 *   imageUrl）印的是 SPELL。RAD 里 8 张卡都是这个形态（rad-012/025/035/039/
 *   059/087/108/136 记 Unit，官方图分别是 Gear/Spell/Gear/Spell/Spell/Gear/
 *   Gear/Gear），属目录侧系统性问题。
 *
 * 规则依据（CR v1.5）：
 * - 法术的这段文本是打出后按链结算的效果；程序用 play 能力承载
 *   （对照已合入的 ogn/vengeance、ogn/singularity）。
 * - "a unit" 是目标（355.7 / 355.10.a）：TargetSpec 写在 instruction 上，
 *   结算时由解释器重验；目标全部失效 → ignored（359.3.e.7）。
 * - "Deal 10" 是 effect.damage（418.1.c：每个仍合法目标一条伤害动作）。
 * - "Draw 2" 是 effect.draw（414.3）；player 省略即能力控制者（190.6.d）。
 *
 * 状态：judge-required（2026-10-17 复核）。原"法术整卡走链的费用/结算接入仍属协调任务"
 *   的说法已过时：programs/play.ts 的 describePlay 与 chain/engine.ts 的 Finalize/Resolve
 *   已能把本程序的 play 能力打成真实链项并结算（golden 用 createProgramBinding +
 *   ChainEngine 经 describePlay 打出 9 Energy / 1 Order、对锁定单位造成 10 点伤害并抽 2 张）。
 *   剩余唯一缺口是本印刷的 cardType 冲突：本地 deck-catalog 记 cardType "Unit"、might null，
 *   而同源官方图印的是 SPELL；cardType 决定这段裸效果文本是法术的 play 能力（420.1）
 *   还是永久物的打出效果（383.4.a），生产 host 按目录类型构造 source，改类型会改变
 *   这张牌是否进入 Board。目录修正属卡牌数据任务，不在本任务写范围内，因此不近似实现、不改数据。
 */
export default {
  canonicalCardId:
    "card.hash-0e5a4bfb603171bb0504c082d28e606b5fb0050252aed40f969d0c88f58839b4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "本地目录把本印刷记为 Unit 且 might=null，但同源官方图印的是 Spell（RAD 里 rad-012/025/035/039/059/087/108/136 八张同属此类）；" +
    "cardType 决定这句裸效果文本是法术的 play 能力（420.1）还是单位的打出触发（383.4.a），在目录修正前不宣称整卡可执行。" +
    "效果本身与原语、生产绑定均不缺：effect.damage 与 effect.draw 已合入，golden 已用测试内核分别真实执行，" +
    "并用 createProgramBinding + ChainEngine 经 describePlay 打出：9 Energy/1 Order 的费用计划建成、" +
    "锁定单位受到 10 点伤害、控制者抽 2 张、法术离链入 Trash。唯一缺口是上述目录类型冲突。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 9 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "supernova.deal-10",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 10 },
            target: { kind: "constant", value: "supernova.target-unit" }
          },
          targets: [
            {
              id: "supernova.target-unit",
              filter: { type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Draw 2" 与伤害是两条独立指令：伤害被替代/不可能不影响抽牌（359.3.e.11）。
          id: "supernova.draw-2",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText: "Deal 10 to a unit. Draw 2."
} satisfies CardProgram;
