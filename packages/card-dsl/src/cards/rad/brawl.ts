import type { CardProgram, Instruction } from "../../ir/index.js";

/**
 * Brawl (rad-004-167) — Spell, 3 Energy + 1 Chaos Power, Chaos domain.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a unit [Assault] this turn equal to its Might. (+1 :rb_might: for each
 *   instance of Assault while it's an attacker.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 806 [Action] is a Permissive keyword and 159.2.a makes Action the default
 *   spell timing; both are owned by the merged keywords/Action.ts, so the card
 *   only declares { kind: "keyword", keyword: "action" }.
 * - 807.1.b / 807.1.c / 807.2: "[Assault] equal to its Might" grants a
 *   keyword whose Assault Value is the target unit's Might at resolution; a
 *   grant from an additional source sums into the same single Assault Value
 *   (807.2), which the merged layers arithmetic companion performs.
 * - 807.3 makes Assault (and whether a unit has it) a readable characteristic.
 * - 801.3.a / 801.3.a.2: a granting effect carries its own duration; "this
 *   turn" maps to the end-of-turn expiry (317.1.a).
 * - "Give a unit ..." names one game object and is a target (355.7 / 355.10),
 *   not a pick.
 *
 * Closing the dynamic value: continuous.grant-keyword's `value` argument is a
 * scalar Expr, and its schema (like every primitive schema) reads a real
 * ObjectRef, so a static object selector cannot be handed to it directly. The
 * printed amount is therefore read once at resolution with condition.value over
 * the locked target's Might and handed to the grant as a linked value — the
 * same authoring the merged sfd/called-shot and sfd/ornn-blacksmith goldens use
 * for a resolution-time number. The layers registration then carries that
 * number, so a later Might change cannot rewrite the granted Assault Value
 * (801.3.a.2).
 *
 * Status: executable. The whole printed ability runs on merged paths: the body
 * is the merged continuous.grant-keyword instruction (RIFT-258) plus the merged
 * condition.value control instruction, and the cards/README.md §4 golden drives
 * the card's own body through the production chain adapter plus the layer
 * engine, asserting the locked value, the 807.2 sum with an existing Assault
 * value, the end-of-turn expiration and the mistargeted edge.
 */
const captureMight: Instruction = {
  id: "brawl.capture-might",
  // "equal to its Might"：结算时读取所选单位的当前 Might（契约 3.6 取值时机即调用时）。
  // object-property 只能读静态 ObjectRef，因此用 condition.value 把该数值捕获进链接值，
  // 再交给 continuous.grant-keyword 的标量 value（同 sfd/called-shot 的结算期取值写法）。
  op: "condition.value",
  args: {
    value: {
      kind: "object-property",
      object: { target: "brawl.unit" },
      property: "might"
    },
    key: { kind: "constant", value: "might" }
  }
};

const grantAssault: Instruction = {
  id: "brawl.grant-assault",
  op: "continuous.grant-keyword",
  linkedTo: "brawl.capture-might",
  args: {
    keyword: { kind: "constant", value: "Assault" },
    // 801.3.a.2 / 807.1.c：数值随授予时锁进 ability 图层，之后单位 Might 变化不回溯改写。
    value: {
      kind: "linked-value",
      instructionId: "brawl.capture-might",
      key: "might"
    },
    duration: { kind: "constant", value: "this-turn" },
    objects: { kind: "constant", value: { kind: "target", id: "brawl.unit" } }
  },
  targets: [
    {
      id: "brawl.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]
};

const brawl = {
  canonicalCardId: "card.hash-cad809540cf272ccc60c72a21f1a6766f3fdc07a03fa01da81c97bd46c428af7",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [captureMight, grantAssault]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit [Assault] this turn equal to its Might. (+1 :rb_might: for each instance of Assault while it's an attacker.)"
} satisfies CardProgram;

export default brawl;
