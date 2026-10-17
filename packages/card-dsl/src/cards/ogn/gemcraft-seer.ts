import type { CardProgram } from "../../ir/index.js";

/**
 * Gemcraft Seer (ogn-100-298) — Unit, 3 energy + 1 Power, 3 Might, Mind,
 * Mount Targon.
 *
 * Printed text:
 *   [Vision] (When you play me, look at the top card of your Main Deck. You
 *   may recycle it.)
 *   Other friendly units have [Vision].
 *
 * Status: judge-required.
 * - [Vision] (817.1.b/c) is merged (effects/keywords/Vision.ts) and its Predict
 *   steps run through the interpreter + reference kernel (golden test).
 * - "Other friendly units have [Vision]" is a static ability-layer keyword
 *   grant (contract 3.4/3.7: continuous effects never enter the chain). The
 *   layer binder currently rejects the Vision trigger's `object.id` event
 *   filter and rejects the static grant's `exclude: "self"` anchor, so the
 *   complete grant cannot be registered. "Other" also needs the source
 *   excluded, which the declared filter records.
 *   Not approximated (a SelfScope Vision re-declaration would double-count
 *   Vision, contrary to 817.2).
 *
 * The grant filter follows the static-grant spelling used by the same family:
 * `controller` is the ability-controller placeholder and `exclude: "self"` is
 * the source-relative anchor for "other".
 */
export default {
  canonicalCardId: "card.hash-636736b78f865097117f9cc183f462f662d5b234a87f487fd261ac54279875c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Other friendly units have [Vision]」需要静态 grant 的 layer 注册与 source-relative 排除；" +
    "当前 Vision 触发过滤含有 binder 不支持的 object.id 字段，静态 grant 又含有 binder 不支持的 exclude:self 锚点，" +
   "所以无法同时证明 Vision 触发和 other-friendly 授予的完整执行链。" +
   "另外 Vision 展开体的 effect.inspect 仍固定 player:A 占位，生产侧也没有在每次结算时向其注入真实控制者与有序 vision-top picks；" +
   "[Vision]（817）本体已合入并可在参考内核执行，不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "vision" },
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Vision",
        filter: {
          type: "unit",
          controller: "controller",
          zone: "board",
          exclude: "self"
        }
      }
    }
  ],
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "Other friendly units have [Vision]."
} satisfies CardProgram;
