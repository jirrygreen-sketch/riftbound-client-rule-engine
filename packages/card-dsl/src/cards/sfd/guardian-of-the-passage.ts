import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Guardian of the Passage (sfd-035-221) — Unit, Calm, Spirit/Shadow Isles.
 * energy 6, power: none printed, Might 6.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-035-221，逐字）:
 *   "When I hold, you may return a unit or gear from your trash to your hand."
 *
 * 规则依据（CR v1.5）:
 * - "When I hold"（383.4.d / 383.4.d.2.a）：Hold Effect，时点 hold（315.2.b.2/471.2/
 *   473.2.b），filter 用内层 source: "self" 指称本卡。
 * - "you may return …"（403.1、契约 3.9）：效果首段是 "you may"，被选指令包进
 *   choice.optional 的 body。
 * - "a unit or gear from your trash to your hand"（355.10.a、355.9.a.1）：Trash 是
 *   Public Zone（108.2.d），「your trash」里的卡是可被玩家选择的对象，因此是 target；
 *   「unit or gear」是 type: ["unit", "gear"] 的合取过滤（类型在任意区域都成立，
 *   141.2.b/148.2.b）。区域移动用封闭 GameAction return-to-hand，经 effect.zone
 *   （to: "hand"）提交；355.12 要求 may-action 的选择随触发进链一起做，因此 TargetSpec
 *   挂在 choice.optional 节点上（已合入的 ogn/salvage 同型）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - effect.zone 的 trash→hand 半段与 choice.optional 都已合入并有执行测试，但
 *   TargetSpec.filter 的 `owner: "controller"`（=「your trash」）绑定依赖卡牌程序触发/目标
 *   注册层做 self/opponent 归一化：已合入的归一化只存在于 chain/engine.ts 的 query 包装与
 *   生产链路径，`resolveChainBody`（参考内核路径）不做归一化，所以 golden 必须以字面 id
 *   预置目标集才能执行；触发 filter 的内层锚点（source: "self"）同样没有消费方
 *   （events/pipeline-match.ts 只读 EventPattern 的 object/source/target/player/fromZone/
 *   toZone/amount/details）。
 * - 依赖：RIFT-120（事件/链把卡牌程序触发注册进管线并把被固守对象与宿主同一性暴露给
 *   注册层）、目标 Finalize 的 owner 归一化接线。
 * 不近似实现：不把「你的垃圾场」写成无 owner 过滤（那会允许对手垃圾场的卡），也不用
 * 手改区域的方式代替 effect.zone。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "hold", filter: { event: "hold", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "guardian-of-the-passage.may-return",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Return a unit or gear from your trash to your hand?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "guardian-of-the-passage.return-to-hand",
                op: "effect.zone",
                args: {
                  target: { kind: "constant", value: "guardian-of-the-passage.card-in-trash" },
                  to: { kind: "constant", value: "hand" },
                  amount: { kind: "constant", value: 1 }
                }
              }
            ]
          }
        },
        targets: [
          {
            id: "guardian-of-the-passage.card-in-trash",
            filter: { type: ["unit", "gear"], zone: "trash", owner: "controller" },
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
  canonicalCardId: "card.hash-291f978c4d26e5c73a603a5f856768f2a0714f4bbe78fc0e3dbe4ac83dfb8767",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「return a unit or gear from your trash to your hand」的 effect.zone 半段（trash→hand，355.10.a、108.2.d）与 choice.optional " +
    "（403.1、契约 3.9）都已合入并有执行测试，但 TargetSpec 的 owner: \"controller\"（= 「your trash」）与触发 filter 的内层锚点 " +
    "source: \"self\" 都依赖卡牌程序触发/目标注册层的归一化：已合入的归一化只存在于 chain/engine.ts 的生产链 query 包装，" +
    "events/pipeline-match.ts 只读 EventPattern 的 object/source/target/player/fromZone/toZone/amount/details，" +
    "参考内核路径（resolveChainBody）不做归一化，因此触发无法命中、目标合法性无法在 Finalize 判定。" +
    "依赖：RIFT-120（卡牌程序触发注册 + 被固守对象/宿主同一性 + 目标 owner 归一化接线）。不近似实现" +
    "（不省略 owner 过滤，也不用直接改区域代替 effect.zone）。",
  abilities,
  sourceText: "When I hold, you may return a unit or gear from your trash to your hand."
} satisfies CardProgram;

export default program;
