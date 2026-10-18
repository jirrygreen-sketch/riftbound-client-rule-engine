import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Cursed Sarcophagus (unl-148-219) — Gear, 4 energy + 1 Chaos power, Might null（无印刷 Might）。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, unl-148-219）：
 *   "When you play this, banish all units from your trash.\n" +
 *   ":rb_exhaust:: Play a unit banished with this. (You must pay its costs.)"
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1："When you play this" 是 Gear 的 Play Effect，对应时点
 *   card-played（359 / 407），filter 指向本卡自身。
 * - 428.1 / 428.2："banish all units from your trash" 是 Banish 动作；trash 是公开区域
 *   （108.2.d），"all units" 是按特征自动选定的集合（355.10.d：没有可做的选择），
 *   因此用 selection "all" + min 0 的非目标 pick，不是 TargetSpec。
 * - 415.4 / 415.5 / 404.1.a：第二段的 ":rb_exhaust:" 是费用（横置来源），能力本身是
 *   Gear 的启动能力（151 / 151.2）。
 * - "Play a unit banished with this" 引用的是同一张牌印刷文本内的 Linked Ability
 *   （CR 394–398：398 明确规定组件能力只能与同一组能力影响的对象互动）。
 * - "(You must pay its costs.)" 要求按正常 Play 流程支付该单位的印刷费用（420.3）。
 *
 * Status: judge-required. Re-checked 2026-10-18 against merged source:
 * the trash banishment executes and links its receipt (golden), and the normal
 * printed-cost path through effect.play -> Chain Finalize works when the pick is
 * provisioned (golden). The blocker is that record's lifetime and provenance:
 * linked values live on the interpreter/ResolveContext (`ctx.link` writes to the
 * resolving context's link map, and chain/picks/plan.ts computes ordered-pick
 * plans per chain item), so a receipt written while the play effect resolves is gone by the time
 * the activated ability resolves later. Nothing in the merged code stores
 * "units banished with this" per source incarnation for a later activation, so
 * the activated ability cannot limit its choice to this card's own banishment.
 */
const abilities: Ability[] = [
  {
    // 383.4.a.1："When you play this" → card-played（自身打出）。
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "self" } }
    },
    optional: false,
    body: [
      {
        id: "cursed-sarcophagus.banish-trash-units",
        op: "effect.banish",
        args: {
          // 355.10.d / 355.9.a.1："all units from your trash" 是按特征选定的集合，
          // 不是目标，故用非目标 pick 读取（ctx.picks）。
          objects: { kind: "constant", value: { pick: "cursed-sarcophagus.trash-units" } },
          linkKey: { kind: "constant", value: "banishedTrashUnits" }
        },
        picks: [
          {
            id: "cursed-sarcophagus.trash-units",
            // "your trash"：效果控制者的 trash（190.6.d 的隐含 you）。
            options: ["all-units-in-your-trash"],
            filter: { zone: "trash", type: "unit", owner: "self" },
            min: 0,
            max: null,
            selection: "all"
          }
        ]
      }
    ]
  },
  {
    // 151 / 151.2：Gear 的启动能力；费用为横置来源（415.4 / 415.5）。
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      payments: [{ kind: "exhaust", object: "self" }]
    },
    body: [
      {
        id: "cursed-sarcophagus.play-banished-unit",
        op: "effect.play",
        args: {
          // "a unit banished with this"（394–398 / 428.3.a）：本卡的放逐记录没有可执行
          // 读取路径（见 judgeReason），因此用占位选择器保留形状；不去查询整个
          // banishment（那会把其它效果的放逐对象算进来）。
          pick: { kind: "constant", value: "cursed-sarcophagus.unit-banished-with-this" }
          // 不写 location：原文没有指定目的地，单位按 359.2.b / 420.3 的正常 Play
          // 流程决定打出位置（Base 或自己控制的战场），硬写 base 属近似实现。
          // 420.3：省略 cost 覆盖，交给正常 Chain Finalize 读取并支付印刷费用。
        },
        picks: [
          {
            id: "cursed-sarcophagus.unit-banished-with-this",
            options: ["runtime:units-banished-with-cursed-sarcophagus"],
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-fb1cb45cbf77fdbc4ca293043af3cc16004e296598831688330ddb35495711c7",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "仍缺跨能力、按本卡入区身份保存的 Linked Ability 放逐记录（CR 394–398/428.3.a，2026-10-18 复核）：" +
    "放逐本身可执行且会写出 { count, objects, source } 回执（golden 已断言），但该回执只存在于解析该效果时的解释器/ResolveContext linked 作用域——" +
    "同一个响应内可读，跨链项（本卡是触发器解析后再单独启动能力）不可读；chain/picks/plan.ts 的 ordered pick plan 也按链项现算，不是按来源保存的历史。" +
    "合并代码里没有按本卡入区身份持久保存并在下一次启动时恢复的对象关联，effect.play 的 Finalize 选牌因此无法限定为“本卡放逐的单位”，" +
    "也不能退化为查询整个 banishment（会混入其它来源的放逐对象，实测需要外部 provision 才能跑通 golden）。" +
    "已合入并可执行：When you play this 的 trash→banishment 放逐与 effect.play + Chain Finalize 的正常印刷费用支付。",
  abilities,
  sourceText:
    "When you play this, banish all units from your trash.\n" +
    ":rb_exhaust:: Play a unit banished with this. (You must pay its costs.)"
};

export default program satisfies CardProgram;
