import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ribbon Dancer (sfd-038-221) — Unit, Calm, Ionia.
 * energy 3, power: none printed, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-038-221，逐字）:
 *   "When I move to a battlefield, give another friendly unit +1 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）:
 * - "When I move to a battlefield"（421.1、449.1/449.2、458/458.1）：Move 是永久物在两个
 *   Location 之间的移动，Recall 不是 Move，不触发移动类能力；封闭时点 object-moved 表示
 *   一次成功的 Move。filter 用内层锚点 source: "self" 指称本卡（已合入 sfd/corinna-veraza、
 *   ogn/noxian-drummer 采用同一写法，并用 toZone: "battlefield" 表达「移动到战场」）。
 * - "give another friendly unit +1 :rb_might: this turn"：带回合期限的临时 Might 修改，
 *   属算术图层（continuous.might），不是 Buff 计数——effect.buff 文件头明确临时 Might
 *   修改归 continuous.might（CR 703 的 Buff 与它是两回事）。「another friendly unit」是被
 *   选择的对象（355.7/355.9.b），「another」排除来源自身。
 *
 * Current review:
 * CR v1.5 449.1/449.2 and 458/458.1: a genuine Move to a battlefield
 * must be distinguished from Recall. The body grants +1 Might this turn
 * (arithmetic layer, not a Buff), targeting another friendly unit.
 * The temporary Might body executes; move payload and exclude:source target
 * binding remain blocked. The trigger source:self anchor already translates.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: {
        event: "object-moved",
        toZone: "battlefield",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        id: "ribbon-dancer.give-plus-1",
        // "give another friendly unit +1 [M] this turn" — the chosen unit is
        // the effect's object (the target declared below), not the source of
        // the ability; the merged continuous.might primitive reads it through
        // its `objects` selection (the merged smoke-screen / siphon-power
        // shape).
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "this-turn" },
          objects: {
            kind: "constant",
            value: { kind: "target", id: "ribbon-dancer.other-friendly-unit" }
          }
        },
        targets: [
          {
            id: "ribbon-dancer.other-friendly-unit",
            filter: {
              type: "unit",
              controller: "controller",
              zone: "board",
              exclude: "source"
            },
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
  canonicalCardId: "card.hash-1d9968343e4ab4ff83ad67e03bc124632358c3526c2bbddcc0667b4849c03538",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「When I move to a battlefield」仍缺 CR v1.5 449.1/449.2、458/458.1 的移动终点与 Recall 区分载荷：events/action-adapter.ts 的 object-moved 不带 toZone/终点，当前 toZone:\"battlefield\" 过滤不能匹配。translateTriggerFilter 已能把内层 source:self 绑定为本卡 objectId；实际未接通的是 body 目标的 exclude:\"source\"，translateObjectFilter 仍不支持该锚点，无法在 Finalize/Resolve 保证「another friendly unit」（355.9.b/359.3.e.5）。continuous.might 的临时 Might body 已有独立执行证据。依赖：真实 Move 的终点/原因载荷与非自身目标锚点的目标管道适配。",
  abilities,
  sourceText: "When I move to a battlefield, give another friendly unit +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;
