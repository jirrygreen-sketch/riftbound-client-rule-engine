import type { CardProgram } from "../../ir/index.js";

/**
 * Faithful Manufactor (ogn-211-298) — Unit, 3 energy, Might 2（无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-211-298）：
 *   When you play me, play a 1 :rb_might: Recruit unit token here.
 *
 * 规则依据（CR v1.5）：
 * - 「When you play me」= card-played 时点、filter 指向自身（383/420.4.a）。
 * - 「play a … token」：新 token 被“打出”时先在链上生成再走打出流程（440.2.c、185.2.a、
 *   350.2、354），由 effect.token 的 mode "play" 交付（契约 3.6 的 create-token to: "chain" + play）。
 * - Recruit 是 CR 187.1 定义的 1 Might 单位 token；effect.token 定义表里的 id 是 "recruit"。
 * - 「here」是来源对象执行指令时的位置（359.3.f.1/f.2 的 referent：here/my/its 在执行指令时检查）。

 * 结构（契约 3.1/3.2/3.9）：
 * - body[0] 用已合入的 condition.value 读取来源当前位置并写链接值 here（interpreter README：
 *   condition.value 的 value/key 组合正是“写一个命名值”的通用形状）；
 * - body[1] 用 effect.token 在链接值 here 的位置打出 Recruit token，并 linkedTo 前一条指令，
 *   使“here 不可用时整条指令被忽略”。
 *
 * 为什么不写成 effect.token 的 location: { kind: "object-property", object: "source", ... }：
 * 该写法是契约 3.6 的符号选择器形状，但 effect.token 自己的 argsSchema 里 object-property
 * 只接受运行时 ObjectRef（isObjectRef(value.object)），符号选择器会被它拒绝。这是原语 schema
 * 与契约 3.6 的落地差异，见最终回复的契约变更请求；本卡因此用两条已合入原语完成同一语义。
 */
const faithfulManufactor = {
  canonicalCardId: "card.hash-ef1c7eb120057e88602660880f334f51bc98de276bb82ec36762ef1b9981a792",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", source: "self" }
      },
      optional: false,
      body: [
        {
          id: "faithful-manufactor.read-here",
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
          id: "faithful-manufactor.play-recruit",
          op: "effect.token",
          linkedTo: "faithful-manufactor.read-here",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "faithful-manufactor.read-here",
              key: "here"
            }
          }
        }
      ]
    }
  ],
  sourceText: "When you play me, play a 1 :rb_might: Recruit unit token here."
} satisfies CardProgram;

export default faithfulManufactor;
