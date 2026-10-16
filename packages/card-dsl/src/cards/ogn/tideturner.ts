import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Tideturner (ogn-199-298) — Unit, 2 energy, 2 Might.
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   When you play me, you may choose a friendly unit. Move me to its location
 *   and it to my original location.
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）只声明关键词；展开（静态 `cost.hidden`）已由 RIFT-84 合入，但运行时
 *   消费方缺失（见 judgeReason）。
 * - “When you play me” 是 Play Effect（383.4.a.1 / 383.4.a.2），时点 card-played。
 * - “you may choose a friendly unit”：355.5（需要指名一个游戏对象时在 Finalize 前选择）、
 *   355.7（指名对象即目标）。因此是 TargetSpec（friendly = 本卡控制者控制的单位）。
 * - “Move me to its location and it to my original location”：两次 Move（448.1 / 421），
 *   都必须先锁定双方**原始**位置（355.4：移动目的地要在移动前选定；移动是瞬时的，
 *   448.3），否则第二次移动会读到已被移动后的位置。本程序用两条
 *   `condition.value` 先捕获 `self`/目标的 `location`，再用 `effect.move` 的
 *   `linked-value` 目的地完成交换（契约 3.6 的符号选择器 + 3.9 的链接值）。
 *   “可以……”（may）按契约 3.9 写成 `choice.optional`，被选指令包在 body 里。
 *
 * status 判定（README 第 2 节）：judge-required。交换本体只用了已合入的
 * `condition.value` 与 `effect.move`（golden 测试真实执行），但 [Hidden] 的运行时不可用：
 * `cost.hidden` 没有消费方，zones/actions 不支持 Facedown Zone（cost/README.md 第 3 条），
 * 811.1.d/811.5 的藏牌、后续 [Reaction] 与 0 能量打出都无法落地。依赖：RIFT-84 的展开 + 
 * Hide 的面向区域契约与集成（父任务）。
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
    "[Hidden] 的运行时不可用：effects/keywords/Hidden.ts 的展开（静态 cost.hidden）已合入，" +
    "但没有消费方——cost/README.md 第 3 条明确 zones/actions 尚不支持 Facedown Zone 与 Hide，" +
    "811.1.d 的藏牌、811.5 的后续 [Reaction] 与 0 能量打出都无法落地，需要父任务契约与集成。" +
    "依赖：RIFT-84（kw-deflect-hidden 展开）+ Hide 的面向区域契约。交换本体只用已合入的 " +
    "condition.value / effect.move，golden 测试用解释器 + 参考内核真实执行。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, you may choose a friendly unit. Move me to its location and it to " +
    "my original location."
} satisfies CardProgram;

export default program;
