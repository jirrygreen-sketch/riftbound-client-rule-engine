import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Invigorating Bloom (rad-035-167) — Unit, 3 energy, no printed Power, 无印刷 Might, Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-035-167）：
 *   When you play this, give a friendly unit +3 :rb_might: this turn.
 *   Exhaust a friendly [Mighty] unit, :rb_exhaust:: Draw 1. (A unit is Mighty while it has
 *   5+ :rb_might:.)
 *
 * ⚠ 数据问题（不改数据，仅报告）：本印刷在本地 deck-catalog 记为 cardType: "Unit"，但既无
 * 印刷力量（power null）也无印刷 Might（might null）；能力文本是“打出触发 + 启动能力”的
 * 单位式写法。程序按任务给定的 sourceText 逐字编写，不擅自补数值或改类型。
 *
 * 规则依据（CR v1.5）：
 * - “When you play this”：打出触发（383.4.a；时点 card-played）。
 * - “give a friendly unit +3 :rb_might: this turn”：临时 Might 修正（continuous.might，
 *   478 / 478.1.a arithmetic 图层），带 “this turn” 期限（317.1.a / 317.2.c：在回合结束清理
 *   同时到期）；选择单位是目标（355.9 / 355.10.a）。
 * - “Exhaust a friendly [Mighty] unit, :rb_exhaust::” 是启动能力的两部分费用：一个指令内
 *   的代价式横置（355.10.c.1 的 “[do X] to [do Y]” 结构，不计为目标）加上横置自身
 *   （415.3.a / 415.5 要求作为费用的横置必须能完成）。706 定义 Mighty 这一描述（非关键词），
 *   707/708 要求 Might ≥ 5，710 规定在场单位按当前（含图层结果）Might 判定。
 * - “Draw 1.”：414.3/414.4 的 Draw；抽牌者是能力控制者（190.6.d 的隐含 “you”）。
 *
 * status = judge-required（不近似实现），当前缺口：
 * 1. “Exhaust a friendly [Mighty] unit” 是费用内的 filter 式对象选择：CostSpec 的
 *    choice 只接受逐项列出的精确 ObjectRef（cost/plan-values.ts 的 choiceObjects 要求每个
 *    option 都是 { id, zoneEntryId }），静态卡程序写不出来；费用种类的 filter 形状属
 *    RIFT-261（cost.pay / cost.modify 与费用种类）范围。
 * 2. [Mighty] 谓词：Mighty 已由 effects/keywords/Mighty.ts 展开为 condition.value 的静态
 *    描述（706–711），但过滤词汇里没有“当前 Might ≥ 5”的谓词，费用选择无法在 Finalize 阶段
 *    按 710 判定场上单位的当前 Might（同 Show of Strength sfd-106-221 的判定）。
 * 已合入并已有执行证据的部分：“give a friendly unit +3 :rb_might: this turn”
 * （continuous.might + end-of-turn 到期）、启动能力的横置自身费用（415.3）、以及
 * effect.draw 的 Draw 1（414.3）——见 golden 的真实执行用例。
 * 依赖：RIFT-261（费用种类 / filter 式对象费用）与当前 Might 谓词的过滤扩展。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "self" } }
    },
    optional: false,
    body: [
      {
        // “give a friendly unit +3 :rb_might: this turn” — arithmetic 图层的临时修正
        // （478.1.a），317.2.c 在回合结束到期；选择友方单位是目标（355.10.a）。
        id: "invigorating-bloom.give-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 3 },
          duration: { kind: "constant", value: "end-of-turn" },
          // 连续效果指令的 objects 拼写（契约 3.6），求值结果为 { kind: "target", id }。
          objects: {
            kind: "constant",
            value: { kind: "target", id: "invigorating-bloom.friendly-unit" }
          }
        },
        targets: [
          {
            id: "invigorating-bloom.friendly-unit",
            filter: { type: "unit", zone: "board", controller: "controller" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  },
  {
    kind: "activated",
    // “Exhaust a friendly [Mighty] unit, :rb_exhaust::” — 两部分都是启动费用：一个指令内的
    // 代价式横置（355.10.c.1，不选目标）加上横置自身（415.3.a/415.5）。
    cost: {
      kind: "activated",
      payments: [
        {
          kind: "exhaust",
          choice: {
            id: "invigorating-bloom.mighty-unit",
            options: ["friendly-mighty-unit-on-board"],
            min: 1,
            max: 1,
            selection: "one",
            zone: "board",
            type: "unit",
            owner: "controller",
            // 706–711：Mighty = 场上单位的当前 Might ≥ 5。费用侧不接受 filter 形状，
            // 这个声明当前无法被成本管线求值（见 judgeReason 第 1/2 点）。
            mighty: true
          }
        },
        { kind: "exhaust", object: "self" }
      ]
    },
    timing: "action",
    body: [
      {
        // “Draw 1.” — 414.3/414.4；抽牌者按 190.6.d 的隐含 "you" 是能力控制者。
        id: "invigorating-bloom.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-22d854738a427311b36ac63f3aaf6f45c1c921fc638e338c8a2144a374c635e7",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "仍缺两处：(1)「Exhaust a friendly [Mighty] unit」是费用内的 filter 式对象选择（355.10.c.1 明确不计为目标），" +
    "但 CostSpec 的 choice 只接受逐项列出的精确 ObjectRef（cost/plan-values.ts 的 choiceObjects），" +
    "静态卡程序无法写出（同 Garbage Grabber ogn-099-298）；费用种类的 filter 形状属 RIFT-261 范围。" +
    "(2) [Mighty] 谓词：effects/keywords/Mighty.ts 已把 706–711 展开为 condition.value 的描述，但过滤词汇里没有" +
    "「当前 Might ≥ 5」，710 又要求按场上单位的当前（含图层结果）Might 判定，费用选择在 Finalize 阶段无法求值" +
    "（同 Show of Strength sfd-106-221）。已合入并有执行证据：give +3 :rb_might: this turn（continuous.might，" +
    "478.1.a/317.2.c）、启动能力的横置自身费用（415.3.a/415.5）与 Draw 1（414.3），见 golden。" +
    "数据问题（不改数据）：本印刷在本地目录记为 cardType Unit，却既无印刷力量也无印刷 Might。",
  abilities,
  sourceText:
    "When you play this, give a friendly unit +3 :rb_might: this turn.\n" +
    "Exhaust a friendly [Mighty] unit, :rb_exhaust:: Draw 1. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default program;
