import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import quickDraw from "../../../src/effects/keywords/Quick-Draw.ts";
import { instructionDefinitionsById } from "../../../dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";

const host = { canonicalCardId: "sfd-022-221" };
const program = abilities => ({
  canonicalCardId: host.canonicalCardId,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  abilities,
  sourceText: "Quick-Draw"
});

function execute(body, kernel, targets) {
  let outcome;
  const wrapper = {
    op: "test.keyword-quick-draw",
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
    .object("long-sword", {
      name: "Long Sword",
      cardId: host.canonicalCardId,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: battlefield,
      energy: null,
      power: null
    })
    .unit("rumble", { location: battlefield })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("long-sword") });
}

test("Quick-Draw metadata identifies a single stacking keyword", () => {
  assert.equal(quickDraw.keyword, "Quick-Draw");
  assert.equal(quickDraw.valued, false);
  assert.equal(quickDraw.stacking, "single");
  assert.ok(quickDraw.ruleRefs.includes("819.2"));
});

test("Quick-Draw expands to timing and play-trigger abilities", () => {
  const abilities = quickDraw.expand({ host });
  assert.equal(abilities.length, 2);
  assert.equal(abilities[0].kind, "static");
  assert.equal(abilities[0].effect.kind, "continuous.timing");
  assert.deepEqual(abilities[0].effect.value, { kind: "constant", value: "reaction" });
  assert.equal(abilities[1].kind, "triggered");
  assert.equal(abilities[1].trigger.at, "card-played");
  assert.equal(abilities[1].optional, false);
});

test("Quick-Draw limits its trigger and attachment to the host and a friendly Unit", () => {
  const [, triggered] = quickDraw.expand({ host });
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    source: { canonicalCardId: host.canonicalCardId }
  });
  assert.deepEqual(triggered.body[0].targets, [{
    id: "quick-draw-unit",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("Quick-Draw expansion validates as an EffectIR CardProgram", () => {
  const result = validateCardProgram(program(quickDraw.expand({ host })));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("Quick-Draw ignores an accidental numeric value because it is unvalued", () => {
  assert.deepEqual(
    quickDraw.expand({ host, value: 0 }),
    quickDraw.expand({ host, value: Number.MAX_SAFE_INTEGER })
  );
});

test("Quick-Draw executes its attachment body through the reference kernel", () => {
  const kernel = setup();
  const run = execute(
    referenceKernelBody(quickDraw.expand({ host })[1].body),
    kernel,
    { "quick-draw-unit": [kernel.ref("rumble")] }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.outcome.status, "executed");
  assert.deepEqual(kernel.getObject("long-sword").attachedTo, kernel.ref("rumble"));
  assert.deepEqual(run.outcome.events.map(event => event.action), ["attach"]);
});

test("Quick-Draw leaves the source unattached when no friendly Unit is selected", () => {
  const kernel = setup();
  const run = execute(referenceKernelBody(quickDraw.expand({ host })[1].body), kernel, { "quick-draw-unit": [] });
  assert.equal(run.outcome.status, "partial");
  assert.equal(kernel.getObject("long-sword").attachedTo, null);
  assert.equal(run.outcome.results[0].result.reason, "mistargeted");
});
