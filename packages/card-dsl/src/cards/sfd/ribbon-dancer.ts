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
 * Current review (2026-10-17, measured):
 * CR v1.5 449.1/449.2 and 458/458.1: a genuine Move to a battlefield must be
 * distinguished from Recall. The body grants +1 Might this turn (arithmetic
 * layer, not a Buff) to another friendly unit. The temporary Might body
 * executes on an explicitly bound target; three gaps remain:
 * - programs/filters.ts rejects the body target's exclude: "source" anchor
 *   ("another friendly unit", 355.9.b / 359.3.e.5) with ProgramBindingError
 *   before the trigger filter is even translated, so the whole trigger
 *   registration fails closed;
 * - object-moved is missing from the closed EVENT_PATTERN_TYPES vocabulary
 *   (events/trigger-spec.ts, invalid-event-type);
 * - the real move-location emission carries no toZone/toKind, so "to a
 *   battlefield" (449.2) has no payload to compare against.
 * Execution evidence: test/cards/templates/triggered-object-moved-continuous-might-687.test.mjs.
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
    "三处实测缺口（2026-10-17），均不近似实现：" +
    "(1) body 目标的相对锚点未接通——programs/filters.ts 的 translateObjectFilter 不支持 exclude 锚点，" +
    "实测 registerProgramTriggers 在翻译本卡 body 目标时抛 ProgramBindingError（\"Unsupported filter field exclude\"，code judge-required），" +
    "整条触发 fail-closed、pipeline 触发器数为 0；因此 Finalize/Resolve 无法按 355.9.b/359.3.e.5 保证「another friendly unit」永远排除来源自身。" +
    "(2) 触发无法注册——封闭 EVENT_PATTERN_TYPES（events/trigger-spec.ts）不含 object-moved，" +
    "带 event 的 EventPattern 被 assertTriggerSpec 以 invalid-event-type 拒绝。" +
    "(3) 终点载荷缺失——events/action-adapter.ts 为 move-location 发出的 object-moved 只带 action.to，" +
    "不带 toZone/toKind（这两个字段只在同一发射的 zone-enters/leaves 分支写入），" +
    "所以 toZone:\"battlefield\" 无法区分真实 Move 终点与 Recall（449.1/449.2、458/458.1）；" +
    "实测同一 pattern 在带 toZone 的发射上匹配、在生产发射上不匹配。" +
    "translateTriggerFilter 已能把内层 source:self 绑定为本卡 objectId。" +
    "已可执行部分：continuous.might 的临时 +1 Might body（143.2.a、317.1.a/478，回合结束到期）在显式绑定目标上真实执行；" +
    "执行证据在 test/cards/templates/triggered-object-moved-continuous-might-687.test.mjs。" +
    "依赖：非自身目标锚点的目标管道适配（exclude: \"source\"）、object-moved 进入 EventPattern 词表、真实 Move 的终点载荷。",
  abilities,
  sourceText: "When I move to a battlefield, give another friendly unit +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;
