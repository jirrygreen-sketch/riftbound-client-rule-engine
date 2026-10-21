import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Royal Guard (sfd-157-221, fiora-sfd M1 卡组).
 *
 * 原文："When you play me, play a 2 :rb_might: Sand Soldier unit token here."
 *
 * 规则依据（CR v1.5）：
 * - "When you play me"：打出触发（时点 card-played；420.4.a 在打出完成后触发）。
 * - "play a … token"：440.2.c / 185.2.a 规定被"打出"的 token 先在链上生成再走
 *   打出流程（350.2 / 354）；effect.token 的 mode: "play" 自己完成"链上生成 +
 *   交给 Play"，不需要也不能再跟一条 effect.play（那会把同一 token 打出两次）。
 * - Sand Soldier = CR 187.3 定义的 2 Might 单位 token（Shurima），effect.token
 *   的定义表 id 为 "sand-soldier"。
 * - "here" = 执行指令时来源对象的位置（359.3.f.1/f.2 referent）。
 *
 * 结构（与已 executable 的 Faithful Manufactor ogn-211-298 同形）：
 * - body[0] 用 condition.value 读取来源当前位置写链接值 here——effect.token 的
 *   argsSchema 里 object-property 只接受运行时 ObjectRef，不接受符号选择器
 *   "source"（直接写会抛 "Invalid effect.token argument: location"，RIFT-896
 *   headless 实测）；
 * - body[1] 用 effect.token 在链接值 here 处打出 Sand Soldier，并 linkedTo
 *   前一条指令，使 here 不可用时整条指令被忽略（契约 3.4）。
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
          id: "royal-guard.read-here",
          op: "condition.value",
          args: {
            value: {
              kind: "object-property",
              object: "source",
              property: "location"
            },
            key: { kind: "constant", value: "here" }
          }
        },
        {
          id: "royal-guard.play-sand-soldier",
          op: "effect.token",
          linkedTo: "royal-guard.read-here",
          args: {
            token: { kind: "constant", value: "sand-soldier" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "royal-guard.read-here",
              key: "here"
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
