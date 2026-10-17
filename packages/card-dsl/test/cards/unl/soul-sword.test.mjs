import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/soul-sword.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";

const CARD_ID = "card.hash-87e2eedcbebff6711e1c1841d161efbe5d63d047836446fb4ececd034911f1be";
const SOURCE_TEXT = "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)";

const [equip] = program.abilities;

test("unl-039-219 Soul Sword: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Equip|equip/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /Calm 费用参数|印刷费用参数/);
  assert.match(program.judgeReason, /effect\.attach/);
});

test("unl-039-219 Soul Sword: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("unl-039-219 Soul Sword: single Equip declaration carrying one Calm Power and no energy symbol", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c: printed cost is a single Calm rune symbol.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Calm");
  // Contrast with sfd/nazuman-ntofo (pure energy Equip): this printing has no energy part.
  assert.equal(SOURCE_TEXT.includes(":rb_energy_1:"), false);
  assert.equal(SOURCE_TEXT.includes(":rb_rune_calm:"), true);
});

test("unl-039-219 Soul Sword: the merged Equip expansion stays valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  assert.equal(definition.keyword, "Equip");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

  const expansion = definition.expand({
    value: equip.value,
    host: { canonicalCardId: CARD_ID }
  });
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.equal(expanded.ok, true, JSON.stringify(expanded.ok ? [] : expanded.issues));
  assert.deepEqual(expanded.issues, []);

  const [activation] = expansion;
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  assert.equal(activation.cost.payments.length >= 1, true);
  assert.deepEqual(activation.body.map((step) => [step.id, step.op]), [
    ["equip-attach", "effect.attach"]
  ]);
  assert.equal(activation.body[0].targets.length, 1);
  assert.equal(activation.body[0].targets[0].id, "equip-target");
  assert.equal(activation.body[0].targets[0].min, 1);
  assert.equal(activation.body[0].targets[0].max, 1);
  assert.equal(activation.body[0].targets[0].selection, "one");
  assert.equal(activation.body[0].targets[0].filter.type, "unit");
});

test("unl-039-219 Soul Sword golden: the merged effect.attach binds the gear to the chosen unit (CR 818.1.c.2)", () => {
  // 818.1.c.2 makes the Equip ability functionally "[Cost]: Attach this gear to
  // a unit you control". The expansion's target and the merged attach
  // primitive both run here; the missing piece is the payment of the printed
  // 1 Calm Power (asserted below).
  const kernel = world()
    .unit("soul-sword", {
      owner: "A",
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("ally", { owner: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const expansion = keywordDefinitionsById.get("Equip").expand({
    value: equip.value,
    host: { canonicalCardId: CARD_ID }
  });
  const [activation] = expansion;
  const [attachInstruction] = activation.body;
  kernel.setTargets("equip-target", [kernel.ref("ally")]);
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("soul-sword") });
  const run = runInstruction(attach, attachInstruction.args, { world: context });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.attached.count, 1);
  assert.deepEqual(run.linked.attached.objects, [kernel.ref("soul-sword")]);
  assert.deepEqual(run.linked.attached.host, kernel.ref("ally"));
  // 435.1/435.1.f: the attached Gear records its host; the host is untouched.
  assert.deepEqual(context.getObject("soul-sword").attachedTo, kernel.ref("ally"));
  assert.equal(context.getObject("soul-sword").zone, "board");
  assert.equal(context.getObject("ally").attachedTo, null);
});

test("unl-039-219 Soul Sword: the printed 1 Calm Power cannot be paid by the merged cost plan", () => {
  // 818.1.c / 818.1.c.3: the printed Equip cost is one Calm rune symbol. The
  // merged Equip expansion declares payments [{ kind: "equip" }] and the merged
  // cost reader does not support that kind, so the ability cannot be paid today.
  const kernel = world()
    .unit("soul-sword", {
      owner: "A",
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  const expansion = keywordDefinitionsById.get("Equip").expand({
    value: equip.value,
    host: { canonicalCardId: CARD_ID }
  });
  assert.deepEqual(expansion[0].cost.payments, [
    { kind: "equip", value: { kind: "constant", value: { kind: "source" } } }
  ]);
  assert.throws(
    () =>
      buildCostPlan(
        kernel.clone({ sourceSnapshot: kernel.getObject("soul-sword") }),
        { id: "soul-sword", cost: expansion[0].cost }
      ),
    (error) => error.name === "CostPlanError" && error.reason === "judge-required"
  );
});

test.todo(
  "unl-039-219 Soul Sword: pay the printed Equip cost (1 Calm Power, 818.1.c / 818.1.c.3) through the cost plan " +
    "and attach the gear end-to-end through the Equip payment path"
);
