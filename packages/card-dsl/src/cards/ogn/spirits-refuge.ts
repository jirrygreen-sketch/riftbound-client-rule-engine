import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Spirit's Refuge (ogn-063-298) — Gear, 2 Energy + 1 Calm power, Calm.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-063-298):
 *   When you play this, buff a friendly unit. (If it doesn't have a buff, it gets
 *   a +1 :rb_might: buff.)
 *   Friendly buffed units have [Deflect] if they didn't already. (Opponents must
 *   pay :rb_rune_rainbow: to choose those units with a spell or ability.)
 *
 * 规则依据（CR v1.5）：
 * - “When you play this, …” 是 Play Effect（383.4.a.1：Gear 写作 “When you play this…”；
 *   383.4.a.2：永久物结算并进场后进链），对应时点 card-played。
 * - “buff a friendly unit” 是 Buff 动作（702.2.a：选择一名 Unit 并放置 buff；
 *   702.3/702.3.a 已有 buff 的单位不会被再次 buff）。这是目标选择（355.10；
 *   “a friendly unit” 是己方单位，740.1.a），指令体用已合入的 effect.buff 原语，
 *   mode: "buff"，目标为所选单位；golden 测试用解释器 + 参考内核真实执行。
 * - “Friendly buffed units have [Deflect] if they didn't already.” 是
 *   持续关键词授予：给所有「有 buff 的友方单位」附加 Deflect（809：被动关键词，
 *   形式 “Deflect [X]”，X 省略时为 1；809.3 该关键词是永久物的特征），
 *   “if they didn't already” 对应 809.2 的求和/冗余判定（已拥有 Deflect 时不重复）。
 *   过滤条件用 ObjectFilter 的 characteristics 字段读单位特征（702 的 buff counter 计数）；
 *   702.3/702.3.a 规定一名单位通常只有一个 Buff，因此特征值 1 即「buffed」。
 *   契约 3.7 把关键词授予归 continuous.keyword / continuous.grant-keyword 持续效果，
 *   图层在 ability 层把关键词加到目标快照上。
 *
 * status = judge-required（复核 2026-10-18）：
 * - effect.buff、Buff 过滤、continuous.grant-keyword 和静态绑定均已有执行证据。
 * - “if they didn't already” 仍缺逐候选单位的否定关键词谓词；直接授予会按
 *   809.2 叠加，不能替代本卡的“不重复授予”。
 * - KeywordGrantLayerEngine 已能展开授予的 Deflect；createTargetTaxAdapter 已能把
 *   该关键词计为任意域 Power，golden 检查真实目标 Finalize 与费用分配。
 *   但默认 ChainEngine 未接入这两个适配器：默认 static binder 仍无 target.tax
 *   映射，链自行收集 tax.amount 后写成 Energy mandatoryAdditional（违反 809.1.c.1）。
 * 适配器执行证据不代表整卡或默认链路已可执行。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // “When you play this” — Gear 的 Play Effect（383.4.a.1）。事件过滤按
      // ObjectFilter 的 canonicalCardId 字段指向本卡自身的打出事件（EventPattern.object）。
      filter: {
        event: "card-played",
        object: {
          canonicalCardId:
            "card.hash-02d796287ee81a01d4db75cbc8913926d5faa0dda54e2bf07f4412ef09acf073"
        }
      }
    },
    optional: false,
    body: [
      {
        id: "spirits-refuge.buff-friendly-unit",
        // “buff a friendly unit.” — 702.2.a 的 Buff 动作；已有 buff 的单位按 702.3.a
        // 不再获得（effect.buff 的真实行为）。
        op: "effect.buff",
        args: {
          mode: { kind: "constant", value: "buff" },
          target: { kind: "constant", value: "spirits-refuge.friendly-unit" }
        },
        targets: [
          {
            id: "spirits-refuge.friendly-unit",
            filter: { type: "unit", controller: "controller", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  },
  {
    kind: "static",
    // “Friendly buffed units have [Deflect] if they didn't already.” — 持续关键词授予；
    // 过滤条件需要读 Buff 计数（buffs > 0），见 judgeReason。
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "Deflect",
      value: { kind: "constant", value: 1 },
      filter: {
        zone: "board",
        type: "unit",
        controller: "controller",
        // 702：buff 是单位上的 counter；702.3/702.3.a 限定一名单位通常只带 1 个 Buff，
        // 所以读特征 buffs = 1 即「buffed」。真正的特征读取与关键词授予由图层接管
        // （见 judgeReason）。
        characteristics: { buffs: 1 }
      }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-02d796287ee81a01d4db75cbc8913926d5faa0dda54e2bf07f4412ef09acf073",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "当前缺口（复核 2026-10-18）：(1)「Friendly buffed units have [Deflect] if they didn't already」" +
    "缺逐候选单位读取已有 Deflect 的否定关键词谓词；直接 continuous.grant-keyword 会按 809.2 " +
    "把已有 Deflect 数值相加，不能表达本卡的不重复授予。(2) 默认 ChainEngine / attachProgramLifecycle " +
    "未接入 KeywordGrantLayerEngine 的授予关键词展开与 createTargetTaxAdapter 的完整费用计划：" +
    "programs/statics.ts 仍拒绝 target.tax（target.tax has no layer mapping），chain/engine.ts " +
    "自行收集 tax.amount 后记为 Energy mandatoryAdditional，违反 809.1.c.1 的任意域 Power 要求。" +
    "依赖：候选单位关键词谓词、默认链路的动态关键词与目标税适配器集成。不近似实现。",
  abilities,
  sourceText:
    "When you play this, buff a friendly unit. (If it doesn't have a buff, it gets a " +
    "+1 :rb_might: buff.)\nFriendly buffed units have [Deflect] if they didn't already. " +
    "(Opponents must pay :rb_rune_rainbow: to choose those units with a spell or ability.)"
} satisfies CardProgram;

export default program;
