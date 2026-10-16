import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import equip from "../../../src/effects/keywords/Equip.ts";
import { instructionDefinitionsById } from "../../../dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";

const host = { canonicalCardId: "sfd-095-221" };
const program = abilities => ({
  canonicalCardId: host.canonicalCardId,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  abilities,
  sourceText: "Equip [1]."
});

function execute(body, kernel, targets) {
  let outcome;
  const wrapper = {
    op: "test.keyword-equip",
    argsSchema: { parse: value => value },
    execute(context) {
      outcome = runAbilityBody(body, context, instructionDefinitionsById);
      return { status: "executed", events: [...outcome.events] };
    }
  };
  const run = runInstruction(wrapper, {}, { world: kernel, targets });
  return { ...run, outcome };
}

function referenceKernelBody(body) {
  return body.map(instruction => ({
    ...instruction,
    args: Object.fromEntries(Object.entries(instruction.args).map(([key, expression]) => [
      key,
      { kind: "constant", value: expression }
    ])),
    targets: instruction.targets?.map(target => ({ ...target, filter: { type: "unit" } }))
  }));
}

function setup() {
  const battlefield = { type: "battlefield", id: "bf-1" };
  const kernel = world()
    .object("gear", {
      name: "Doran's Blade",
      cardId: host.canonicalCardId,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: battlefield,
      energy: null,
      power: null
    })
    .unit("fiora", { location: battlefield })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("gear") });
}

test("Equip metadata identifies an unvalued separately stacking keyword", () => {
  assert.equal(equip.keyword, "Equip");
  assert.equal(equip.valued, false);
  assert.equal(equip.stacking, "separate");
  assert.ok(equip.ruleRefs.includes("818.4"));
});

test("Equip expands to one action-speed activated ability", () => {
  const [ability] = equip.expand({ host });
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "equip", value: { kind: "constant", value: { kind: "source" } } }]
  });
  assert.equal(ability.body.length, 1);
  assert.equal(ability.body[0].op, "effect.attach");
});

test("Equip expansion uses a controlled Unit target", () => {
  const [ability] = equip.expand({ host });
  const [instruction] = ability.body;
  assert.deepEqual(instruction.targets, [{
    id: "equip-target",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
  assert.deepEqual(instruction.args.host, {
    kind: "constant",
    value: { kind: "target", id: "equip-target" }
  });
});

test("Equip expansion validates as an EffectIR CardProgram", () => {
  const result = validateCardProgram(program(equip.expand({ host })));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("Equip ignores an accidental numeric value because it is unvalued", () => {
  assert.deepEqual(
    equip.expand({ host, value: 0 }),
    equip.expand({ host, value: Number.MAX_SAFE_INTEGER })
  );
});

test("Equip executes its merged attachment body through the reference kernel", () => {
  const kernel = setup();
  const run = execute(
    referenceKernelBody(equip.expand({ host })[0].body),
    kernel,
    { "equip-target": [kernel.ref("fiora")] }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.outcome.status, "executed");
  assert.deepEqual(kernel.getObject("gear").attachedTo, kernel.ref("fiora"));
  assert.deepEqual(run.outcome.events.map(event => event.action), ["attach"]);
});

test("Equip ignores a stale or missing target without attaching", () => {
  const kernel = setup();
  const run = execute(referenceKernelBody(equip.expand({ host })[0].body), kernel, { "equip-target": [] });
  assert.equal(run.outcome.status, "partial");
  assert.equal(kernel.getObject("gear").attachedTo, null);
  assert.equal(run.outcome.results[0].result.reason, "mistargeted");
});
