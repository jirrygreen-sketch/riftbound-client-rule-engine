import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/blade-of-the-exile.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CARD_ID = "card.hash-d127ec787d0c328ab80a9aa29a656cd77a9dda6050627ec1bad17db1942c9853";
const SOURCE_TEXT =
  "[Equip] — :rb_rune_rainbow: or exhaust a friendly unit. (Pay the cost: Attach this to a unit you control.)";

test("rad-150-167 Blade of the Exile: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The reason must name the still-open Equip cost binding, not the
  // already-merged KeywordDef or program binding.
  assert.match(program.judgeReason, /kind: "equip"/);
  assert.match(program.judgeReason, /355\.10\.c/);
});

test("rad-150-167 Blade of the Exile: a single Equip keyword whose printed cost is a two-way choice", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  // 与已合入 sfd Equip 卡同一小写 keyword id 约定。
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  // rainbow 符号 = 任意领域的一个 Power（135.2.e.5 / 135.2.e.5.a）。
  assert.equal(equip.costDomain, "rainbow");
  assert.deepEqual(equip.costAlternatives, [
    { kind: "power", domain: "rainbow", amount: 1 },
    { kind: "exhaust", target: "friendly-unit" }
  ]);
});

test("rad-150-167 Blade of the Exile: source text keeps the rainbow symbol and the reminder wording", () => {
  // “Pay the cost: Attach this to a unit you control.” 是提示文本（135.2.d.3 无游戏功能），
  // 原文逐字保留以便审查；程序不为提示文本生成任何能力。
  assert.equal(program.sourceText.includes(":rb_rune_rainbow:"), true);
  assert.equal(program.sourceText.includes("or exhaust a friendly unit"), true);
  assert.equal(program.abilities.length, 1);
});

test("rad-150-167 Blade of the Exile: the merged Equip expansion attaches the gear to a friendly unit", () => {
  // 818.1.b / 818.1.c.2: the registered expansion's body is "Attach this gear to
  // a unit you control" through the merged effect.attach primitive. Executing it
  // proves the expansion's body half; the printed cost half is what stays judged.
  const equip = keywordDefinitionsById.get("Equip");
  assert.notEqual(equip, undefined);
  const [activation] = equip.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  const [body] = activation.body;
  assert.equal(body.op, "effect.attach");

  const kernel = world()
    .unit("blade-of-the-exile", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("friendly-unit", { owner: "A", zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("blade-of-the-exile") });
  const run = runInstruction(
    attach,
    body.args,
    { world: scoped, targets: { "equip-target": [kernel.ref("friendly-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(scoped.getObject("blade-of-the-exile").attachedTo, kernel.ref("friendly-unit"));
  assert.deepEqual(run.events.map((event) => event.action), ["attach"]);
});

test("rad-150-167 Blade of the Exile: the rainbow Power option is payable by any domain", () => {
  // 135.2.e.5 / 135.2.e.5.a: [A] is one Power of any Domain. The merged cost
  // plan accepts exactly that requirement, so this half of the printed cost is
  // already representable; the alternative-cost choice is what is missing.
  const kernel = world().unit("blade-of-the-exile", { owner: "A", types: ["gear"], zone: "board" }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("blade-of-the-exile") });
  const plan = buildCostPlan(context, {
    id: "blade-of-the-exile:equip-rainbow",
    cost: {
      kind: "activated",
      payments: [
        {
          kind: "power",
          amount: { kind: "constant", value: 1 },
          allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
        }
      ]
    }
  });
  assert.equal(plan.finalized, true);
  assert.deepEqual(plan.total.power, [
    { amount: 1, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }
  ]);
});

test.todo(
  "rad-150-167 Blade of the Exile: the printed two-way cost choice — rainbow Power OR exhaust a " +
    "friendly unit — needs cost-side alternative payments plus the non-target cost selection of a " +
  "friendly unit (CR 818.1.c.3 / 355.10.c / 355.10.c.1); the merged cost planner still " +
  "has no authoritative Equip-cost binding"
);
