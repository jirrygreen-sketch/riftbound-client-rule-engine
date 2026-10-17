import type { CardProgram } from "../../ir/index.js";

/**
 * Albus Ferros (ogn-230-298) - Unit, Order, Piltover (M2 unit shard 12).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-230-298):
 *   When you play me, spend any number of buffs. For each buff spent, channel 1
 *   rune exhausted.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a：Play Effect 在打出完成后入链（时点 card-played）；本触发是强制的
 *   （没有 "may"），故 optional: false。
 * - 702.2.b：Spending a Buff removes a single Buff counter from a Unit；
 *   702.2.b.1 没有 buff 的单位不能被 spend；702.2.b.2 只能 spend 自己控制的单位上的 buff。
 * - 702.3 / 702.3.a：一个单位同时只能有一个 buff。
 * - 704 / 704.1：Buff 是 Game Object（counter），可被引用/计数，但不能被法术与能力指定为目标；
 *   742.1 / 742.3 同义：效果要处理 counter 时，counter 在指令结算时选择。
 * - 745 / 745.1 / 745.1.a / 745.1.b：spend counter 时按指定类型从指定对象上移除相应数量；
 *   这里类型是 buff、数量是 "any number"（355.13：可以选 0 个）。
 * - 431.1 / 431.2：channel 从 Rune Deck 顶取符文进场；"1 rune exhausted" 指定入场时横置
 *   （431.2.a 默认入场为就绪）。
 * - 355.13："any number" 允许选择 0 个；选 0 时不发生任何 spend，也不 channel。
 *
 * 结构：body[0] 声明"结算时的非目标 counter 选择 + spend"（picks 不是目标，见契约 3.4 /
 * 355.7 / 704.1），body[1] 用 repeat 读 body[0] 链接的实际 spend 数量，每次 channel 1 个横置符文
 * （"for each buff spent"）。
 *
 * status: judge-required。effect.buff 仍只接受 TargetSpec，缺少结算期非目标
 * pick/choose counter 入口；chooseUpTo 也不能消除事先锁定目标的语义。
 * zoneSlice/linked 的有序来源没有补足本卡的 filter 选择。golden 通过受支持的
 * target 原语形式产生实际 spentCount 并执行原始 repeat/channel，绝不注入数量。
 * 这些是子效果证据；整张卡仍须补齐 704.1/742.1 的 counter 非目标选择。
 */
const albusFerros = {
  canonicalCardId: "card.hash-ef48253b8c94c8b28932090e3ba51b03bd2a1b1ea8a5465de707daabf2bb92c5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 effect.buff 的结算时非目标 pick/choose 入口（CR 704.1/742.1/745.1.a；355.13 的 any number 含 0）：现有原语只从 ctx.targets(args.target) 读取单位；chooseUpTo 仍依赖预锁定目标，不能代替 counter 选择。chain/picks 的 zoneSlice/linked 来源不会把本卡 PickSpec.filter（友方、board、buffed）转成结算时选项。需返回实际 spentCount 给后续 repeat/effect.channel，不能手工注入数量或把 counter 变为目标。",
  sourceText:
    "When you play me, spend any number of buffs. For each buff spent, channel 1 rune exhausted.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        // "When you play me": bind the event object to this ability host. A
        // canonical-card filter would also match another copy of the card.
        filter: {
          event: "card-played",
          filter: { source: "self" }
        }
      },
      // 无 "may"，是强制触发。
      optional: false,
      body: [
        {
          // 704.1/742.1：counter 不是目标；这里用 picks（非目标选择）而不是 targets。
          id: "albus-ferros.spend-buffs",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "spend" },
            pick: { kind: "constant", value: "albus-ferros.buffs" }
          },
          picks: [
            {
              id: "albus-ferros.buffs",
              options: ["buffed-friendly-unit"],
              filter: {
                type: "unit",
                zone: "board",
                controller: "controller",
                // 702.2.b.1：没有 buff 的单位不能提供 counter；702.2.b.2：只能 spend 自己控制的单位。
                buffed: true
              },
              // 355.13："any number" 含 0 个。
              min: 0,
              selection: "any"
            }
          ]
        },
        {
          // "For each buff spent, channel 1 rune exhausted."（431.1/431.2）
          id: "albus-ferros.channel-per-buff",
          op: "repeat",
          args: {
            count: {
              kind: "linked-value",
              instructionId: "albus-ferros.spend-buffs",
              key: "spentCount"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "albus-ferros.channel-1",
                  op: "effect.channel",
                  args: {
                    amount: { kind: "constant", value: 1 },
                    exhausted: { kind: "constant", value: true }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default albusFerros;
