import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/svellsongur.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { instructionDefinitionsById } = await import(new URL("effects/instructions/registry.generated.js", ENGINE));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));

const CARD_ID = "card.hash-b789f6d844c0da0576802aca0c36d51a7475c3c3c62c21b9ef4092438971fafe";
const EXPECTED_SOURCE =
  "[Equip] :rb_energy_1::rb_rune_calm: (:rb_energy_1::rb_rune_calm:: Attach this to a unit you control.)\n" +
  "As this is attached to a unit, copy that unit's text to this Equipment's effect text for as long as this is attached to it.";

const [equip] = program.abilities;

function referenceKernelBody(body) {
  return body.map((instruction) => ({
    ...instruction,
    args: Object.fromEntries(
      Object.entries(instruction.args).map(([key, expression]) => [key, { kind: "constant", value: expression }])
    ),
    targets: instruction.targets?.map((target) => ({ ...target, filter: { type: "unit" } }))
  }));
}

function executeBody(body, kernel, targets) {
  let outcome;
  const wrapper = {
    op: "test.card-keyword-body",
    argsSchema: { parse: (value) => value },
    execute(context) {
      outcome = runAbilityBody(body, context, instructionDefinitionsById);
      return { status: "executed", events: [...outcome.events] };
    }
  };
  const run = runInstruction(wrapper, {}, { world: kernel, targets });
  return { ...run, outcome };
}

function fixture() {
  const kernel = world()
    .object("svellsongur", {
      name: "Svellsongur",
      cardId: CARD_ID,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: ["Calm"],
      might: 0
    })
    .unit("ally", { controller: "A", zone: "board", location: { type: "base", player: "A" }, might: 2 })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("svellsongur") });
}

test("sfd-059-221 Svellsongur: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /479\.1/);
  assert.match(program.judgeReason, /copy/);
  assert.match(program.judgeReason, /Equip/);
});

test("sfd-059-221 Svellsongur: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("sfd-059-221 Svellsongur: one valued Equip declaration for the printed energy + Calm rune cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c：印刷费用为 1 能量 + 1 个 Calm 符文；value 记录印刷符号数 2，费用组成见 judgeReason。
  assert.equal(equip.value, 2);
  assert.equal(equip.costDomain, undefined);
});

test("sfd-059-221 Svellsongur: the merged Equip expansion is valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  const expansion = definition.expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "judge-required",
    judgeReason: "expanded structure probe",
    abilities: expansion,
    sourceText: EXPECTED_SOURCE
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);
});

test("sfd-059-221 Svellsongur: the merged attach body really attaches the Gear to a controlled unit", () => {
  const attach = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } })[0].body;
  const kernel = fixture();
  const specId = attach[0].targets[0].id;
  const run = executeBody(referenceKernelBody(attach), kernel, { [specId]: [kernel.ref("ally")] });
  assert.equal(run.outcome.status, "executed");
  assert.deepEqual(kernel.getObject("svellsongur").attachedTo, kernel.ref("ally"));
  assert.deepEqual(run.outcome.events.map((event) => event.action), ["attach"]);
});

test("sfd-059-221 Svellsongur: the Equip expansion declares its activation cost as an equip payment", () => {
  const [activation] = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(activation.cost.payments.map((payment) => payment.kind), ["equip"]);
});
