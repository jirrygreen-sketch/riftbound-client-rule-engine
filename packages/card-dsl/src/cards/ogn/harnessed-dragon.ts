import type { CardProgram } from "../../ir/index.js";

/**
 * Harnessed Dragon (ogn-234-298) - Unit, Order, Dragon/Demacia (M2 unit shard 12).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-234-298):
 *   When you play me, kill an enemy unit.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a：这是 Play Effect —— 本永久物被打出并进场后，触发作为 Pending Item 入链
 *   （时点 card-played，见 events/timing-points.ts 的 card-played，ruleRefs 359/383.4.a）。
 * - 355.9 / 355.9.a / 355.9.a.1：目标必须满足全部限制；"unit" 默认指场上的单位。
 * - 355.10 / 355.10.b："kill an enemy unit" 中的单位是目标（"enemy" 是限制，不是例外）。
 * - 429.1.a.1 / 429.1.a.1.a / 429.3：Kill 是 Kill Instruction（主动消灭）；只有游戏效果指示时才能消灭。
 * - 359.3.e.7 / 359.3.e.8 / 359.3.e.11：结算时目标全部失效则指令 ignored；部分失效尽可能执行。
 *
 * status: executable —— 所需路径均已合入并有执行测试：
 * - 触发：card-played 时点（events/timing-points.ts）由 chain 在打出完成后发出
 *   （chain/engine.ts 的 card-played emit），触发管线按 ObjectFilter 匹配来源自身；
 * - 原语：effects/instructions/effect.kill.ts（主动消灭，目标经 ctx.targets 读取，结算时重验）；
 * - golden 测试用解释器 + 参考内核真实执行 body（正常消灭、目标离区后 ignored）。
 * 注：把卡牌程序注册进生产触发管线属共享接线（RIFT-1 后续），不影响本卡数据的可执行性判定。
 */
const harnessedDragon = {
  canonicalCardId: "card.hash-b976bf2748e814e21964451d7d22d8c4833b1fc4ed18496117c1239cc8acb010",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "When you play me, kill an enemy unit.",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { role: "self" } },
      optional: false,
      body: [
        {
          id: "harnessed-dragon.kill-enemy-unit",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "harnessed-dragon.enemy-unit" } },
          targets: [
            {
              id: "harnessed-dragon.enemy-unit",
              filter: { type: "unit", zone: "board", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default harnessedDragon;
