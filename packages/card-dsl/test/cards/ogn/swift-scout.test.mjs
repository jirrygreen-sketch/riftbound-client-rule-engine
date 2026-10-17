import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/swift-scout.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { runInstruction, world } = await import(
  new URL("effects/testing/index.js", engineCore)
);
const zoneDefinition = (await import(new URL("effects/instructions/effect.zone.js", engineCore)))
  .default;

const [hideCost, activated] = program.abilities;
const returnInstruction = activated.body[0];
const targetSpec = returnInstruction.targets[0];

const teemoWorld = () =>
  world()
    .unit("teemo", { tags: ["Teemo"], owner: "A" })
    .unit("other", { tags: ["Yasuo"], owner: "A" })
    .build();

test("swift-scout program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("swift-scout identity: canonicalCardId, ruleset, judge-required status and verbatim text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-275c83714004b04a02ea1ff6f9f629c0b77b0d086f67110ebc98b8056b99b7a6"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /811\.1/);
  assert.match(program.judgeReason, /Champion Zone/);
  assert.match(program.judgeReason, /replacement\/pattern\.ts/);
  assert.equal(
    program.sourceText,
    "You may pay :rb_energy_1: to hide a card with [Hidden] instead of :rb_rune_rainbow:.\n" +
      ":rb_energy_1:, :rb_exhaust:: Put a Teemo unit you own into your hand from your Champion Zone or the board."
  );
});

test("swift-scout structure: Hide-cost replacement with the printed 1-energy substitute", () => {
  assert.equal(hideCost.kind, "replacement");
  assert.deepEqual(hideCost.replaces, {
    event: "cost-payment",
    filter: { kind: "hide", keyword: "Hidden", printedCost: "rune-rainbow" }
  });
  assert.equal(hideCost.with.length, 1);
  assert.equal(hideCost.with[0].id, "swift-scout.substitute-hide-cost");
  assert.equal(hideCost.with[0].op, "cost.pay");
  assert.deepEqual(hideCost.with[0].args.payments, { kind: "constant", value: { energy: 1 } });
});

test("swift-scout structure: action-speed activated ability, 1 energy + exhaust, Teemo target", () => {
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(activated.cost.payments, [{ kind: "exhaust" }]);
  assert.equal(activated.body.length, 1);
  assert.equal(returnInstruction.id, "swift-scout.return-teemo");
  assert.equal(returnInstruction.op, "effect.zone");
  assert.deepEqual(returnInstruction.args.target, { kind: "constant", value: "teemo-unit" });
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
  assert.equal(targetSpec.id, "teemo-unit");
  assert.deepEqual(targetSpec.filter, {
    type: "unit",
    tags: ["Teemo"],
    owner: "controller",
    zone: ["board"]
  });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

// effect.zone's argsSchema consumes the already-evaluated TargetSpec id for
// `target` (a plain string) and an Expr for `to` (its execute() calls
// ctx.evaluate(args.to)). The card IR follows the interpreter contract and
// wraps both as Exprs, so the golden maps the card's evaluated `target` value
// into the primitive's own call convention; `to` is passed through unchanged.
test("swift-scout golden: the return instruction really moves an owned Teemo to hand", () => {
  const kernel = teemoWorld();
  const teemoRef = kernel.ref("teemo");
  const run = runInstruction(
    zoneDefinition,
    { target: returnInstruction.args.target.value, to: returnInstruction.args.to },
    { world: kernel, targets: { "teemo-unit": [teemoRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("teemo").zone, "hand");
  assert.equal(kernel.getObject("other").zone, "board");
  assert.equal(run.linked.moved, 1);
  assert.deepEqual(run.linked.movedIds, ["teemo"]);
  assert.equal(run.linked.destination, "hand");
  // The state change is a real zone change: the old reference dies and the
  // card keeps a fresh identity in hand (CR 124).
  assert.equal(kernel.object(teemoRef), null);
  assert.equal(kernel.lastKnown(teemoRef).zone, "board");
});

test("swift-scout golden: a locked Teemo that left the board is ignored (CR 359.3.e)", () => {
  const kernel = teemoWorld();
  const stale = kernel.ref("teemo");
  kernel.perform({ type: "kill", object: stale });
  const before = kernel.stateForTest();
  const run = runInstruction(
    zoneDefinition,
    { target: returnInstruction.args.target.value, to: returnInstruction.args.to },
    { world: kernel, targets: { "teemo-unit": [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.stateForTest(), before);
});

test.todo(
  "swift-scout Hidden-cost replacement: intercept the Hide Discretionary Action cost payment " +
    "(CR 811.1.b/c, 422.1) and pay 1 energy instead of the rainbow rune; GameAction pay exists, " +
    "but replacement patterns cannot match pay/hide/cost-payment and the Hide lifecycle is pending."
);

test.todo(
  "swift-scout Champion Zone half: target a Teemo unit you own in the Champion Zone or on the " +
    "board (CR 355.9.a.5, 108.3); the contract ZoneId / ObjectFilter.zone have no Champion Zone " +
    "so the Champion Zone target half remains a contract change request; owner hand routing works."
);

test("swift-scout: the authored substitute-cost body pays exactly one energy", () => {
  const kernel = world().player("A", { energy: 2 }).build();
  const outcome = resolveChainBody(hideCost.with, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").energy, 1);
  assert.equal(kernel.player("B").energy, 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["pay"]);
  assert.equal(outcome.linkedValues["swift-scout.substitute-hide-cost.payment"].paid, true);
});

test("swift-scout: the authored substitute-cost body cannot pay without energy", () => {
  const kernel = world().build();
  const before = kernel.snapshot();
  assert.throws(() => resolveChainBody(hideCost.with, kernel),
    error => error.name === "CostPlanError" && error.reason === "cannot-pay-cost");
  assert.deepEqual(kernel.snapshot(), before);
  assert.equal(kernel.history({ action: "pay" }), 0);
});
