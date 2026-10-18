import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shen, Scourge of Shadows (ven-042-166) — Unit, Calm, 5 Energy + 1 Calm Power,
 * Might 6, tag Shen/Ionia/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-042-166，逐字）：
 *   When I hold, if there is exactly one other unit you control here, draw 1.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.a："When I hold" 是 Hold Effect；单位类 Hold Effect
 *   在该单位于 Beginning 的计分步骤中位于被固守的战场时进入链。封闭时点是
 *   events/timing-points.ts 的 "hold"（ruleRefs 315.2.b.2 / 471.2 / 473.2.b）；
 *   471.2 的 Hold 定义是“回合玩家的 Beginning Phase 中维持对一个本回合尚未计分的战场的控制”。
 * - 383.2.a / 383.2.a.1：紧跟触发条件之后的 "if there is exactly one other unit you control
 *   here" 属于 Trigger Condition，不是 Effect（规则原文的 Sona, Harmonious 例即此形状），
 *   因此写在 trigger.condition 上。
 * - 143.1 / 143.1.b："other unit you control here" = 与本体同地点（053.3 的 here）、
 *   由能力控制者控制、且不是本体自身（exclude）的单位，恰好 1 个；count 表达式计数，
 *   锚点用契约 3.6 的 sameLocationAs / exclude / controller。
 * - 414.1 / 414.3 / 190.6.d："draw 1" 是 effect.draw 的印刷常量 1；隐含的 "you" 是能力
 *   控制者（effect.draw 省略 player / target / pick 时取 ctx.controller）。
 *
 * status = judge-required（2026-10-18 第三轮复核；结论以源码与 golden 实测为准）：
 * 1. hold 事件没有对象身份：turn/flow.ts 的 scheduleScore 以
 *    { timingPoint: "hold", player, details: { battlefieldId } } 发射（combat/flow.ts 同形），
 *    而 programs/filters.ts 的 translateTriggerFilter 把内层 source: "self" 解析成
 *    pattern.object = { objectId }；events/pipeline-match.ts 的 matchesTriggerObject 在事件
 *    没有 object 且 filter 非空时返回 false。golden 用真实翻译后的 filter 对
 *    hold 载荷断言：带匹配 object 时为 true、按真实发射形状（无 object）时为 false，
 *    所以「When I hold」的同一性仍然无法匹配。
 * 2. 触发条件里的相对控制者没有统一绑定：pipeline.ts 的 evaluateTriggerCondition 走
 *    host.context(...).query，chain/engine.ts 的 context 会把 controller/owner 的
 *    self/opponent 占位符绑定到能力控制者，但游戏侧（apps/game-server
 *    engine-runtime/host.ts 的 context.query、参考内核的 query）按值比较，
 *    controller: "controller" 落空 → count 为 0。golden 实测同一条件在“未绑定”
 *    查询下为 false、在绑定控制者后为 true。
 * 3. 早前列为缺口的 host.testTrigger 适配器已过时：条件谓词批次合入后 pipeline.ts 在
 *    host.testTrigger 缺失或抛 MissingInformation 时会自己调用 evaluateCondition；
 *    053.3 的 sameLocationAs / 356 的 exclude 锚点也已由 effects/interpreter/selectors.ts
 *    的 queryObjects 消费（golden 对“恰好一个其它友方单位在此”的真实求值）。
 * 4. body 的 effect.draw（414.1/414.3）与计数/锚点路径都有真实解释器执行证据。
 * 依赖：hold 事件的单位身份载荷（或等价的位置/对象绑定），以及触发条件查询路径统一绑定
 * 相对玩家占位符。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "hold",
      // 383.4.d.2.a：单位类 Hold Effect 由“我在此固守”标识；"held" 是封闭枚举
      // EVENT_PATTERN_TYPES 中对应 "hold" 时点的值（EVENT_NAMES 的映射），内层
      // source: "self" 是 383.4.d.2.a 所指的同一性锚点（消费方缺失，见 judgeReason）。
      filter: { event: "held", filter: { source: "self" } },
      // 383.2.a.1：紧跟触发条件的两个子句都属于 Trigger Condition。
      condition: {
        kind: "all",
        conditions: [
          {
            kind: "compare",
            left: {
              kind: "count",
              subject: "other-friendly-units-here",
              filter: {
                type: "unit",
                zone: "board",
                controller: "controller",
                // 053.3 的 "here"：与本体同一地点（契约 3.6 的 sameLocationAs 锚点）。
                sameLocationAs: "self",
                // "other"：排除本体自身（355.9.b 的排除限制同用 exclude）。
                exclude: "self"
              }
            },
            operator: "eq",
            right: { kind: "constant", value: 1 }
          }
        ]
      }
    },
    optional: false,
    body: [
      {
        id: "shen-scourge-of-shadows.draw-one",
        op: "effect.draw",
        // 414.3：印刷常量 1；抽牌者缺省为能力控制者（190.6.d）。
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-bc2ea9de6b5b9ec4e65b44cd9a1410db1ee6b06013dbd81fb1d1b5daa675f1af",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两条当前缺口（复核 2026-10-18；均不近似实现）：" +
    "(1) hold 事件没有对象身份：turn/flow.ts 的 scheduleScore 只发射 " +
    "{ timingPoint: \"hold\", player, details: { battlefieldId } }，而 translateTriggerFilter 把 source: \"self\" " +
    "解析成 pattern.object = { objectId }，matchesTriggerObject 对缺少 object 的事件返回 false；" +
    "golden 用真实翻译后的 filter 断言：带匹配 object 时为真、按真实 hold 载荷（无 object）时为假，" +
    "因此 383.4.d.2.a 的「I hold」同一性仍不可匹配。" +
    "(2) 触发条件查询路径没有统一绑定相对控制者：pipeline.ts 的 evaluateTriggerCondition 走 host.context(...).query，" +
    "chain/engine.ts 会绑定 self/opponent 占位符，但游戏侧 host.context.query（apps/game-server engine-runtime/host.ts 的 query → matchesFilter）" +
    "按值比较 controller/owner，controller: \"controller\" 落空 → count 为 0；golden 实测同一条件未绑定查询为 false、绑定控制者后为 true。" +
    "已过时并移除的旧缺口：host.testTrigger 适配器（管线已自带 evaluateCondition 兜底）与 053.3 的 sameLocationAs/exclude 锚点" +
    "（effects/interpreter/selectors.ts 的 queryObjects 已消费）。413/414 的 draw 体与计数路径有真实解释器执行证据。" +
    "依赖：hold 事件的单位身份载荷与相对玩家绑定的统一查询。",
  abilities,
  sourceText: "When I hold, if there is exactly one other unit you control here, draw 1."
} satisfies CardProgram;
