import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * apprentice-mage — M2 源码复核（2026-10-17）。
 * CR v1.5 827.1.c.1：Empower 印刷费用为 2 Energy。
 * 442.1.a/828.1.b.1：依赖能力只在宿主 Empowered 时有效。
 * Empower KeywordDef 已合入；缺口是逐实例费用参数与生产接线。
 * 具体规则与剩余阻塞见 judgeReason；局部执行不代表整卡可执行。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower",
    value: 2
  },
  {
    kind: "triggered",
    trigger: {
      at: "empowered-changed",
      filter: {
        event: "empowered-changed",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        id: "apprentice-mage.predict-look",
        op: "effect.inspect",
        args: {
          player: {
            kind: "object-property",
            object: "source",
            property: "controller"
          },
          zone: { kind: "constant", value: "deck" },
          scope: { kind: "constant", value: "top" },
          picksSpecId: { kind: "constant", value: "apprentice-mage.predict-top-2" },
          amount: { kind: "constant", value: 2 },
          choose: { kind: "constant", value: true },
          chooseCount: { kind: "constant", value: { min: 0, max: 2 } },
          choiceId: { kind: "constant", value: "apprentice-mage.predict" },
          pickedKey: { kind: "constant", value: "predict-looked-at" },
          choosePicksKey: { kind: "constant", value: "predict-recycle" }
        }
      },
      {
        id: "apprentice-mage.predict-recycle",
        op: "effect.recycle",
        args: {
          objects: {
            kind: "linked",
            instructionId: "apprentice-mage.predict-look",
            key: "predict-recycle"
          }
        },
        linkedTo: "apprentice-mage.predict-look"
      },
      {
        id: "apprentice-mage.predict-put-back",
        op: "effect.order",
        args: {
          destination: { kind: "constant", value: "top" },
          count: {
            kind: "arithmetic",
            operator: "sub",
            operands: [
              {
                kind: "linked-value",
                instructionId: "apprentice-mage.predict-look",
                key: "inspected"
              },
              {
                kind: "linked-value",
                instructionId: "apprentice-mage.predict-recycle",
                key: "recycledCount"
              }
            ]
          },
          chooseOrder: { kind: "constant", value: true }
        },
        linkedTo: "apprentice-mage.predict-recycle"
      }
    ]
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 1 }
    },
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId: "card.hash-ca70aa40eda9b90185f38679f3d22f38f003f40ea76c2154efad0a8a820c23e4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "827.1.c.1 的 2 Energy 印刷费用缺 KeywordAbility.params.cost → expandProgram → Empower.expand 接线；ObjectSnapshot 尚未声明 empowered（442.1.a），统一生产 Empowered 状态适配与 442.1.b/c 的二元状态限制仍需接通；828.1.c 的 continuous.might 门控已改读真实 empowered 计数；828.1.d 的 empowered-changed 缺 previousCount/currentCount 变化方向载荷及过滤，Disempower 也会产生同一时点；effect.inspect 的 argsSchema 仍只接受运行时 ObjectRef、拒绝 object: \"source\" 的符号 player 表达式，且没有 PickSpec/zoneSlice 绑定提供牌库顶有序范围。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not Empowered.)\n" +
    "When I become [Empowered], [Predict 2]. (Look at the top 2 cards of your Main Deck. Recycle any of them and put the rest back in any order.)\n" +
    "[Empowered][>] I have +1 :rb_might:."
} satisfies CardProgram;
