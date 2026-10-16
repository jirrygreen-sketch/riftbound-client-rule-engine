import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Royal Entourage (sfd-039-221) — Unit, Calm, Shurima.
 * energy 3, power 1 (Calm), Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-039-221，逐字）:
 *   "When you play me, ready or exhaust a legend."
 *
 * 规则依据（CR v1.5）:
 * - "When you play me"：383.4.a/420.4.a 的 Play Effect，时点 card-played，filter 用
 *   self: true 指称本卡。
 * - "ready or exhaust a legend"：「ready or exhaust」是二选一模式（355.11 类的模式选择），
 *   按契约 3.9 写成 choice.mode，每个模式各带一条已合入原语（effect.ready / effect.exhaust）。
 * - "a legend"：355.10.g 规定「legend you control」不是目标——玩家在结算时挑选（官方例子
 *   正是 "Ready a legend" / "Exhaust an enemy legend"），因此两分支都用结算期的非目标
 *   `choose` 形态（非 TargetSpec），filter 为 type: "legend"。effect.ready.ts 与
 *   effect.exhaust.ts 的文件头都把这两句印文列为各自 choose 参数的范例。
 * - 416.1/415.1：ready 与 exhaust 各自是独立 GameAction，由两条原语提交。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 传奇的来源区域是 Legend Zone（CR 107.4/174.2.b "Legends … start the game in the Legend
 *   Zone and cannot typically leave it"），而契约的 ZoneId 只含 hand/deck/rune-deck/trash/
 *   banishment/board/rune-zone/chain（effects/contract.ts），参考内核也没有该区域：
 *   choose 的 filter 无法锚定 Legend Zone 中的传奇，golden 无法构造合法局面（只能用
 *   合成的 legend 引用做原语层执行）。effect.ready.ts/effect.exhaust.ts 的文件头记录了同一缺口。
 * - 另有结算期 choose 的接线缺口：生产线路径（chain/interpreter-adapter.ts）只为白名单字段
 *   解包 Expr，未解包 effect.ready 的 objects / effect.exhaust 的 choose，两条 choose 分支
 *   目前都到不了原语。
 * 依赖：契约变更（ZoneId/ZoneDestination 增补 legend-zone，并让结算期 choose 的目标空间覆盖
 * 该区域）、目标/选择批次接线（RIFT-89/90）。不近似实现（不把 legend 当作 board 上的对象，
 * 也不用固定 seat 的假引用）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "royal-entourage.mode",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              {
                id: "royal-entourage.ready-mode",
                body: [
                  {
                    id: "royal-entourage.ready-legend",
                    op: "effect.ready",
                    args: {
                      objects: {
                        kind: "constant",
                        value: {
                          kind: "choose",
                          id: "royal-entourage.choose-legend-to-ready",
                          filter: { type: "legend" },
                          min: 1,
                          max: 1,
                          prompt: "Choose a legend to ready."
                        }
                      }
                    }
                  }
                ]
              },
              {
                id: "royal-entourage.exhaust-mode",
                body: [
                  {
                    id: "royal-entourage.exhaust-legend",
                    op: "effect.exhaust",
                    args: {
                      choose: {
                        kind: "constant",
                        value: {
                          id: "royal-entourage.choose-legend-to-exhaust",
                          filter: { type: "legend" },
                          prompt: "Choose a legend to exhaust."
                        }
                      },
                      amount: { kind: "constant", value: 1 }
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-a32cc7d6df90c5796f8d933adb5747a302972d467cce6c5c691af4ece82b4429",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「ready or exhaust a legend」的 or 模式（契约 3.9 的 choice.mode）与 effect.ready/effect.exhaust 原语都已合入，" +
    "355.10.g 也明确「a legend」不是目标、应在结算时由控制者选择（本卡用两条原语的 choose 结算期选择形态表达），" +
    "但传奇的来源区域 Legend Zone（CR 107.4/174.2.b）不在契约的 ZoneId 词汇里" +
    "（effects/contract.ts 只有 hand/deck/rune-deck/trash/banishment/board/rune-zone/chain；effect.ready.ts 与 effect.exhaust.ts 的文件头记录同一缺口），" +
    "参考内核也没有该区域，choose 的 filter 无法锚定 Legend Zone 中的传奇，golden 无法构造合法局面。" +
    "另有结算期 choose 的接线缺口：chain/interpreter-adapter.ts 只为白名单字段解包 Expr，未解包 effect.ready 的 objects 与 effect.exhaust 的 choose，" +
    "两条 choose 分支目前都到不了原语。依赖：契约变更（ZoneId/ZoneDestination 增补 legend-zone，并让结算期 choose 覆盖该区域）与目标/选择批次接线（RIFT-89/90）。" +
    "不近似实现（不把 legend 当作 board 上的对象，也不用固定 seat 的假引用）。",
  abilities,
  sourceText: "When you play me, ready or exhaust a legend."
} satisfies CardProgram;

export default program;
