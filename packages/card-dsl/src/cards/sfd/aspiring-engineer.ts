import type { CardProgram } from "../../ir/index.js";

/**
 * Aspiring Engineer (sfd-061-221) — Unit, Mind, Piltover.
 * energy 3, power 1 (Mind), Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-061-221，逐字）:
 *   "When you play me, return a gear from your trash to your hand."
 *
 * 规则依据（CR v1.5）:
 * - "When you play me"（383.4.a / 383.4.a.1、420.4.a）：Play Effect，在打出动作完成后进链；
 *   封闭时点 card-played，filter 用契约 3.6 的符号选择器 { source: "self" } 指称本卡。
 * - "return a gear from your trash to your hand"：Trash 是 Public Zone（108.2.d、355.10.a），
 *   玩家指定的那张 gear 是目标（355.7）；类型在任意区域都生效（141.2.b/148.2.b），
 *   因此 filter 用 type: "gear" + zone: "trash"。"your trash" 用 owner: "self"（PlayerSelector
 *   的规范写法；chain/engine.ts 的 Finalize/query 包装把 controller/owner 的 "self" 归一化为
 *   item 的控制者，190.6.d 的 "you"）；
 *   「your」= 能力控制者（190.6.d）。区域移动用封闭 GameAction return-to-hand，经
 *   effect.zone 的 to: "hand" 提交（目的地按拥有者路由由内核处理，见 ogn/morbid-return 同型写法）。
 * - 355.12/355.9：选择在 Finalize 完成并触发「成为目标」类触发；结算时按 359.3.e.5–e.8 重验，
 *   目标全部失效 → ignored。
 *
 * status 判定（cards/README.md 第 2 节）：executable。
 * effect.zone（trash→hand）与 card-played triggered 形状均已合入，golden 用解释器 + 参考内核
 * 真实执行整条 body（含目标失效分支）。触发订阅进链的生产管线接线与其它已合入触发卡一样
 * 记录为 test.todo（RIFT-120），不影响本卡能力本身的表达。
 */
const program = {
  canonicalCardId: "card.hash-42c6dcbbb2a43d71583d7fd72c03eb1e7cc0b4d8cb1b53e989180e14f02d2ce1",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
      optional: false,
      body: [
        {
          id: "aspiring-engineer.return-gear",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "aspiring-engineer.gear-in-trash" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "aspiring-engineer.gear-in-trash",
              filter: { type: "gear", zone: "trash", owner: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play me, return a gear from your trash to your hand."
} satisfies CardProgram;

export default program;
