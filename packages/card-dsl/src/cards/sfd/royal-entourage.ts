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
 * - RIFT-257 修正了一条旧结论：生产线路径（chain/interpreter-adapter.ts）现在把整包 args
 *   交给原语的 argsSchema（primitiveArgs），只有 effect.counter / effect.buff 等白名单字段
 *   会被解包，effect.ready 的 objects 与 effect.exhaust 的 choose 仍按原语自己的 schema 解析。
 *   实测：effect.ready 的 choose 形状在参考内核上真实执行并改写 legend 的就绪状态；
 *   effect.exhaust 的 choose 在 choose 已是字面对象时同样可执行。
 * - 仍有两处缺口：
 *   1. effect.exhaust 只接受字面 choose 对象，本卡写的是 Expr 包装
 *      （{ kind: "constant", value: { id, filter, prompt } }），原语以
 *      "effect.exhaust choose requires a stable non-empty choice id" 拒绝。
 *   2. 传奇来源区域不在契约里：CR 107.4/174.2.b 的 Legend Zone 未列入 ZoneId
 *      （effects/contract.ts 只有 hand/deck/rune-deck/trash/banishment/board/rune-zone/chain），
 *      game/lifecycle.ts 的 legend 也先落在 chain 区，choose 的 filter 无法锚定真实传奇区，
 *      golden 只能用合成 legend 引用做原语层执行。
 * 依赖：契约变更（ZoneId/ZoneDestination 增补 legend-zone，并让结算期 choose 的目标空间覆盖
 * 该区域）、effect.exhaust.choose 的 Expr 解包或卡牌拼写对齐（RIFT-89/90 后续）。不近似实现
 * （不把 legend 当作 board 上的对象，也不用固定 seat 的假引用）。
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
    "但仍有两处缺口，不近似实现：" +
    "(1) effect.exhaust 只接受字面 choose 对象，本卡写的 Expr 包装（{ kind: constant, value: { id, filter, prompt } }）会被原语以" +
    "「effect.exhaust choose requires a stable non-empty choice id」拒绝（实测：字面值可真实执行并改写就绪状态）；" +
    "(2) 传奇的来源区域 Legend Zone（CR 107.4/174.2.b）不在契约的 ZoneId 词汇里（effects/contract.ts 只有 " +
    "hand/deck/rune-deck/trash/banishment/board/rune-zone/chain），game/lifecycle.ts 的 legend 也先落在 chain 区，" +
    "choose 的 filter 无法锚定真实传奇区，golden 只能用合成 legend 引用做原语层执行。" +
    "RIFT-257 之后 interpreter-adapter 已把整包 args 交给原语 schema，因此 effect.ready 的 choose 分支实测能真实执行。" +
    "依赖：契约变更（ZoneId/ZoneDestination 增补 legend-zone，并让结算期 choose 覆盖该区域）与 effect.exhaust.choose 的 Expr 解包/拼写对齐（RIFT-89/90 后续）。",
  abilities,
  sourceText: "When you play me, ready or exhaust a legend."
} satisfies CardProgram;

export default program;
