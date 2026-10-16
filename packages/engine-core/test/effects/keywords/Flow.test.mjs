import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import flow from "../../../dist/effects/keywords/Flow.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { world } from "../../../dist/effects/testing/index.js";

const HOST = { canonicalCardId: "test-flow-spell" };
const constant = value => ({ kind: "constant", value });

const program = abilities => ({
  canonicalCardId: HOST.canonicalCardId,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  abilities,
  sourceText: "[Flow]"
});

const cost = energy => ({
  kind: "alternate",
  payments: [{ kind: "energy", amount: constant(energy) }]
});

test("Flow metadata identifies its alternate-cost definition and v1.5 refs", () => {
  assert.equal(flow.keyword, "Flow");
  assert.equal(flow.valued, false);
  assert.equal(flow.stacking, "separate");
  for (const ref of ["829", "829.1", "829.1.b", "829.1.b.1", "829.1.b.2", "829.1.c", "829.1.c.1", "829.1.c.2", "829.1.c.3", "829.2"]) {
    assert.ok(flow.ruleRefs.includes(ref), `missing rule reference ${ref}`);
  }
});

test("Flow expands without a printed cost to a trash cost declaration and delayed replacement", () => {
  const abilities = flow.expand({ host: HOST });
  assert.equal(abilities.length, 2);
  const [costAbility, replacement] = abilities;
  assert.deepEqual(costAbility, {
    kind: "static",
    effect: {
      kind: "flow.cost",
      appliesTo: "self",
      host: "self",
      sourceZone: "trash"
    }
  });
  assert.equal(replacement.kind, "replacement");
  assert.equal(replacement.replaces.event, "object-leaves-chain");
  assert.deepEqual(replacement.replaces.filter, {
    source: "self",
    zone: "chain",
    leavingInstruction: false
  });
});

test("Flow carries a printed alternate cost from both legacy and contract parameter spellings", () => {
  const printed = cost(3);
  const legacy = flow.expand({ host: HOST, cost: printed });
  const contract = flow.expand({ host: HOST, params: { cost: printed } });
  assert.deepEqual(legacy[0].effect.cost, printed);
  assert.deepEqual(contract[0].effect.cost, printed);
  assert.deepEqual(contract, legacy);
});

test("Flow replacement waits for the selected Flow cost and uses effect.banish", () => {
  const [, replacement] = flow.expand({ host: HOST, cost: cost(2) });
  assert.deepEqual(replacement.condition, {
    kind: "expression",
    value: constant("flow-cost-selected")
  });
  assert.equal(replacement.with.length, 1);
  assert.deepEqual(replacement.with[0], {
    id: "flow:test-flow-spell:banish",
    op: "effect.banish",
    args: { objects: constant("source") }
  });
});

test("Flow expansion with a resource cost validates as an EffectIR CardProgram", () => {
  const abilities = flow.expand({ host: HOST, params: { cost: cost(3) } });
  const result = validateCardProgram(program(abilities));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("Separate Flow instances preserve independently selectable costs", () => {
  const first = flow.expand({ host: HOST, cost: cost(2) });
  const second = flow.expand({ host: HOST, cost: cost(5) });
  assert.equal(flow.stacking, "separate");
  assert.notDeepEqual(first[0].effect.cost, second[0].effect.cost);
  const result = validateCardProgram(program([...first, ...second]));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(first.length + second.length, 4);
});

test("Flow is unvalued and ignores a numeric keyword value", () => {
  assert.deepEqual(
    flow.expand({ host: HOST, value: 0 }),
    flow.expand({ host: HOST, value: Number.MAX_SAFE_INTEGER })
  );
});

test("The merged effect.banish body sends a finalized Flow source to Banishment", () => {
  const [, replacement] = flow.expand({ host: HOST, cost: cost(3) });
  const kernel = world().card("spell", {
    owner: "A",
    controller: "A",
    types: ["spell"],
    zone: "chain",
    energy: null,
    power: null
  }).build();
  const resolving = kernel.clone({ sourceSnapshot: kernel.getObject("spell") });
  const outcome = runAbilityBody(replacement.with, resolving, instructionDefinitionsById);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map(event => event.action), ["banish"]);
  assert.equal(resolving.getObject("spell").zone, "banishment");
  assert.deepEqual(resolving.zone("A", "banishment").map(ref => ref.id), ["spell"]);
});

test("Flow is present in the generated keyword registry", () => {
  assert.equal(keywordDefinitionsById.get("Flow"), flow);
});
