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
 * status: judge-required —— 两处缺口：
 * - "spend any number of buffs" 的非目标 counter 选择：已合入的 effect.buff（RIFT-68）
 *   只接受 args.target（TargetSpec id，经 ctx.targets 读取），没有 pick 形式；把 buff
 *   选择写成 TargetSpec 会让 counter 变成目标选择（违反 704.1/742.1，并会错误触发
 *   "成为目标"类触发），属近似实现。
 * - card-played 触发进链：没有已合入消费方把 CardProgram 的 triggered 能力绑定成
 *   TriggerRegistration（RIFT-257）；触发 filter 采用惯例的 canonicalCardId 拼写
 *   （旧 { role: "self" } 拼写会被引擎侧 ObjectFilter 校验拒绝）。
 * 本卡因此声明所需的 pick 形状并保持 judge-required；详见最终回复的契约变更请求。
 * 依赖：effect.buff 的非目标 pick 形式（RIFT-9 原语清单的 counter/spend-buff 语义扩展）
 * 与 RIFT-257。
 */
const albusFerros = {
  canonicalCardId: "card.hash-ef48253b8c94c8b28932090e3ba51b03bd2a1b1ea8a5465de707daabf2bb92c5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1)「spend any number of buffs」是结算时的非目标 counter 选择（704.1/742.1/745.1.a：counter 不是目标，" +
    "在指令结算时选择），但已合入的 effect.buff（RIFT-68）只接受 args.target（TargetSpec，经 ctx.targets 读取），" +
    "没有 pick 形式；把 buff 选择建成 TargetSpec 会让 counter 变成目标并错误触发「成为目标」类触发，属近似实现。" +
    "本卡声明所需形状（effect.buff 的 pick 参数 + picks + repeat 读实际 spend 数）。" +
    "(2) card-played 触发进链还缺 RIFT-257 的 CardProgram 触发绑定；触发 filter 已改用 canonicalCardId 的自身拼写。" +
    "channel 半段（effect.channel，431.1/431.2）已合入并由 golden 真实执行。" +
    "依赖：effect.buff / counter 原语的非目标 pick 形式（RIFT-9 原语清单的 counter 语义扩展）与 RIFT-257。",
  sourceText:
    "When you play me, spend any number of buffs. For each buff spent, channel 1 rune exhausted.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        // "When you play me": the played card identifies itself by canonical id
        // (the older { role: "self" } spelling is rejected by the engine-side
        // ObjectFilter validator); RIFT-257 owns turning this into a
        // TriggerRegistration.
        filter: {
          event: "card-played",
          object: {
            canonicalCardId: "card.hash-ef48253b8c94c8b28932090e3ba51b03bd2a1b1ea8a5465de707daabf2bb92c5"
          }
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
