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
 *   135.2.d.3 无游戏功能，本文件不另行实现。830.1.b 的展开（可打到任意战场 / 只能打到战场 /
 *   非单位 Gear 清理不召回 / 对手在此固守时消灭）属于 `effects/keywords/deploy.ts`，尚未合入。
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
 * 缺口（不近似实现，故 judge-required）：
 * - `cost.pay` 指令未合入：`effects/instructions/` 下没有任何 `cost.*` 文件；RIFT-9 清单的
 *   cost.pay（支付能量 / 指定域或通用 Power）与费用计划批次 RIFT-89 均未落地，1 能量无法支付；
 * - `deploy` 关键词展开未合入（关键词批次 RIFT-81~88 / RIFT-91 不含 Deploy）。
 *
 * 可执行部分：token 的链上生成 + 打出（`effect.token` mode "play"）由 golden 用参考内核真实执行；
 * `cost.pay`、Deploy 展开以 `test.todo` 标注依赖。
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
              args: { energy: { kind: "constant", value: 1 } }
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
  trigger: { at: "conquer", filter: { event: "conquer", here: true, player: "controller" } },
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
              args: { energy: { kind: "constant", value: 1 } }
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
    "缺 cost.pay 指令原语：effects/instructions/ 下没有 cost.* 文件，RIFT-9 清单的 cost.pay" +
    "（支付能量 / 指定域或通用 Power）与费用计划批次 RIFT-89 未合入，故 “you may pay " +
    ":rb_energy_1: to ... ” 无法支付；另 [Deploy]（830.1.b：可打到任意战场、只能打到战场、" +
    "非单位 Gear 清理不召回、对手在此固守时消灭）的关键词展开未合入（关键词批次 RIFT-81~88 / " +
    "RIFT-91 不含 Deploy）。token 生成 + 打完链路（effect.token mode \"play\"，440.2.c/185.2.a）" +
    "已可执行并有测试；不近似实现。",
  abilities: [{ kind: "keyword", keyword: "deploy" }, playAbility, conquerAbility],
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this or when you conquer here, you may pay :rb_energy_1: to play a 1 :rb_might: Recruit unit token to your base."
} satisfies CardProgram;

export default program;
