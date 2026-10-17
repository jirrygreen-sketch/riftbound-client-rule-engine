// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/svellsongur.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { instructionDefinitionsById } = await import(new URL("effects/instructions/registry.generated.js", ENGINE));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const { buildCostPlan } = await import(new URL("cost/cost-plan.js", ENGINE));
const copy = (await import(new URL("effects/instructions/effect.copy.js", ENGINE))).default;

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
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /copy-layer-traits-exceptions-and-attachment-duration-unavailable/);
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

test("sfd-059-221 Svellsongur: copy text remains a keyword-owned attachment effect", () => {
  // The printed copy sentence belongs to the attachment/copy layer. Keeping
  // the card program to its Equip declaration prevents a fake card-local
  // instruction from silently changing the Equipment's text.
  assert.equal(program.abilities.length, 1);
  assert.equal(program.abilities[0].kind, "keyword");
  assert.equal(program.abilities[0].keyword, "equip");
  assert.equal(program.status, "judge-required");
});

test.todo(
  "sfd-059-221 Svellsongur: while-attached copy of the host unit's effect text needs the copy layer's effect-text " +
    "consumer and attachment lifetime cleanup (CR 479.1/479.1.d)"
);

test("sfd-059-221 Svellsongur: the Equip activation cost is really blocked in the merged cost pipeline", () => {
  // Live evidence for judgeReason (1): the printed Equip cost cannot be planned,
  // so the activated attach ability never reaches the Chain.
  const [activation] = keywordDefinitionsById.get("Equip").expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(activation.cost.payments.map((payment) => payment.kind), ["equip"]);
  assert.throws(
    () => buildCostPlan(fixture(), { id: "cost:svellsongur", cost: activation.cost, printed: { energy: 3, power: ["Calm"] } }),
    (error) => error.name === "CostPlanError" && /Unsupported payment kind: equip/.test(error.message)
  );
});

test("sfd-059-221 Svellsongur: effect.copy mode 'effect' cannot write the attached unit's text today", () => {
  // Live evidence for judgeReason (2): the merged copy primitive negates the
  // while-attached text copy with an explicit blocked reason, and the copy layer's
  // copyable keys do not include text/effectText, so 479.1.d has no consumer.
  const sourceKernel = fixture();
  const run = runInstruction(copy, {
    source: { kind: "constant", value: "self" },
    mode: { kind: "constant", value: "effect" },
    onto: { kind: "constant", value: "self" }
  }, { world: sourceKernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(
    run.linked.copied.blockedReason,
    "copy-layer-traits-exceptions-and-attachment-duration-unavailable"
  );
  assert.equal(sourceKernel.getObject("svellsongur").effectText, undefined);
});
