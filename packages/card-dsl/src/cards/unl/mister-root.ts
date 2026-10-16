import type { CardProgram } from "../../ir/index.js";

/**
 * Mister Root (unl-127-219) — Unit, Chaos, tags Fae / Ionia。
 * catalog：energy 2、power null（无印刷力量）、might 1。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-127-219，逐字）：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost
 *   to have me enter ready.)
 *   When I move to a battlefield, gain 2 XP.
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805.1/805.1.a/805.1.b）：单位上的可选附加费用关键词，费用固定为
 *   [1][C]（805.1.b.1：有域单位的 Power 只能与自身某一域匹配）；805.4 多个实例冗余。
 *   卡内只声明 `{ kind: "keyword", keyword: "accelerate" }`（契约 3.7 第 5 节），
 *   展开由 effects/keywords/Accelerate.ts 负责。
 * - “When I move to a battlefield”：421.1 / 449.1 / 449.2 定义 Move；458/458.1 规定 Recall
 *   不是 Move、不触发移动能力。封闭时点 object-moved（timing-points.ts，refs 421.1/449.1/
 *   449.2/458）用于“成功完成 Move”；“到战场”由内层 filter 的 source: self 与
 *   终点限定表达（见 judgeReason：该载荷与锚点当前不可判定）。
 * - “gain 2 XP”：effect.xp 已合入（730.1 / 733；获得者缺省为能力控制者，190.6.d）。
 *
 * status = judge-required（缺口不近似实现）：
 * - Accelerate 的展开文件虽已合入，但合并内核没有任何生产方把卡牌上的 keyword 能力接进
 *   打出流程（cost/cost-plan.ts 只消费调用方传入的 optionalAdditional，accelerate.cost
 *   静态效果没有图层消费方，因此 805.2.b/805.6 的“付费后就绪进场”不成立）；
 * - “When I move to a battlefield” 的触发在已合入代码里无法诚实订阅：
 *   events/action-adapter.ts 为 move-location 生成的事件不填 toZone/toKind/
 *   toLocationId（timing-points.ts 声明的 payloadFields），内层 filter 锚点
 *   （source: "self"）也没有消费方（pipeline-match.ts 只读 EventPattern 的
 *   object/source/target/player/fromZone/toZone/amount/details），449.1/449.2 的起点终点与
 *   458/458.1 的 Recall 排除都无法判定。
 * 已合入且可执行的是触发效果本体：golden 用解释器 + 参考内核真实执行 effect.xp（2 XP）。
 *
 * 依赖：RIFT-84 / RIFT-89（Accelerate 的打出流程接线）、RIFT-120（移动时点载荷与
 * 卡牌触发注册）。
 */
export default {
  canonicalCardId:
    "card.hash-2f32c6395b7dc0bd6975c6b7bb280cc4c1c63da74289ee612c41dd38e92b8074",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) [Accelerate] 的展开（effects/keywords/Accelerate.ts：accelerate.cost 静态费用 + " +
    "805.6 入场就绪替代）已合入，但没有任何生产方把卡牌上的 keyword 能力接进打出流程——cost/cost-plan.ts 只消费" +
    "调用方传入的 optionalAdditional，accelerate.cost 也没有图层消费方，805.1.b.1 的域匹配与 805.2.b/805.6 的" +
    "延迟替代都不生效。(2) 「When I move to a battlefield」无法诚实订阅：events/action-adapter.ts 为 move-location " +
    "生成的事件不填 toZone/toKind/toLocationId（timing-points.ts 声明的 payloadFields），内层 filter 锚点 " +
    "source: self 也没有消费方（pipeline-match.ts 只读 EventPattern 的 object/source/target/player/fromZone/toZone/" +
    "amount/details），449.1/449.2 的起点终点与 458/458.1 的 Recall 排除无从判定。" +
    "触发效果本体 effect.xp（730.1）已合入，golden 用解释器 + 参考内核真实执行；“gain 2 XP”不因上述缺口而近似。" +
    "依赖：RIFT-84 / RIFT-89（Accelerate 打出流程接线）、RIFT-120（移动时点载荷与卡牌触发注册）。",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        filter: {
          event: "object-moved",
          // 449.1/449.2：“移动到战场”的终点限定；该载荷当前不被填充（见 judgeReason）。
          toZone: "battlefield",
          // “I move”：来源即本卡的移动（458/458.1 的 Recall 排除同样依赖该锚点）。
          filter: { source: "self" }
        }
      },
      optional: false,
      body: [
        {
          id: "mister-root.gain-xp",
          op: "effect.xp",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
    "When I move to a battlefield, gain 2 XP."
} satisfies CardProgram;
