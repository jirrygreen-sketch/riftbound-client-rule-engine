import type { CardProgram } from "../../ir/index.js";

/**
 * Cithria of Cloudfield (ogn-139-298) — Unit, 2 energy, no printed power
 * (Body), 1 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-139-298):
 *   When you play another unit, buff me. (If I don't have a buff, I get a
 *   +1 :rb_might: buff.)
 *
 * 规则依据（CR v1.5）：
 * - “When you play another unit”：打出触发（420.4.a 打出完成后触发；时点
 *   card-played）。触发条件是「你打出了另一个单位」——请 2693 行 383.4.a.4：
 *   “Abilities that trigger when another object is played are not considered Play
 *   Effects.”，故 filter 描述的是“另一个单位的打出事件”，而非本卡的 Play Effect。
 * - “buff me”：effect.buff（702.2.a 放置一个 buff counter；702.3/702.3.a 已有 buff
 *   时不放置）。“me” 是宿主自身，不是选择目标（355.10.d）；但 effect.buff 的 target
 *   参数只接受 TargetSpec id，故这里按同类已合入示例（sfd/fiora-peerless.ts）只写
 *   描述性的 target 占位值 "self"，不声明 TargetSpec、不伪造 ObjectRef。
 *
 * status: judge-required —— 触发条件与宿主选择两项仍无法在已合入实现中表达：
 * 1. “another unit”（与你打出的另一张单位牌）：已合入的 matchesTriggerEvent
 *    （events/pipeline-match.ts，RIFT-120）只读取 EventPattern 顶层的 object/source/
 *    target 与其标量键，本卡声明的内层 `filter` 描述性对象不会被消费；它也没有
 *    「另一张牌 / 排除宿主」谓词（ObjectSelector 的 `exclude` 锚点只作用于解释器的
 *    集合查询）。依赖事件管线的“另一对象”触发过滤（后续任务）。
 * 2. “buff me” 缺少原语内的宿主选择器：effect.buff 的 `target` 参数只接受 TargetSpec id
 *    （内部读 ctx.targets(target)），没有 effect.ready 的 objects: {kind: "source"} 形式；
 *    解释器的 target 过滤也不消费 `{ object: "self" }` 锚点（layers/filter.ts 只按
 *    标量键比较），伪造 TargetSpec 会把程序化指定当成选择目标或错选其他单位，
 *    违反 355.10.d，故不写 targets（契约变更请求见任务回复）。
 * 3. card-played 时点由 chain/engine.ts 发射；CardProgram 触发注册属 RIFT-257。
 * effect.buff 本体（702.2.a / 702.3.a）本身已合入，不近似实现整卡。
 */
export default {
  canonicalCardId: "card.hash-7d31737a3d92e21d8b50470d4b5950e617327bd7ac418492d9739ccca96ecbad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "1) 触发条件「你打出另一个单位」无法表达：已合入的 matchesTriggerEvent（events/pipeline-match.ts，RIFT-120）只读取 " +
    "EventPattern 顶层的 object/source/target 与其标量键（player/fromZone/toZone/amount/details），本卡程序里的内层 filter " +
    "不会被消费；它也没有「另一张牌 / 排除宿主」谓词，ObjectSelector 的 exclude 锚点只作用于解释器集合查询，不作用于触发过滤" +
    "（383.4.a.4 要求这是“另一个对象被打出”的触发）。依赖事件管线的“另一对象”触发过滤（后续任务）。" +
    "2)「buff me」缺少原语内的宿主选择器：effect.buff 的 target 参数只接受 TargetSpec id（内部读 ctx.targets），" +
    "没有 effect.ready 的 objects: {kind: \"source\"} 形式；解释器的 target 过滤（layers/filter.ts）也不消费 {object: \"self\"} 锚点，" +
    "伪造 TargetSpec 会错选其他单位或把程序化指定当成选择目标，违反 355.10.d，故不写 targets（契约变更请求见任务回复）。" +
    "effect.buff 本体（702.2.a / 702.3.a）本身已合入，golden 用真实原语执行 buff 与「已有 buff 不再放置」边界；CardProgram 触发注册属 RIFT-257。不近似实现整卡。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          filter: { type: "unit", controller: "controller", other: true }
        }
      },
      optional: false,
      body: [
        {
          id: "cithria.buff-self",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "self" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play another unit, buff me. (If I don't have a buff, I get a +1 :rb_might: buff.)"
} satisfies CardProgram;
