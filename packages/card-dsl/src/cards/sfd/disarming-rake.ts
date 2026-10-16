import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Disarming Rake (sfd-032-221) — Unit, Calm, Demacia.
 * energy 3, power 1 (Calm), Might 2.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-032-221，逐字）:
 *   "When you play me, you may kill a gear."
 *
 * 规则依据（CR v1.5）:
 * - "When you play me"：383.4.a/420.4.a 的 Play Effect，在打出动作完成后进链；时点为
 *   card-played，filter 用 self: true 指称本卡（与 sfd/bubble-bot、ogn/pit-rookie 同型）。
 * - "you may kill a gear"（403.1、契约 3.9）：效果首段是 "you may"，把被选指令包进
 *   choice.optional 的 body，而不是「先放 choice、后续指令 linkedTo」。
 * - "a gear"：355.9.a.1 规定 "gear" 未特别说明时指 Board 上的对象；355.10 的例外都不适用
 *   （玩家要选，不是程序化选定），所以是 target（355.7）。355.12 要求 may-action 的所有
 *   选择在该动作被选择时就做，因此 TargetSpec 挂在 choice.optional 节点上、随打出一起
 *   Finalize 锁定（已合入的 ogn/salvage "You may kill a gear." 就是这一形状）。
 * - 消灭本身是 429 的 Active Kill，交给已合入的 effect.kill（target 形态）。
 *
 * status：executable。effect.kill、choice.optional、TargetSpec 与解释器的 args 求值路径
 * 均已合入，golden 测试用解释器（chain/interpreter-adapter 的生产调用路径）在参考内核上
 * 真实执行整个 body：接受/拒绝 may、目标失效三种分支都有断言；触发进链的管线接线与其它
 * 已合入触发卡一样记录为 test.todo（RIFT-120）。
 *
 * 无契约变更请求：所用到的一切（target、pick、时点、原语）都在现有契约内。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "disarming-rake.may-kill-gear",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Kill a gear?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "disarming-rake.kill-gear",
                op: "effect.kill",
                args: { target: { kind: "constant", value: "disarming-rake.gear" } }
              }
            ]
          }
        },
        targets: [
          {
            id: "disarming-rake.gear",
            filter: { type: "gear" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-89e550302d0740c3eda7dbbeed7a733ed73710ce218d8bbcbd8ed3a58710e810",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText: "When you play me, you may kill a gear."
} satisfies CardProgram;

export default program;
