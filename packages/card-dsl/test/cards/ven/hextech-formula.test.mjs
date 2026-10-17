import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/hextech-formula.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CANONICAL =
  "card.hash-abc384da043315415efa41d8d39f0cf4edbb77f2cbf021c4b7871cdf8732d768";
const SOURCE_TEXT =
  "This enters exhausted.\n" +
  ":rb_exhaust:: Empower another gear. (It becomes Empowered if it's not already.)";

const [enterExhausted, activated] = program.abilities;
const [empowerInstruction] = activated.body;
const [gearTarget] = empowerInstruction.targets;

/**
 * The production query wrapper, exactly as ven/sfd equip goldens build it:
 * the reference kernel compares filter values literally, so the symbolic
 * "controller": "self" of the declared target is bound to the acting player
 * before the interpreter's own target query runs.
 */
const productionContext = (kernel) => bindResolveContext(kernel, {
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [
      key,
      key === "controller" && value === "self" ? kernel.controller : value
    ])),
    object
  ))
});

/** Hextech Formula on the Board next to another gear of the same controller. */
function formulaWorld() {
  const base = world()
    .unit("hextech-formula", {
      types: ["gear"],
      energy: 2,
      power: null,
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("other-gear", {
      types: ["gear"],
      energy: 3,
      power: null,
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("enemy-gear", {
      types: ["gear"],
      owner: "B",
      zone: "board",
      location: { type: "base", player: "B" }
    })
    .build();
  return base.clone({
    source: base.ref("hextech-formula"),
    sourceSnapshot: base.getObject("hextech-formula")
  });
}

test("ven-062-166 Hextech Formula: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-062-166 Hextech Formula: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /replacement/);
  assert.match(program.judgeReason, /359\.2\.d/);
  assert.match(program.judgeReason, /Unsupported filter field other/);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-062-166 Hextech Formula: 'This enters exhausted' is an entry-state replacement, not an exhaust action", () => {
  assert.equal(program.abilities.length, 2);
  // 369.1/369.3: the entry state rewrite replaces ready entry (359.2.d) with
  // exhausted entry. effect.exhaust would add a spurious becomes-exhausted
  // event after entry and miss the replacement window (805.6 is the same
  // shape), so it is deliberately not used here.
  assert.equal(enterExhausted.kind, "replacement");
  assert.deepEqual(enterExhausted.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.equal(enterExhausted.with.length, 1);
  const [enter] = enterExhausted.with;
  assert.equal(enter.id, "hextech-formula.enter-exhausted");
  assert.equal(enter.op, "replacement.enter");
  assert.deepEqual(enter.args.state, { kind: "constant", value: "exhausted" });
  assert.deepEqual(enter.args.zone, { kind: "constant", value: "board" });
  // The card must not approximate the entry state with a resolve-time exhaust:
  // the program's only instruction is the activated ability's effect.empower.
  assert.deepEqual(
    activated.body.map(instruction => instruction.op),
    ["effect.empower"]
  );
});

test("ven-062-166 Hextech Formula: the exhaust-cost ability empowers exactly one other gear (CR 442.1)", () => {
  // 151/151.2: a Gear activated ability at action timing; 415.5: exhausting the
  // source is its cost.
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.payments, [{ kind: "exhaust", object: "self" }]);
  assert.equal(activated.cost.energy, undefined);

  // "Empower another gear" as a Target (355.7 / 355.9.a.1): exactly one gear,
  // owned by the ability controller, and never this card itself (740.1.a).
  assert.equal(empowerInstruction.op, "effect.empower");
  assert.equal(gearTarget.id, "hextech-formula.other-gear");
  assert.deepEqual(gearTarget.filter, {
    type: "gear",
    controller: "self",
    zone: "board",
    other: true
  });
  assert.equal(gearTarget.min, 1);
  assert.equal(gearTarget.max, 1);
  assert.equal(gearTarget.selection, "one");
  // The reminder "(It becomes Empowered if it's not already.)" is 442.1.c
  // behaviour in the action layer, so the card carries no amount/limit.
  assert.deepEqual(empowerInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "hextech-formula.other-gear" }
  });
  assert.equal(empowerInstruction.args.amount, undefined);
  assert.equal(empowerInstruction.args.multiple, undefined);
});

test("ven-062-166 Hextech Formula golden: exhausting the Gear empowers the finalized other gear", () => {
  const base = formulaWorld();
  // Finalize locks the target choice (355.7/355.15); the golden supplies that
  // locked reference, exactly as the production target plan must, and the
  // interpreter revalidates it against the declared filter.
  base.setTargets("hextech-formula.other-gear", [base.ref("other-gear")]);
  const kernel = productionContext(base);
  const plan = buildCostPlan(kernel, {
    id: "cost:hextech-formula",
    cost: activated.cost
  });
  assert.equal(plan.total.actions.length, 1);
  assert.equal(plan.total.actions[0].action.type, "exhaust");
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("hextech-formula").exhausted, true);

  const outcome = resolveChainBody(activated.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["hextech-formula.empower-another-gear", "executed"]
  ]);
  // 442.1/442.2: the chosen gear becomes Empowered; the source is not a target
  // and stays unaffected.
  assert.equal(kernel.getObject("other-gear").empowered, 1);
  assert.equal(kernel.getObject("hextech-formula").empowered, 0);
  assert.deepEqual(
    outcome.results[0].result.linkedValues.empowered.objects,
    [kernel.ref("other-gear")]
  );
  assert.deepEqual(
    kernel.events.filter(event => event.action === "empower").length,
    1
  );
});

test("ven-062-166 Hextech Formula golden: without a finalized legal gear the ability is ignored, not self-applied", () => {
  const base = world()
    .unit("hextech-formula", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  // The declared filter carries "other: true" (740.1.a), so the source can
  // never be its own target; with nothing locked the instruction is ignored
  // (359.3.e.2) and the source's own Empowered state is untouched.
  const kernel = productionContext(base);

  const outcome = resolveChainBody(activated.body, kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["hextech-formula.empower-another-gear", "ignored"]
  ]);
  assert.equal(gearTarget.filter.other, true);
  assert.equal(kernel.getObject("hextech-formula").empowered, 0);
  assert.deepEqual(kernel.events, []);
});

test("ven-062-166 Hextech Formula golden: the merged replacement rewrites a real board entry", () => {
  // Bind the replacement directly to the pre-entry source, as the production
  // replacement registration contract requires. This exercises replacement.enter
  // itself; the unsupported other:true target filter remains a separate TODO.
  const kernel = world()
    .unit("hextech-formula", {
      types: ["gear"],
      cardId: CANONICAL,
      zone: "hand",
      location: null,
      energy: 2,
      power: null,
      might: null
    })
    .build();
  const hostRef = kernel.ref("hextech-formula");
  const registrations = [];
  bindReplacement(
    enterExhausted,
    hostRef,
    {
      host: {
        object: (ref) => kernel.object(ref),
        objects: () => kernel.objects,
        context: () => kernel
      },
      pipeline: {
        clock: { turn: 1 },
        registerReplacement: (registration) => registrations.push(registration)
      }
    }
  );

  assert.equal(kernel.perform({ type: "move-zone", object: hostRef, to: "chain" }).status, "done");
  const entering = {
    type: "move-zone",
    object: kernel.ref("hextech-formula"),
    to: "base",
    location: { type: "base", player: "A" }
  };
  assert.equal(registrations.length, 1);
  const [registration] = registrations;
  assert.equal(registration.matches(entering, entering), true);
  const replacement = registration.apply(entering, entering);
  assert.equal(replacement.status, "replace");
  assert.deepEqual(replacement.actions.map((action) => action.type), ["exhaust", "move-zone"]);
  for (const action of replacement.actions) assert.equal(kernel.perform(action).status, "done");

  const entered = kernel.getObject("hextech-formula");
  assert.equal(entered.zone, "board");
  assert.deepEqual(entered.location, { type: "base", player: "A" });
  assert.equal(entered.exhausted, true);
  assert.deepEqual(kernel.events.map((event) => event.action), ["move-zone", "exhaust", "move-zone"]);
});

test("ven-062-166 Hextech Formula probe: the production binding rejects 'other' before any target is chosen", () => {
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const base = world()
    .unit("hextech-formula", {
      cardId: CANONICAL,
      types: ["gear"],
      energy: 2,
      power: null,
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("other-gear", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ source: base.ref("hextech-formula"), sourceSnapshot: base.getObject("hextech-formula") });
  assert.throws(
    () => binding.describeActivate(kernel.getObject("hextech-formula"), "A", 0),
    error => error.code === "judge-required" && /Unsupported filter field other/.test(error.message)
  );
  // The reference kernel's own filter matcher ignores the anchor rather than
  // excluding the source, so "another" cannot be honoured there either.
  assert.equal(matchesObjectFilter(gearTarget.filter, kernel.getObject("hextech-formula")), true);
});
test.todo(
  "ven-062-166 Hextech Formula: once the other:true anchor is consumed, the production binding must select exactly " +
    "one friendly gear other than the source (CR 355.7/355.9.a.1/740.1.a); the empower body and exhaust cost are " +
    "already exercised with caller-supplied finalized targets"
);
