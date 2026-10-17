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
 * - 效果体本身可执行：choice.optional（契约 3.9）与 effect.zone 的 trash→hand 半段
 *   都走已合入原语，golden 经 chain/interpreter-adapter.ts 的生产适配器真实执行
 *   （含 declined 分支）。
 * - 触发不可命中：hold 时点已由回合/计分流程发出（turn/flow.ts 的 scheduleScore,
 *   details.battlefieldId），但卡牌程序绑定（RIFT-257）把本卡的 filter 翻译为
 *   `{ event: "held", object: { objectId: <host ref> } }`，而真实 hold 发射没有 object
 *   载荷（events/pipeline-match.ts 的 matchesTriggerObject 对 undefined object 只在过滤器
 *   为空时命中），因此 filter 永远不匹配（封闭事件词表里的 held 名称本身已由翻译器支持）。
 *   此外 TargetSpec 的 `owner: "controller"`（=「your trash」）在 chain 的生产 query 包装里
 *   归一化为 `owner: "self"`（chain/engine.ts），golden 已按该归一化执行目标合法性。
 * - 依赖：RIFT-120 后续（hold 事件载荷携带被固守对象/宿主身份，使 source: "self" 锚点可判定）。
 * 不近似实现：不把「你的垃圾场」写成无 owner 过滤（那会允许对手垃圾场的卡），也不用
 * 手改区域的方式代替 effect.zone；也不把 hold 触发删掉只留效果体。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "hold", filter: { event: "held", filter: { source: "self" } } },
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
    "效果体已可执行：「return a unit or gear from your trash to your hand」的 effect.zone 半段（trash→hand，" +
    "355.10.a、108.2.d）与 choice.optional（403.1、契约 3.9）都只用已合入原语，golden 经 " +
    "chain/interpreter-adapter.ts 的生产适配器真实执行（含 declined 分支与 owner 归一化后的目标合法性）。" +
    "整卡仍不可执行：hold 时点已由 turn/flow.ts 的 score wave 发出（details.battlefieldId），但发射不带 " +
    "object 载荷，而卡牌程序绑定（RIFT-257 已合入）会把本卡 filter 翻译成 { event: \"held\", " +
    "object: { objectId: <host> } }——events/pipeline-match.ts 的 matchesTriggerObject 对 " +
    "undefined object 只在过滤器为空时命中，故触发永远不命中（原文的 source: \"self\" 锚点正是要靠该载荷）。" +
    "依赖：RIFT-120 后续（hold 事件载荷携带被固守对象/宿主身份）。不近似实现（不省略 owner 过滤，" +
    "也不用直接改区域代替 effect.zone）。",
  abilities,
  sourceText: "When I hold, you may return a unit or gear from your trash to your hand."
} satisfies CardProgram;

export default program;
