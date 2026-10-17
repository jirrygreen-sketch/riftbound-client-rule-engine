import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Tideturner — CR v1.5 811, 383.4.a, 355.4–355.7, 448.3.
 * Capture both original locations before either Move. Hidden and the nested
 * Finalize target lifecycle remain blocked; the swap body has execution evidence.
 * RIFT-357's LocationSelector binding is merged but only consumed by effect.move,
 * while the swap already resolves its destinations through linked values.
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "hidden"
  },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "tideturner.swap",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Move me to a friendly unit's location and it to my original location?"
          },
          body: {
            kind: "constant",
            value: [
              {
                // 先锁我的原始位置（355.4 / 448.3）。
                id: "tideturner.origin",
                op: "condition.value",
                args: {
                  value: {
                    kind: "object-property",
                    object: "self",
                    property: "location"
                  },
                  key: { kind: "constant", value: "origin" }
                }
              },
              {
                // 再锁被选单位的原始位置（第二次移动的目的地）。
                id: "tideturner.chosen-location",
                op: "condition.value",
                args: {
                  value: {
                    kind: "object-property",
                    object: { target: "friendly-unit" },
                    property: "location"
                  },
                  key: { kind: "constant", value: "chosenLocation" }
                },
                targets: [
                  {
                    id: "friendly-unit",
                    filter: { type: "unit", controller: "self" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              },
              {
                id: "tideturner.move-me",
                op: "effect.move",
                args: {
                  objects: { kind: "constant", value: "self" },
                  to: {
                    kind: "linked-value",
                    instructionId: "tideturner.chosen-location",
                    key: "chosenLocation"
                  },
                  linkKey: { kind: "constant", value: "movedMe" }
                }
              },
              {
                id: "tideturner.move-chosen",
                op: "effect.move",
                args: {
                  objects: { kind: "constant", value: { target: "friendly-unit" } },
                  to: {
                    kind: "linked-value",
                    instructionId: "tideturner.origin",
                    key: "origin"
                  },
                  linkKey: { kind: "constant", value: "movedChosen" }
                },
                targets: [
                  {
                    id: "friendly-unit",
                    filter: { type: "unit", controller: "self" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-2e073bafe3ab30d9d490463b071263df4273ed757b8f819b07328932fa2b04a5",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "[Hidden] 仍缺 Hide 行动、Facedown Zone、战场控制与回合归属驱动的次回合解锁，以及从藏牌区以 Reaction/0 Energy 打出的生产路径（CR 811.1.b–811.1.d、811.5）；cost.hidden 的静态展开尚无对应生命周期消费。" +
    "交换体的 condition.value / effect.move 已可执行，CardProgram 触发注册与 self 过滤归一化也已合入；但友方目标在 choice.optional 的嵌套 body 内，programs/play.validateSurface 与 chain/engine.assertFinalizationSurface 会拒绝该目标生命周期，需保留 355.5/355.12 的 Finalize 选择语义。" +
    "依赖：Hidden 的区域/行动集成与嵌套目标 Finalize 适配；RIFT-357 已合入但仅被 effect.move 边界消费，本卡交换体经 linked-value 绑定原始位置，不依赖位置选择器；不以剥离 TargetSpec 或直接移动状态冒充完整打出。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, you may choose a friendly unit. Move me to its location and it to " +
    "my original location."
} satisfies CardProgram;

export default program;
