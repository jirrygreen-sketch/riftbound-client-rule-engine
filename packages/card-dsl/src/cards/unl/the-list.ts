import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * The List (unl-138-219) — Gear, Chaos。
 * energy 1、power null（无印刷 Power）、might null（无印刷 Might）、tags []。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-138-219，逐字）：
 *   As you play this, name a tag. (For example, Miss Fortune, Demacia, and Poro are tags.)
 *   :rb_exhaust:: Give a unit with the named tag -2 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 355.1 / 355.5 / 143.1 / 763 / 763.1：As you play this, name a tag 是打出流程中做出的
 *   选择（同类「As I am played」的选择在打出时完成），不是费用；763 / 763.1 规定只能命名
 *   Riftbound 中存在的标签（CR 给出该名单）。本卡把它写成 play 能力的 choice.name 占位指令
 *   （见 judgeReason 第 1 点：契约 3.1 / 3.9 没有命名选择原语）。
 * - 415.4 / 415.5 / 151 / 151.2：:rb_exhaust: 是横置自身的费用，Gear 启动能力默认在控制者
 *   Main Phase 的 Open State 执行（timing: action）。
 * - 355.9.b / 355.10.d.2：a unit 由控制者选择（with the named tag 是目标合法性限制），
 *   因此是目标而不是 pick；355.10.b 说明限制本身不是额外目标。
 * - 143.2.a / 317.2.c / 315.4 / 475-477：-2 :rb_might: this turn 是本回合有效的 Might 修正，
 *   属 arithmetic 图层的 continuous.might 并在本回合结束清理时到期；effect.buff 的 Buff
 *   计数器（702 / 703）是另一回事，不能近似（同 ogn/back-alley-bar、sfd/frigid-touch、
 *   unl/pridestalker 的记录）。
 *
 * status = judge-required（README 第 2 节），三处缺口，均不近似实现：
 * (1) 没有「命名标签」的选择原语：契约 3.1 / 3.9 的控制结构与已合入 op 集合里没有 name /
 *     choose-name 形状（调研 docs/plans/survey/ability-templates.md 把该句列为
 *     unmatched-functional-clause），因此程序用 op "choice.name" 记录意图——它是待合入 op，
 *     不是可执行指令；契约变更请求见本任务回复。
 * (2) the named tag 没有可求值形态：ObjectFilter 是静态的字段合取，Condition 只有
 *     eq / ne / lt / lte / gt / gte / in，无法把运行期命名的标签与对象的 tags 比较；若只写
 *     { type: "unit" } 会把「具有所命名标签」这一限制悄悄丢掉。程序里保留 namedTag: true 这一
 *     记录性键，它没有已合入消费方，仅用于可审查性。
 * (3) 临时 Might 修正没有可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作
 *     （effect.buff 文件头明确本回合修正归 layers 的 continuous.might），effects/instructions/
 *     也没有 continuous.might 原语（RIFT-91 的图层消费方未接通）。
 * 整卡保持 judge-required；golden 只做校验、结构与 TODO，不执行任何近似结算。
 */
const abilities: Ability[] = [
  {
    kind: "play",
    body: [
      {
        // 355.1：打出时做出的选择。choice.name 是待合入 op（见 judgeReason 第 1 点）。
        id: "the-list.name-tag",
        op: "choice.name",
        args: {
          namespace: { kind: "constant", value: "tag" },
          // 763 / 763.1：只能命名 Riftbound 中存在的标签；该名单由规则维护。
          source: { kind: "constant", value: "riftbound-tag-list" },
          linkKey: { kind: "constant", value: "namedTag" }
        }
      }
    ]
  },
  {
    kind: "activated",
    timing: "action",
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
    body: [
      {
        id: "the-list.give-minus-2-might",
        op: "continuous.might",
        args: {
          // 143.2.a / 315.4：本回合有效的 Might 修正，在清理步骤到期。
          amount: { kind: "constant", value: -2 },
          duration: { kind: "constant", value: "end-of-turn" }
        },
        targets: [
          {
            id: "the-list.unit",
            // a unit with the named tag：namedTag 是记录性键，没有已合入消费方
            // （见 judgeReason 第 2 点）；不把限制改写成别的谓词，也不省略它。
            filter: { zone: "board", type: "unit", namedTag: true },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-507e1a3735db5fb2eaf2f03eb1f87ec27cf10682ba26b203f5b753db41e3eb00",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 没有「命名标签」的选择原语：契约 3.1 / 3.9 的控制结构与已合入 op 集合里没有 name / choose-name 形状" +
    "（docs/plans/survey/ability-templates.md 把「As you play this, name a tag.」列为 unmatched-functional-clause）；" +
    "程序里的 op choice.name 是记录意图的待合入 op，不是可执行指令（契约变更请求见任务回复）。" +
    "(2)「the named tag」没有可求值形态：ObjectFilter 是静态字段合取、Condition 只有 eq/ne/lt/lte/gt/gte/in，" +
    "无法把运行期命名的标签与对象 tags 比较；程序保留记录性键 namedTag: true（同 rad/sirens-song 记录 movedThisTurn 的写法），" +
    "它没有已合入消费方，只为可审查性存在，不把限制改写成别的谓词。" +
    "(3)「-2 :rb_might: this turn」是临时 Might 修正：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，" +
    "effect.buff 明确本回合修正归 layers 的 continuous.might（702 / 703 的 Buff 计数器不是本效果），" +
    "而 effects/instructions/ 尚无 continuous.might 原语（RIFT-91 图层消费方未接通；315.4 的本回合到期同理）。" +
    "整卡不执行任何近似结算，golden 只做校验、结构断言与 TODO。",
  abilities,
  sourceText:
    "As you play this, name a tag. (For example, Miss Fortune, Demacia, and Poro are tags.)\n" +
    ":rb_exhaust:: Give a unit with the named tag -2 :rb_might: this turn."
} satisfies CardProgram;
