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
 * status = judge-required（复核 2026-10-17，两处缺口均可实测）：
 * - effect.buff、continuous.grant-keyword、Buff 特征过滤和 static 图层绑定都能用解释器
 *   与测试内核真实执行（见 golden）；
 * - 但「if they didn't already」需要在每个候选单位上读取已有 Deflect：过滤/条件词表没有
 *   可求值的否定关键词谓词，而授予会按 809.2 把数值**相加**而不是视为冗余——实测对已有
 *   Deflect 2 的单位再授予 1 点会得到 Deflect 3，与印刷文本的「if they didn't already」
 *   相反；
 * - Deflect 的 KeywordDef 只声明 target.tax 展开，而生产 static binder 的 layerFor 没有
 *   该 kind 的图层映射（实测抛 “Static ability kind target.tax has no layer mapping”），
 *   目标管线也只接受调用方显式传入的税；链在收税时把 tax.amount 记为 Energy 的
 *   mandatoryAdditional，而 809.1.c.1 要求这笔税用**任意域 Power** 支付。
 * 已合入部分：Play Effect 触发 + effect.buff（含 702.3 的“已有 buff 不重复”），
 * golden 测试真实执行；另两条缺口各自有真实执行/真实绑定的否定证据。
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
    "两处当前缺口（复核 2026-10-17，均实测）。(1)「Friendly buffed units have [Deflect] if they " +
    "didn't already.」需要在每个候选单位上读取已有 Deflect 的可求值否定关键词谓词：过滤/条件词表" +
    "没有这个谓词，而授予按 809.2 对数值求和而不是视为冗余——实测对已有 Deflect 2 的单位再授予 " +
    "1 点得到 Deflect 3，与印刷文本的「if they didn't already」相反，所以不能直接授予。" +
    "(2) [Deflect] 的 target.tax 没有消费路径：effects/keywords/Deflect.ts 只声明 static target.tax，" +
    "而生产 static binder 的 layerFor 没有该 kind 的图层映射（实测抛「Static ability kind target.tax " +
    "has no layer mapping」）；目标管线只接受调用方显式传入的税，且链把 tax.amount 记为 Energy 的 " +
    "mandatoryAdditional（chain/engine.ts），不符合 809.1.c.1 要求的任意域 Power 支付。" +
    "已合入并由 golden 真实执行：Play Effect 触发、effect.buff（含 702.3 的“已有 buff 不重复”）、" +
    "continuous.grant-keyword 与 Buff 特征过滤的图层授予。不近似实现。",
  abilities,
  sourceText:
    "When you play this, buff a friendly unit. (If it doesn't have a buff, it gets a " +
    "+1 :rb_might: buff.)\nFriendly buffed units have [Deflect] if they didn't already. " +
    "(Opponents must pay :rb_rune_rainbow: to choose those units with a spell or ability.)"
} satisfies CardProgram;

export default program;
