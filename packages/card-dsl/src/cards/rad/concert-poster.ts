import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Concert Poster (rad-116-167) — Gear, 1 Energy, power null, Order, Device.
 *
 * Printed text:
 *   [Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)
 *   When you play this or when you conquer here, you may pay :rb_energy_1: to play a
 *   1 :rb_might: Recruit unit token to your base.
 *
 * 规则依据（CR v1.5）：
 * - `[Deploy]`（830.1 / 830.1.a / 830.1.b）：只声明关键词身份。括号内是提示文本，按
 *   135.2.d.3 无游戏功能，本文件不另行实现。830.1.b 的展开属于
 *   `effects/keywords/Deploy.ts`（已合入，RIFT-267）；卡牌只声明、不自行展开
 *   （cards/README §5）。
 * - “When you play this”：card-played 时点（383.4.a / 407）；自指触发用 `self: true` 过滤
 *   （与已合入 sfd royal-guard / unsung-hero 同一自指约定）。
 * - “when you conquer here”：conquer 时点（468.5.d / 471.1 / 473.2.a）；`here` 绑定该次征服的
 *   战场位置，`player: "controller"` 表示“你（能力控制者）”征服。原文的 “or” 是两个触发条件
 *   共用同一效果，故写成两个 triggered ability（TriggerSpec 只有单个 `at`）。
 * - “you may pay :rb_energy_1: to play a 1 :rb_might: Recruit unit token to your base”：
 *   按契约 3.9 用 `choice.optional` 把被选指令包进 `body`：先 `cost.pay` 支付 1 能量，再按
 *   440.2.c / 185.2.a / 350.2 / 354 在链上生成 token 并完成打出（`effect.token` mode "play"）。
 *   Recruit = CR 187.1 的 1 Might 单位 token（定义表 id "recruit"）；token 无印刷费用（185.3）。
 *
 * 复核（2026-10-17 第二轮复核）：
 * - `[Deploy]` 的 KeywordDef 已合入（effects/keywords/Deploy.ts，RIFT-267），但其
 *   `continuous.location`、清理豁免和带 `here` 的 Hold 触发仍没有可执行消费方。
 * - `cost.pay` 已合入，使用 `payments: { energy: 1 }` 的支付计划形状；golden 覆盖真实扣除
 *   能量后再生成并打出 Recruit token。
 *
 * 可执行部分：支付、token 的链上生成与打出（`effect.token` mode "play"）由 golden 用参考内核
 * 真实执行；整卡仍因 Deploy 的地点/`here` 消费方而保持 judge-required。
 */
const playAbility: Ability = {
  kind: "triggered",
  trigger: { at: "card-played", filter: { event: "card-played", self: true } },
  optional: true,
  body: [
    {
      id: "concert-poster.play-opt-in",
      op: "choice.optional",
      args: {
        prompt: {
          kind: "constant",
          value: "Pay 1 energy to play a 1 Might Recruit unit token to your base?"
        },
        body: {
          kind: "constant",
          value: [
            {
              id: "concert-poster.play-pay",
              op: "cost.pay",
              args: { payments: { kind: "constant", value: { energy: 1 } } }
            },
            {
              id: "concert-poster.play-recruit",
              op: "effect.token",
              linkedTo: "concert-poster.play-pay",
              args: {
                token: { kind: "constant", value: "recruit" },
                amount: { kind: "constant", value: 1 },
                mode: { kind: "constant", value: "play" },
                location: { kind: "constant", value: { type: "base", player: "controller" } },
                linkKey: { kind: "constant", value: "recruit" }
              }
            }
          ]
        }
      }
    }
  ]
};

const conquerAbility: Ability = {
  kind: "triggered",
  trigger: { at: "conquer", filter: { event: "conquered", here: true, player: "controller" } },
  optional: true,
  body: [
    {
      id: "concert-poster.conquer-opt-in",
      op: "choice.optional",
      args: {
        prompt: {
          kind: "constant",
          value: "Pay 1 energy to play a 1 Might Recruit unit token to your base?"
        },
        body: {
          kind: "constant",
          value: [
            {
              id: "concert-poster.conquer-pay",
              op: "cost.pay",
              args: { payments: { kind: "constant", value: { energy: 1 } } }
            },
            {
              id: "concert-poster.conquer-recruit",
              op: "effect.token",
              linkedTo: "concert-poster.conquer-pay",
              args: {
                token: { kind: "constant", value: "recruit" },
                amount: { kind: "constant", value: 1 },
                mode: { kind: "constant", value: "play" },
                location: { kind: "constant", value: { type: "base", player: "controller" } },
                linkKey: { kind: "constant", value: "recruit" }
              }
            }
          ]
        }
      }
    }
  ]
};

const program = {
  canonicalCardId: "card.hash-03f357977584ddf7e53bbe67b5c7b5c02cdcafe1cf40d289953589949e85d0d4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "cost.pay 已合入并可按 payments 计划真实支付 1 能量，token 生成 + 打出链路也有执行证据；" +
    "整卡仍缺 Deploy 的可执行消费方：continuous.location 的任意战场/只能打到战场限制、" +
    "非单位 Gear 清理豁免，以及带 here 锚点的 Hold 触发都无法由当前地点与事件模式求值（CR 830.1.b）。" +
    "本卡的 conquer 触发同样保留 here 锚点。依赖：RIFT-357 地点选择/地点锚点；不近似实现。",
  abilities: [{ kind: "keyword", keyword: "deploy" }, playAbility, conquerAbility],
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this or when you conquer here, you may pay :rb_energy_1: to play a 1 :rb_might: Recruit unit token to your base."
} satisfies CardProgram;

export default program;
