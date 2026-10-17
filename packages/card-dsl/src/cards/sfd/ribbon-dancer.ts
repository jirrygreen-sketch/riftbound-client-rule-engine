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
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - Might 修改本体已可执行：RIFT-258 合入 continuous.might（经 ResolveContext.addContinuous
 *   注册 arithmetic 层，带 end-of-turn 期限），RIFT-269 的 condition.value 也能在结算期
 *   读值；golden 用生产解释器真实执行 body 并断言图层注册与 Might 变化。
 * - 触发侧仍不可执行，两处缺口：
 *   1. object-moved 事件不带终点信息：events/action-adapter.ts 为 move-location 发出的事件
 *      只有 object/fromZone/toZone 之外的载荷（toZone 只对换区赋值，同一 Board 内
 *      move-location 不填 —— 实测 object-moved 事件无 details/toZone），而 449.1/449.2 的
 *      「移动到 battlefield」需要终点种类与 id（turn/flow.ts 只补发 object-enters-battlefield
 *      别名事件）；因此 toZone: "battlefield" 永不命中。
 *   2. 触发过滤器里的对象锚点与相对控制者过滤无法进入生产绑定：programs/filters.ts
 *      translateObjectFilter 以 judge-required 拒绝 exclude/sameLocationAs 等锚点字段，
 *      translateTriggerFilter 只把 source/role/self 译成 objectId，因此本卡 body 的
 *      exclude: "source" 与「another」都到不了目标管道（RIFT-257 之后仍缺）。
 * 依赖：RIFT-120（移动时点终点载荷与卡牌触发注册）、programs/filters.ts 的对象锚点/相对
 * 控制者过滤（RIFT-257 后续）、RIFT-89（费用/目标批次接线）。不近似实现。
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
    "Might 修改本体已合入并可执行：RIFT-258 的 continuous.might 经 ResolveContext.addContinuous 注册 " +
    "arithmetic 层效果并带 end-of-turn 期限（317.1.a/468.7.c），golden 用生产解释器真实执行并断言注册与 Might 变化；" +
    "object-moved 时点也由 events/action-adapter.ts 为 move-location 产生（RIFT-270）。整卡仍不可执行，两处缺口：" +
    "(1) 事件不带终点信息——同一 Board 内的 move-location 事件不填 toZone/toKind（实测 object-moved 只有对象引用；" +
    "turn/flow.ts 只为位置变化补发 object-enters-battlefield 别名），449.1/449.2 的「移动到战场」与 458/458.1 的 Recall 排除" +
    "都无法判定，toZone: \"battlefield\" 永不命中；" +
    "(2) 触发与目标的相对锚点没有生产绑定——programs/filters.ts 的 translateObjectFilter 对 exclude/sameLocationAs " +
    "等锚点字段以 judge-required 拒绝，translateTriggerFilter 只把 source/role/self 译成 objectId，" +
    "「another（exclude: source）」与内层 source 锚点都到不了目标管道。" +
    "依赖：RIFT-120（移动时点终点载荷与卡牌触发注册）、programs/filters.ts 的对象锚点/相对控制者过滤（RIFT-257 后续）。不近似实现。",
  abilities,
  sourceText: "When I move to a battlefield, give another friendly unit +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;
