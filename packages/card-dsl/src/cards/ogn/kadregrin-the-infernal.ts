import type { CardProgram } from "../../ir/index.js";

/**
 * Kadregrin the Infernal (ogn-038-298), CR v1.5 706-711 / 355.10.d.
 * 复核（2026-10-17，第三轮 M2 覆盖率复核）：
 * - 触发订阅已可用：RIFT-257 的 programs/ 绑定已合入，`at: "card-played"` +
 *   filter `{ self: true }` 经 translateTriggerFilter 变成
 *   `{ event: "card-played", object: { objectId: <本牌> } }`，golden 断言注册成功
 *   （programs/triggers.ts 对永久物用 activeZones ['board']；383.4.a.2 的 Play Effect）。
 * - 仍缺：集合查询里的 Mighty 数值谓词。CR 707/708/710 要求按**结算时当前图层 Might ≥ 5**
 *   逐个判定在场单位，而 CountExpr 的 filter 只经 ObjectFilter 传输：layers/filter.ts 与链的
 *   ctx.query（chain/engine.ts）对未知键一律**静默忽略**（已实测：mightGte 完全不参与筛选，
 *   会 fail-open 把 4 Might 单位也计入），keywords/Mighty.ts 的 mightyCondition 只能比较
 *   单一宿主自身，尚未有消费方把该谓词施加到每个候选。RIFT-359 分支（4f4b5b2）扩充的是
 *   事件/结果谓词（played-from-hand、event-printed、result），不含集合查询的 Mighty 谓词，
 *   且未合入 HEAD。**不能**退化成「友方单位总数」计数。
 */
const kadregrinTheInfernal = {
  canonicalCardId: "card.hash-398b3826ce23339dadae173c5f1fa39994abe8d2eed99f68d1de01806763d379",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺集合查询的 Mighty 数值谓词：CR 707/708/710 要求友方在场单位按结算时当前图层 Might >= 5 逐候选计数。" +
    "CountExpr 的 filter 只走 ObjectFilter，layers/filter.ts 与链的 ctx.query 对未知键静默忽略" +
    "（实测 mightGte 不参与筛选，4 Might 单位也会被计入），keywords/Mighty.ts 的 mightyCondition" +
    "只能比较单一宿主自身。需把该谓词施加到每个候选（进行中：RIFT-359 分支 4f4b5b2 只扩充事件/结果谓词，" +
    "未合入 HEAD，且不含集合查询 Mighty 谓词）。不能把普通友方单位计数当成 Mighty 计数。" +
    "其余部分已可执行：RIFT-257 的 card-played 自引用触发注册（383.4.a.2）与 effect.draw 计数抽牌（414）。",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { self: true } },
      optional: false,
      body: [
        {
          id: "kadregrin.draw-per-mighty",
          op: "effect.draw",
          args: {
            amount: {
              kind: "count",
              subject: "units",
              filter: { type: "unit", controller: "self", zone: "board", mightGte: 5 }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play me, draw 1 for each of your [Mighty] units. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default kadregrinTheInfernal;
