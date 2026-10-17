import type { CardProgram } from "../../ir/index.js";

/**
 * Convergent Mutation (ogn-108-298) — Spell, 2 energy + 1 Mind power.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Choose a friendly unit. This turn, increase its Might to the Might of
 *   another friendly unit.
 *
 * Status: judge-required — the second clause has one open rules question that
 * changes the executable shape, plus the layer-set condition/consumer chain:
 * - The merged continuous.might primitive (RIFT-258) registers arithmetic
 *   effects through ctx.addContinuous and the "set" mode exists, so the
 *   modification itself is expressible. What is unresolved is the referenced
 *   unit: the text does not say who chooses "another friendly unit" or when, and
 *   355.7 makes a chosen object Targeted while 479.4.b's snapshotting example
 *   ("their Might increased to X") describes a reference read. The two readings
 *   select differently (a second target choice vs. a characteristic-derived
 *   reference) and produce different target/trigger behaviour, so the card
 *   keeps a described target pair without claiming one reading as executable.
 * - "This turn" must expire with the turn (317.2.c / 468.7.c) and the set value
 *   is the other unit's Might at application (479.4.b); the instruction shape is
 *   authorable with the merged op plus a linked value read, but it cannot be
 *   declared executable until the reference reading is ruled.
 * Neither half is approximated (no Buff counter, no fixed value).
 *
 * The printed [Reaction] keyword is declared as a keyword ability (813 /
 * 159.2.b); its continuous.timing expansion and admission are chain-owned.
 */
const convergentMutation = {
  canonicalCardId: "card.hash-6d70f12e2dfb5fbc2398e27f4f4f03110c0310091884499b782107d95b9d6c65",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Might 修改本身现在有已合入的执行路径（continuous.might 的 set 模式经 ctx.addContinuous 注册 arithmetic 层效果，" +
    "RIFT-258；数值可先用 condition.value 捕获被引用单位的当时 Might 再以 linked 值传入，时长 this-turn 由图层到期处理），" +
    "但“increase its Might to the Might of another friendly unit”的引用语义仍未裁定：sourceText 未说明谁选择 " +
    "\"another friendly unit\"、何时选择；若它是具体对象选择则按 355.7 成为 Target（需要第二个 Finalize 目标与 became-target 事件），" +
    "若是按特征的引用则按 355.10.d 不是目标，且 479.4.b 的快照语义与结算时动态读取两种读数给出不同的取值时点。" +
    "两种读数产生不同的目标/触发行为，缺乏官方裁决时不能把任一种写成可执行结论。依赖：规则裁定（引用语义）与目标系统（RIFT-90）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // "the Might of another friendly unit" — the value read is captured at
          // resolution and then fed to the set modification as a linked value.
          // The capture uses the merged condition.value instruction, whose
          // object-property read resolves the target selector through the
          // interpreter's own expression path; the reference's unresolved
          // targeting semantics are the judgeReason gap, not this spelling.
          id: "convergent-mutation.capture-might",
          op: "condition.value",
          args: {
            value: {
              kind: "object-property",
              object: { target: "another-friendly-unit" },
              property: "might"
            },
            key: { kind: "constant", value: "reference-might" }
          }
        },
        {
          // "This turn, increase its Might to ..." — the merged
          // continuous.might primitive in "set" mode registers one
          // arithmetic-layer effect through ctx.addContinuous (RIFT-258) with
          // the captured Might as the set value and the this-turn duration.
          id: "convergent-mutation.set-might",
          op: "continuous.might",
          args: {
            mode: { kind: "constant", value: "set" },
            // The affected unit is read through the merged target selector.
            objects: { kind: "constant", value: { kind: "target", id: "chosen-unit" } },
            amount: { kind: "linked", instructionId: "convergent-mutation.capture-might", key: "reference-might" },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "chosen-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "another-friendly-unit",
              filter: { type: "unit", controller: "self", other: true },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a friendly unit. This turn, increase its Might to the Might of another friendly unit."
} satisfies CardProgram;

export default convergentMutation;
