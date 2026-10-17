import type { CardProgram } from "../../ir/index.js";

/**
 * Karma, Channeler (ogn-235-298), CR v1.5 417.1 / 052 / 161.1 / 817.1.c / 437.1.
 * 当前复核：buff 与显式有序 picks 下的 Predict 子效果可执行；仍缺回收批次聚合、
 * 符文排除和真正执行回收的玩家身份。Vision 还缺自身入场过滤、控制者与顶牌绑定。
 */
const karmaChanneler = {
  canonicalCardId: "card.hash-65e0ab54a0954e391f643dc900a7a0faa2cd298faa850e7c436e13659498922d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺回收事件语义与 Vision 接线：effect.recycle 按牌提交 recycle，card-recycled 没有批次 batchId 或 per-batch 去重，" +
    "不能实现 one or more cards 每批只触发一次（417.1）；当前仅 controller 过滤也未排除符文（052/161.1）。" +
    "recycle GameAction 不携带执行玩家，action-adapter.ts 从被回收对象的 controller 推导 player，" +
    "不能覆盖回收他人牌时的 you（417.1.c）。Vision 展开体的 object.id=self 被 programs/filters.ts 拒绝；" +
    "effect.inspect 仍固定 player=A，且无结算期按真实控制者主牌库顺序生成 vision-top picks 的绑定（817.1.c/437.1）。",
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "When you recycle one or more cards, buff a friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff. Runes aren't cards.)",
  abilities: [
    { kind: "keyword", keyword: "vision" },
    {
      kind: "triggered",
      trigger: {
        at: "card-recycled",
        // 暂存过滤：能注册，但不能等价表达「你回收牌」；执行玩家身份与符文排除
        // 尚缺接线（见 judgeReason），不得据此把整卡提升为 executable。
        filter: { controller: "self" }
      },
      optional: false,
      body: [
        {
          id: "karma-channeler.buff-friendly-unit",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "karma-channeler.friendly-unit" }
          },
          targets: [
            {
              id: "karma-channeler.friendly-unit",
              filter: { type: "unit", zone: "board", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default karmaChanneler;
