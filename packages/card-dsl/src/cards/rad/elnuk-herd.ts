import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * elnuk-herd — Core Rules v1.5; see judgeReason for the current execution gaps.
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "elnuk-herd.grant-might",
        // 临时 Might 修正：已合入的 continuous.might（objects.target 形态）。
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 3 },
          duration: { kind: "constant", value: "end-of-turn" },
          objects: {
            kind: "constant",
            value: { kind: "target", id: "elnuk-herd.another-unit" }
          }
        },
        targets: [
          {
            id: "elnuk-herd.another-unit",
            filter: { type: "unit", controller: "controller", exclude: "self", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "elnuk-herd.recycle",
        op: "effect.recycle",
        args: {
          objects: {
            kind: "object-property",
            object: "source",
            property: "ref"
          }
        },
        condition: {
          kind: "compare",
          left: { kind: "object-property", object: "source", property: "playedFromFaceDown" },
          operator: "eq",
          right: { kind: "constant", value: true }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-7451c4c0dfc182af5e8953981779aa897fa4d429f1fbddbbee5cf2c7ba59abe6",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "CR 811.1.d/355.10.a.1：缺面朝下打出的历史来源事实到 recycle 条件的绑定；source.playedFromFaceDown 不是 ObjectSnapshot 特征，通用条件/历史查询不能用进场后的 faceDown 近似该事实。programs/statics.ts 的 layerFor 未映射 Hidden 的 cost.hidden，chain 未连接 Hide/后续回合 Reaction/忽略基础费用流程。CR 355.5：解释器已支持 exclude:self，但 programs/filters.ts 未绑定该锚点，another friendly unit 的生产触发/Finalize 仍不可达；+3 Might 与 recycle 原语已支持。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, give another friendly unit +3 :rb_might: this turn, then recycle me if I was played from face down."
} satisfies CardProgram;

export default program;
