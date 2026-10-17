import type { CardProgram } from "../../ir/index.js";

/**
 * Trifarian War Camp (ogn-294-298) — Battlefield, Colorless.
 *
 * sourceText: Units here have +1 :rb_might:. (This includes attackers.)
 *
 * CR v1.5 anchors:
 * - 479.2.b / 479.3.b: "have" is an ability-altering (static) effect granted
 *   by this Battlefield's ability; 479.4 / 479.4.a: the "+1 Might" arithmetic is
 *   the Arithmetic layer (479.4.e.1: increases first).
 * - 190.6: control of a Battlefield determines control of its abilities, so the
 *   effect belongs to the Battlefield and applies while it is in use.
 * - 053.3: "here" refers to this Battlefield; the reminder text points out the
 *   designation is irrelevant ("This includes attackers" — Combat does not
 *   remove the unit from the location).
 * - 652.2.c: if the Battlefield stops applying the effect (owner conceded), the
 *   buff immediately ends — the effect is tied to the source being in use.
 *
 * Status: judge-required: the static ability is authored with the contract 3.1
 * shape the layers system consumes (continuous.might, arithmetic, add), and the
 * merged layers engine (RIFT-258/91) evaluates the arithmetic modification, but
 * no merged producer turns a CardProgram's static ability into a registered
 * ContinuousEffectSpec for layers/LayerEngine — the card-program lifecycle
 * binder is RIFT-257 (in progress) and registerContinuousEffect still has no
 * production caller; layers/filter.ts also implements no sameLocationAs anchor,
 * so the "here" scope would apply the buff at every Battlefield. The golden test
 * therefore asserts the declared shape and executes the equivalent LayerEngine
 * registration to show the layer math, without claiming the card is executable.
 */
export default {
  canonicalCardId: "card.hash-ca6330500fc019b19ccf0df937fc22945cc8bf28a51c21eaef572c53cc31387f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Units here have +1 :rb_might:」按契约 3.1 / 479.3.b+479.4 写成 static + continuous.might（arithmetic 层、add、值 1），但缺少消费方：" +
    "① 没有任何已合入路径把 CardProgram 的 static 能力注册为 layers/LayerEngine 的 ContinuousEffectSpec（registerContinuousEffect 仍无生产调用方，" +
    "卡牌程序静态能力的生产绑定是 RIFT-257 的 programs/statics.ts 生命周期绑定，进行中）；" +
    "② layers/filter.ts 的 matchesObjectFilter 不实现 053.3 的 here 锚点（sameLocationAs），会把 +1 加到所有战场的单位上（过度应用，不得据此标 executable）；" +
    "③ 战场能力控制者（190.6）与来源在用/离场到期（652.2.c）的注册与失效路径未接。" +
    "依赖：RIFT-257（CardProgram static → ContinuousEffectSpec 注册）、layers/filter.ts 的 sameLocationAs 锚点。不近似实现。",
  sourceText: "Units here have +1 :rb_might:. (This includes attackers.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        // 053.3 + 740.1.a: every unit (both controllers) at this Battlefield.
        // sameLocationAs carries the "here" referent; the merged layers filter
        // does not implement that anchor yet (see judgeReason).
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ]
} satisfies CardProgram;
