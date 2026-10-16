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
 *   禁止，属持续限制（RIFT-9 原语清单第 27 项 continuous.restrict，依赖
 *   condition.predicate）。
 * - 356 / 357：被禁止的打出无法完成费用与合法性检查（Finalize 阶段），但本卡只声明
 *   限制本身，不推进优先权、不代替 chain/ 的 canAct 查询。
 * - 时限："this turn" 是本回合到期的持续期限（317 结束步骤 / 318 清理时点），由
 *   时点与图层到期机制处理，不在卡内推进回合。
 *
 * 结构说明（本卡标记 judge-required，见下）:
 * - 单个 triggered 能力（card-played，filter 指向自身、玩家为控制者，强制），
 *   body 只有一条 continuous.restrict 指令：operation "play"、forbidden: true、
 *   对象为对手玩家、duration "end-of-turn"。
 *
 * 未合入依赖（不近似实现）:
 * - 没有 continuous.restrict 指令原语（effects/instructions/ 只有 effect.* 文件），
 *   因此 body 不可执行；chain/ 的 canAct(player, speed) 查询与 Finalize 也没有读取
 *   持续禁止集合的消费方（layers（RIFT-91）只计算特征，不决定许可）。
 * - 本回合到期的持续期限需要 continuous.duration / 时点驱动的到期（RIFT-91 的
 *   addContinuous + duration），接线尚未接通。
 * 依赖：RIFT-9（continuous.restrict）、RIFT-91、RIFT-120。
 */
const brynhirThundersong = {
  canonicalCardId: "card.hash-c3d99cfdb7043f9a6d4f6898cda1e76169b34bfb8ba341d7b4189ff2c78fc63d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『opponents can't play cards this turn』是持续限制（CR 400/402–407 的打出许可）：缺 continuous.restrict 指令原语" +
    "（RIFT-9 清单第 27 项，effects/instructions/ 只有 effect.* 文件），chain/ 的 canAct 与 Finalize 也没有读取持续禁止集合的消费方；" +
    "『this turn』的到期还需要 continuous.duration 与时点驱动（RIFT-91 接线）。触发时点 card-played（420.4.a）已定义。" +
    "依赖：RIFT-9（continuous.restrict）、RIFT-91、RIFT-120。不近似实现。",
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
            operation: { kind: "constant", value: "play" },
            forbidden: { kind: "constant", value: true },
            player: { kind: "constant", value: "opponent" },
            duration: { kind: "constant", value: "end-of-turn" }
          }
        }
      ]
    }
  ],
  sourceText: "When you play me, opponents can't play cards this turn."
} satisfies CardProgram;

export default brynhirThundersong;
