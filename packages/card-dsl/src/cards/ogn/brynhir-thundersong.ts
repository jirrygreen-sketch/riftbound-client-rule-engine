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
 * - Chain Execute 已消费持续禁止，但 controller:opponent 相对于待打出牌的控制者
 *   求值，没有锚定触发来源的控制者；play-card 也被用于启动能力，且 Finalize 未重验。
 * 依赖：来源相对玩家过滤、打出/启动区分与 Finalize 重验。
 */
const brynhirThundersong = {
  canonicalCardId: "card.hash-c3d99cfdb7043f9a6d4f6898cda1e76169b34bfb8ba341d7b4189ff2c78fc63d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.restrict 的 play-card 禁止缺来源相对玩家过滤：appliesTo.controller:'opponent' " +
    "仍相对于待打出牌的 draft.controller 求值，缺相对于 Brynhir 触发控制者的锚定（CR 191.5.a/b、420.4.a）。" +
    "actionIsRestricted 还把 play-card 应用于 activated，需区分打牌与启动能力（400、402–407）；" +
    "canAct/Finalize 未重验该持续禁止。依赖：来源相对玩家过滤、打出专用消费与 Finalize 合法性重验。",
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
