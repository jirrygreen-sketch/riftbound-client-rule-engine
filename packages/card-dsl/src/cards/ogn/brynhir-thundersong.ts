import type { CardProgram } from "../../ir/index.js";

/**
 * Brynhir Thundersong (ogn-026-298) — Unit, Fury, Freljord, energy 6, Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-026-298，逐字）:
 *   "When you play me, opponents can't play cards this turn."
 *
 * 规则依据（Core Rules v1.5）:
 * - 420.4.a："When you play me" 在打出动作完成时触发；对应时点 card-played
 *   （events/timing-points.ts，ruleRefs 359/383.4.a/407）。
 * - 400 / 402–407：打出与启动能力走同一流程；"can't play cards" 是对对手打出许可的
 *   禁止，属持续限制，用已合入的 continuous.restrict 原语声明。
 * - 356 / 357：被禁止的打出无法完成费用与合法性检查（Finalize 阶段），但本卡只声明
 *   限制本身，不推进优先权、不代替 chain/ 的 canAct 查询。
 * - 时限："this turn" 是本回合到期的持续期限（317 结束步骤 / 318 清理时点），由
 *   时点与图层到期机制处理，不在卡内推进回合。
 *
 * 结构说明（本卡标记 judge-required，见下）:
 * - 单个 triggered 能力（card-played，filter 指向自身、玩家为控制者，强制），
 *   body 只有一条 continuous.restrict 指令：mode "prohibit"、action "play-card"、
 *   appliesTo 对手玩家、duration "this-turn"（原语映射为 end-of-turn 到期）。
 *
 * 未合入依赖（不近似实现）:
 * - continuous.restrict 原语与 layers/rules 查询已合入（本卡测试真实执行并验证对手
 *   过滤、到期），但 chain 的 canAct / Finalize 都没有读取持续禁止集合，禁止不会
 *   实际拦下打出。
 * - 卡牌程序绑定层未合入（RIFT-257）：触发体不会被生产路径注册执行；该层落地后
 *   才谈得上链的许可消费。
 * 依赖：RIFT-257（卡牌程序绑定）与 chain 的持续禁止许可消费。
 */
const brynhirThundersong = {
  canonicalCardId: "card.hash-c3d99cfdb7043f9a6d4f6898cda1e76169b34bfb8ba341d7b4189ff2c78fc63d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『opponents can't play cards this turn』是持续限制（CR 400/402–407 的打出许可）：continuous.restrict 原语已合入" +
    "（RIFT-259，本卡测试真实执行并验证对手过滤与回合结束到期），但 chain 的 canAct 与 Finalize 都没有读取持续禁止集合的消费方，" +
    "禁止不会实际拦下对手的打出；同时缺卡牌程序绑定层（RIFT-257），该触发体在生产路径不会被注册执行。" +
    "触发时点 card-played（420.4.a）已定义。依赖：RIFT-257 卡牌程序绑定与 chain 的持续禁止许可消费。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self", player: "controller" } }
      },
      optional: false,
      body: [
        {
          id: "brynhir-thundersong.forbid-play",
          op: "continuous.restrict",
          args: {
            mode: { kind: "constant", value: "prohibit" },
            action: { kind: "constant", value: "play-card" },
            appliesTo: { kind: "constant", value: { controller: "opponent" } },
            duration: { kind: "constant", value: "this-turn" }
          }
        }
      ]
    }
  ],
  sourceText: "When you play me, opponents can't play cards this turn."
} satisfies CardProgram;

export default brynhirThundersong;
