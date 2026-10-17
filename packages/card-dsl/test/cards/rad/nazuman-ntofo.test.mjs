// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/nazuman-ntofo.js";
import { describeDuelEquipV1 } from "../../../dist/duel/equip-description-v1.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const attach = (await import(new URL("effects/instructions/effect.attach.js", ENGINE))).default;
const { buildCostPlan } = await import(new URL("cost/index.js", ENGINE));
const { createProgramBinding } = await import(new URL("programs/index.js", ENGINE));
const { readFile } = await import("node:fs/promises");

const CARD_ID = "card.hash-bbba13a99fc64b76e1aea5bf99acad154b4526f0661f19a3ac11162fced5801a";
const EXPECTED_SOURCE =
  "Equip :rb_energy_1: (:rb_energy_1:: Attach this to a unit you control.)";

function equipExpansion() {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  return definition.expand({ value: program.abilities[0].value, host: { canonicalCardId: CARD_ID } });
}

test("rad-071-167 Nazuman Ntofo: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
});

test("rad-071-167 Nazuman Ntofo: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-071-167 Nazuman Ntofo: judgeReason names the Equip cost kind and the keyword wiring", () => {
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /not-equipment-tag/);
  assert.match(program.judgeReason, /card-data/);
  assert.match(program.judgeReason, /describeDuelEquipV1/);
  assert.match(program.judgeReason, /describeActivate/);
  assert.equal(/RIFT-257|RIFT-261/.test(program.judgeReason), false);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("rad-071-167 Nazuman Ntofo: production describeActivate really builds the Equip activation's cost plan", () => {
  // 818.1.c.2: the merged expansion is an activated ability whose printed cost
  // component is kind "equip"; the production adapter renders it as
  // kind "activated" with the equip payment intact.
  const source = {
    ref: { id: "nazuman", zoneEntryId: 1 },
    cardId: CARD_ID,
    name: "Nazuman Ntofo",
    types: ["gear"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: null,
    energy: 1,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const draft = binding.describeActivate(source, "A", 0);
  assert.equal(draft.kind, "activated");
  assert.equal(draft.speed, "action");
  assert.equal(draft.cost.cost.kind, "activated");
  assert.deepEqual(draft.cost.cost.payments.map(payment => payment.kind), ["equip"]);
  assert.deepEqual(draft.body.map(step => [step.id, step.op]), [["equip-attach", "effect.attach"]]);

  // The payment kind is still unpayable: the frozen cost plan rejects it, so the
  // activation cannot pass Finalize even though everything else is bound.
  const kernel = world().object("nazuman", {
    types: ["gear"], controller: "A", owner: "A", zone: "board",
    location: { type: "base", player: "A" }, energy: 1, power: null, might: null
  }).build();
  assert.throws(
    () => buildCostPlan(kernel, { id: "equip-activation", cost: { kind: "activated", payments: [{ kind: "equip", value: { kind: "source" } }] } }),
    error => error.name === "CostPlanError" && /Unsupported payment kind: equip/.test(error.message)
  );
});

test("rad-071-167 Nazuman Ntofo: the catalog printing is still refused Equipment admission (card-data issue)", async () => {
  // 818.1.a requires the Gear's Equipment tag. The local catalog row for this
  // canonical identity records tags: [], so the duel admission reports the
  // data problem instead of a cost. This is a card-data issue, not a program
  // change; the row is read, never rewritten.
  const catalog = JSON.parse(await readFile(
    new URL("../../../../card-data/data/deck-catalog.json", import.meta.url),
    "utf8"
  ));
  const row = catalog.cards.find(card => card.id === "rad-071-167");
  assert.ok(row, "the rad-071-167 printing must exist in the local catalog");
  assert.equal(row.canonicalCardId, CARD_ID);
  assert.deepEqual(row.tags, []);
  const description = describeDuelEquipV1(row);
  assert.equal(description.status, "unknown");
  assert.equal(description.reason, "not-equipment-tag");
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("rad-071-167 Nazuman Ntofo: single non-valued-free Equip declaration carrying the printed 1 energy symbol", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c 的印刷费用只有 1 个能量符号，没有 Power：不写 costDomain。
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, undefined);
});

test("rad-071-167 Nazuman Ntofo: the merged Equip expansion is valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

  // 818.1.c.2：展开功能上等于「[费用]: Attach this to a unit you control.」
  const expansion = equipExpansion();
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: EXPECTED_SOURCE
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);

  const [ability] = expansion;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  // The activation carries the printed Equip cost component (kind "equip");
  // whether the cost pipeline can pay it yet is a separate, recorded gap.
  assert.deepEqual(ability.cost.payments.map((payment) => payment.kind), ["equip"]);
  assert.deepEqual(ability.body.map((step) => [step.id, step.op]), [["equip-attach", "effect.attach"]]);
  // 818.1.b.1 / 818.1.c.2：选择的单位是 Target，且限你控制的单位。
  assert.deepEqual(ability.body[0].targets, [{
    id: "equip-target",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("rad-071-167 Nazuman Ntofo: the merged Equip body attaches this Gear to the chosen unit", () => {
  // 818.1.b / 818.1.b.2: the merged attach half really attaches (Top-Most Card),
  // executed through the reference kernel. The Finalize wiring of the printed
  // cost is recorded as a todo and in judgeReason.
  const [activation] = equipExpansion();
  const [attachInstruction] = activation.body;
  const kernel = world()
    .unit("nazuman-ntofo", {
      types: ["gear"],
      might: null,
      energy: 1,
      power: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("ally", { might: 2, owner: "A" })
    .unit("enemy", { might: 2, owner: "B" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("nazuman-ntofo") });
  scoped.setTargets("equip-target", [scoped.ref("ally")]);

  const run = runInstruction(
    attach,
    // The primitive schema takes an Expr for host and evaluates it itself;
    // the card expansion declares `{ kind: "target", id: "equip-target" }`.
    { host: { kind: "constant", value: { kind: "target", id: "equip-target" } } },
    { world: scoped, targets: { "equip-target": [scoped.ref("ally")] } }
  );
  assert.equal(run.result.status, "executed");
  // The merged receipt is { count, objects, host } (linkKey defaults to "attached").
  assert.equal(run.result.linkedValues.attached.count, 1);
  // objects is the attached Gear (this card); host is the chosen unit.
  assert.deepEqual(run.result.linkedValues.attached.objects, [scoped.ref("nazuman-ntofo")]);
  assert.deepEqual(run.result.linkedValues.attached.host, scoped.ref("ally"));
  // 818.1.b.2: the Gear is attached to the chosen friendly unit only.
  assert.deepEqual(scoped.getObject("nazuman-ntofo").attachedTo, scoped.ref("ally"));
  assert.equal(scoped.getObject("enemy").attachedTo, null);
  assert.deepEqual(run.events.map(event => event.action), ["attach"]);
  // The attachment is the declared instruction the expansion carries.
  assert.equal(attachInstruction.op, "effect.attach");
});

test.todo("rad-071-167 Nazuman Ntofo: paying the printed Equip cost (1 energy, 818.1.c / 818.1.c.3) needs the \"equip\" cost payment kind in the cost pipeline; the merged Equip body is executable but payment admission remains blocked.");
