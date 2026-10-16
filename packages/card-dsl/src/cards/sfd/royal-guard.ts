import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Royal Guard (sfd-157-221, fiora-sfd M1 卡组).
 *
 * 原文："When you play me, play a 2 :rb_might: Sand Soldier unit token here."
 *
 * 规则依据（CR v1.5）：
 * - "When you play me"：打出触发（时点 card-played；420.4.a 在打出完成后触发）。
 * - "play a … token"：v1.5 440.2.c / 185.2.a 规定被"打出"的 token 先在链上生成
 *   （create-token 的 to: "chain"），随后由 play 动作接手完成打出流程；
 *   effect.token 的 mode: "play"（链上生成路径）当前被显式 blocked
 *   （"token-play-requires-chain-creation"），链上创建由内核负责。
 * - Sand Soldier = CR 187.3 定义的 2 Might 单位 token（Shurima），effect.token
 *   的定义表 id 为 "sand-soldier"。
 * - "here" = 打出本单位的那个位置（战场或基地），即来源对象的当前位置，
 *   用 object-property 表达式在结算时取（420.3.b.2 的"结算时检查"）；
 *   object 用契约 3.6 的符号选择器 "source"，由解释器绑定运行时引用。
 *
 * 结构说明：
 * - body[0]（effect.token, mode: "play"）把 token 创建在链上；
 * - body[1]（effect.play）通过 linkedTo 引用前一条指令的 token 对象，完成打出
 *   流程（契约 3.6 GameAction "play"；费用按 185.3 为 null/无印刷费）。
 * - 两条指令的链接关系：token 创建失败（negated）时 play 仍按契约 3.4 尽可能
 *   执行——play 的目标是 linked 引用，引用不存在则 play 自身被 ignored。
 * - effect.play 的 cost 省略：token 无印刷费用（185.3），费用计划由 Finalize
 *   管线按通常打出流程处理（effect.play 文档：cost 必须是已 Finalize 的计划，
 *   本原语不推导印刷费用）。
 */
const abilities: Ability[] = [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { self: true }
      },
      optional: false,
      body: [
        {
          id: "royal-guard.create-sand-soldier",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "sand-soldier" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "object-property",
              object: "source",
              property: "location"
            },
            linkKey: { kind: "constant", value: "sandSoldier" }
          }
        },
        {
          id: "royal-guard.play-sand-soldier",
          op: "effect.play",
          linkedTo: "royal-guard.create-sand-soldier",
          args: {
            object: {
              kind: "linked-value",
              instructionId: "royal-guard.create-sand-soldier",
              key: "sandSoldier.objects"
            },
            location: {
              kind: "object-property",
              object: "source",
              property: "location"
            }
          }
        }
      ]
    }
  ];

const program = {
  canonicalCardId: "card.hash-0ba141b975db96cac65aab56bfd7dbb63904c538cc3d9c32bdfb3b2d98e486de",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText: "When you play me, play a 2 :rb_might: Sand Soldier unit token here."
} satisfies CardProgram;

export default program;
