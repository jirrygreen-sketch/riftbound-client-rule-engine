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
 * - 给「有 buff 的友方单位」授予 Deflect 需要 keyword-grant 持续效果，并且过滤条件要能读
 *   Buff 计数（ObjectSnapshot.buffs > 0）；引擎内部 registerReplacement 之外的持续效果注册
 *   路径与 buffs 过滤器均未接通到卡牌 IR（continuous.grant-keyword 没有已合入实现）；
 * - Deflect 自身的展开（target.tax，809.1.c）已由 keywords/Deflect.ts 声明，但仍依赖
 *   RIFT-90 的目标税适配。
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
    "「Friendly buffed units have [Deflect] if they didn't already.」需要给“有 buff 的友方单位”" +
    "授予 Deflect（809.1/809.2，关键词授予 = continuous.grant-keyword 持续效果）：目前没有已合入的" +
    "关键词授予消费路径，且图层过滤器还不能读 Buff 计数（ObjectSnapshot.buffs / 702 的 counter 判定" +
    "在 ObjectFilter 里没有对应字段）；Deflect 的 target.tax 展开依赖 RIFT-90 的目标税适配。" +
    "Play Effect 触发与「buff a friendly unit」（702.2.a、702.3.a 的已有 buff 不重复）已用已合入的" +
    "effect.buff 原语真实执行。依赖：RIFT-91（layers-continuous）、RIFT-84（kw-deflect-hidden 的" +
    "授予接线）、RIFT-90（batch3-target-plan）。不近似实现。",
  abilities,
  sourceText:
    "When you play this, buff a friendly unit. (If it doesn't have a buff, it gets a " +
    "+1 :rb_might: buff.)\nFriendly buffed units have [Deflect] if they didn't already. " +
    "(Opponents must pay :rb_rune_rainbow: to choose those units with a spell or ability.)"
} satisfies CardProgram;

export default program;
