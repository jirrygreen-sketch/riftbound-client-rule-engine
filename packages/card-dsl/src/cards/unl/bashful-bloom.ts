import type { CardProgram } from "../../ir/index.js";

/**
 * Bashful Bloom — CR v1.5 404.1.a/415.5 (4 Energy + exhaust),
 * 187.2/816 (Sprite with Temporary), 184.1 (ready entry),
 * 404.2/404.3 (variable activation discount). cost.pay/cost.modify and
 * Temporary are merged; token definition, entry override, live discount
 * and controller-relative Base remain incomplete.
 */
export default {
  canonicalCardId:
    "card.hash-7c38c7fbf3d002c5be05a68b52e8d74195df7d791f974e04b64a12b0a010fb46",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5）：(1) effect.token 定义表仍缺 187.2 的 3 Might、无域、Fae、Temporary 的 sprite；Temporary KeywordDef 本身已存在。(2) effect.token/create-token 不接收 143.4/184.1/185.2.d 的 ready 入场状态改写；不能先横置进场再 ready。(3) 404.2/404.3 的「每个带 Temporary 的友方单位少 1 Energy」仍缺关键词特征过滤计数，以及 programs/activate.ts 把该变量折扣接入 Finalize discounts 的路径；cost.modify/cost.pay 本体已合入，不能在结算时再收费替代启动费用。(4) location 中 player:controller 是未解析的描述值，effect.token 只接受实际 PlayerId/LocationRef，缺能力控制者 Base 的相对位置求值（RIFT-357）。",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 4 },
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          id: "bashful-bloom.play-sprite",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "sprite" },
            amount: { kind: "constant", value: 1 },
            // 187.2 / 440.2.c：“Play … token” 需要链上创建再打出；合并内核的
            // mode "play" 已支持链上创建与打出；Sprite 定义仍缺。
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            linkKey: { kind: "constant", value: "spriteToken" }
            // 184.1 的入场状态改写（“ready”）：create-token 尚不支持
            // （见 judgeReason）。不新增 IR 参数键，也不会先创建再补一次
            // “成为就绪”的效应。
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_energy_4:, :rb_exhaust:: Play a ready 3 :rb_might: Sprite unit token with [Temporary]. " +
    "This ability costs :rb_energy_1: less for each friendly unit with [Temporary]."
} satisfies CardProgram;
