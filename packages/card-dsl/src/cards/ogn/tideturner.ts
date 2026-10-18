import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Tideturner — CR v1.5 811, 383.4.a, 355.4–355.7, 448.3.
 * 复核 2026-10-17：交换体已有执行证据，仍缺 Hidden 的整套区域/行动生命周期与
 * 嵌套目标在真实 Finalize 上的生命周期适配。
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
    "两处缺口（2026-10-17 复核）：" +
    "(1) [Hidden]（CR 811.1.b–811.1.d、811.5）仍缺 Hide 行动、Facedown Zone 与回合归属驱动的次回合解锁，" +
    "以及从藏牌区以 Reaction/0 Energy 打出的生产路径；关键词展开的 cost.hidden 也没有消费方——" +
    "programs/statics.ts::layerFor 实测抛 ProgramBindingError \"Static ability kind cost.hidden has no layer mapping\"，" +
    "ZoneId 里没有藏牌区，cost/kinds/hidden.ts 只锁定与支付计划，明确把 Hide/play 许可与区域留给 zone/timing 负责人。" +
    "(2) 友方目标位于 choice.optional 的嵌套 body 内，真实 chain 打出时 " +
    "chain/engine.ts::assertFinalizationSurface 抛 ChainContractBlockedError " +
    "\"Nested/repeated targets require an interpreter target-selection lifecycle adapter\"" +
    "（programs/play.ts::validateSurface 是同一判定的复制）；修它必须保留 355.5/355.12 的 Finalize 选择语义，" +
    "不能靠剥离 TargetSpec 或直接改状态绕过。" +
    "已有执行证据的部分：condition.value 经通用 location 表达式取值写入 linked-value，两次 effect.move 都读链接目的地，" +
    "交换体实测把两个单位的位置互换，CardProgram 触发注册与 self 归一化也已合入。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, you may choose a friendly unit. Move me to its location and it to " +
    "my original location."
} satisfies CardProgram;

export default program;
