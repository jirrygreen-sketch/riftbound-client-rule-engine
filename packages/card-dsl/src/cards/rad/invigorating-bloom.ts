import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Invigorating Bloom (rad-035-167) — Unit, 3 energy, no printed Power, no printed
 * Might, Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-035-167）：
 *   When you play this, give a friendly unit +3 :rb_might: this turn.
 *   Exhaust a friendly [Mighty] unit, :rb_exhaust:: Draw 1. (A unit is Mighty while it has
 *   5+ :rb_might:.)
 *
 * ⚠ 数据问题（不改数据，仅报告）：本印刷在本地 deck-catalog 记为 `cardType: "Unit"`，但既无
 * 印刷力量（power null）也无印刷 Might（might null）；能力文本是“打出触发 + 启动能力”的单位
 * 式写法。程序按任务给定的 sourceText 逐字编写，不擅自补数值或改类型。
 *
 * 规则依据（CR v1.5）：
 * - “When you play this”：打出触发（383.4.a；时点 card-played）。
 * - “give a friendly unit +3 :rb_might: this turn”：临时 Might 修正（调研表第 4 节把它归
 *   continuous.might），带“this turn”期限（317.2.c 的所有 “this turn” 效果在回合结束清理时
 *   同时到期）；选择单位按 355.7/355.10.a 是目标。
 * - “Exhaust a friendly [Mighty] unit, :rb_exhaust:: Draw 1.”：代价式动作 + 效果；
 *   706–711 定义 Mighty（在场的单位按其当前 Might 判定，≥5）；
 *   355.10.c.1 的 “[do X] to [do Y]” 结构说明横置一个友方单位属于指令内的费用，不是目标；
 *   415.4/415.5 要求作为费用的横置必须能完成；414.3 的 Draw 1 抽牌者是能力控制者。
 *
 * status = judge-required（见 judgeReason）：
 * 1. “+3 :rb_might: this turn” 需要临时 Might 修正原语（continuous.might）；契约 3.6 的封闭
 *    GameAction 集合没有 might 修改动作（同 Stupefy / Frigid Touch 的判定）。
 * 2. “Exhaust a friendly [Mighty] unit” 是费用内的 filter 式对象选择：CostSpec 的 choice 只
 *    接受逐项列出的精确 ObjectRef（cost/plan-values.ts 的 choiceObjects），静态卡程序写不出
 *    （同 Garbage Grabber ogn-099-298 的缺口）。
 * 3. Mighty 谓词：Mighty 的 KeywordDef 展开已合入（RIFT-88），但它只声明 condition.value
 *    形状；过滤词汇里没有“当前 Might ≥ 5”的谓词（同 Show of Strength sfd-106-221 的判定），
 *    而 710 要求在场上按当前 Might（含图层结果）判定。
 * 依赖：RIFT-83/84（临时 Might）、RIFT-89（费用计划与费用选择形状）、RIFT-88/91（Mighty 谓词
 * 接线）。golden 真实执行可执行半段：启动能力的横置费用（415.3.a/415.5）与 effect.draw 的
 * Draw 1（414.3）。
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
        // “give a friendly unit +3 :rb_might: this turn” — 临时 Might 修正（continuous.might，
        // 见 judgeReason 1）；选择友方单位是目标（355.7/355.10.a）。
        id: "invigorating-bloom.give-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 3 },
          duration: { kind: "constant", value: "end-of-turn" },
          target: { kind: "constant", value: "invigorating-bloom.friendly-unit" }
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
            // 706–711：Mighty = 场上单位的当前 Might ≥ 5；谓词自身尚无过滤词汇支持
            // （见 judgeReason 3），这里保留声明形状。
            mighty: true
          }
        },
        { kind: "exhaust", object: "self" }
      ]
    },
    timing: "action",
    body: [
      {
        // “Draw 1.” — 414.3；抽牌者按 190.6.d 的隐含 "you" 是能力控制者。
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
    "三处依赖未合入：(1)「give a friendly unit +3 :rb_might: this turn」需要带本回合到期的临时 Might 修正原语（continuous.might）；" +
    "契约 3.6 的封闭 GameAction 集合没有 might 修改动作（同 Stupefy / Frigid Touch 的判定），依赖 RIFT-83/84 + RIFT-91。" +
    "(2)「Exhaust a friendly [Mighty] unit」是费用内的 filter 式对象选择（355.10.c.1 明确不计为选目标）：CostSpec 的 choice 只接受逐项列出的精确 ObjectRef" +
    "（cost/plan-values.ts choiceObjects），静态卡程序无法写出（同 Garbage Grabber ogn-099-298）。" +
    "(3) [Mighty] 谓词：Mighty 的 KeywordDef 展开已合入（RIFT-88），但过滤词汇没有“当前 Might ≥ 5”的谓词，" +
    "710 又要求在场上按当前 Might（含图层结果）判定（同 Show of Strength sfd-106-221 的判定）。" +
    "可执行部分：启动能力的横置费用（415.3.a/415.5）与 effect.draw 的 Draw 1（414.3）已真实执行，见 golden；" +
    "整卡因上述三项保持 judge-required，不近似实现。" +
    "数据问题（不改数据）：本印刷在本地目录记为 cardType Unit，却既无印刷力量也无印刷 Might。",
  abilities,
  sourceText:
    "When you play this, give a friendly unit +3 :rb_might: this turn.\n" +
    "Exhaust a friendly [Mighty] unit, :rb_exhaust:: Draw 1. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default program;
