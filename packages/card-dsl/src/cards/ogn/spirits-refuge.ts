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
 * status = judge-required：
 * - continuous.grant-keyword 原语（RIFT-258）、ability 图层消费与 Deflect KeywordDef
 *   （RIFT-84）均已合入，Buff 计数经 ObjectFilter.characteristics 可读（layers/filter.ts
 *   的 characteristicsMatch），授予指令本身可用解释器真实执行（见 golden）；
 * - 但没有任何已合入消费方把卡牌的 static 能力注册成图层效果（卡牌程序绑定 RIFT-257），
 *   且「if they didn't already」需要图层条件词表能表达“尚无 Deflect”（现有
 *   always/never/type/has-tag/has-keyword 无法取反，未知条件按 true），直接绑定会忽略
 *   该限制并牵动已有 Deflect 的单位（809.2 的求和）；
 * - Deflect 自身的展开（target.tax，809.1.c）已由 keywords/Deflect.ts 声明，但没有从
 *   图层读取关键词并生成目标税的消费方（target tax adapter）。
 * 已合入部分：Play Effect 触发 + effect.buff（含 702.3 的“已有 buff 不重复”），
 * golden 测试真实执行。
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
    "「Friendly buffed units have [Deflect] if they didn't already.」：continuous.grant-keyword 原语" +
    "（RIFT-258）、ability 图层消费与 Deflect KeywordDef（RIFT-84）已合入，Buff 计数可由 " +
    "ObjectFilter.characteristics 读取（layers/filter.ts 的 characteristicsMatch），授予指令已在 golden 中" +
    "经解释器 + 图层引擎真实执行；整卡仍缺：(1) 把卡牌 static 能力注册进图层的消费方（卡牌程序绑定 RIFT-257），" +
    "(2)「if they didn't already」在图层条件词表中无法表达“尚无 Deflect”——809.2 要求把新增授予与已有 Deflect 求和、不重复，而" +
    "always/never/type/has-tag/has-keyword 不可取反且未知条件按 true，直接绑定会忽略该限制并牵动已有 Deflect 的单位；" +
    "(3) Deflect 展开（809.1.c 的 target.tax）没有从图层关键词" +
    "生成目标税的适配消费方。Play Effect 触发与「buff a friendly unit」（702.2.a、702.3.a）已用已合入的 " +
    "effect.buff 原语真实执行。依赖：RIFT-257（卡牌 static/triggered 绑定）、RIFT-90（目标系统/目标税）与图层条件取反。" +
    "不近似实现。",
  abilities,
  sourceText:
    "When you play this, buff a friendly unit. (If it doesn't have a buff, it gets a " +
    "+1 :rb_might: buff.)\nFriendly buffed units have [Deflect] if they didn't already. " +
    "(Opponents must pay :rb_rune_rainbow: to choose those units with a spell or ability.)"
} satisfies CardProgram;

export default program;
