import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/solari-shrine.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core, so golden execution loads the built engine
// through its workspace layout. Primitive-v1 schemas validate Expr nodes and evaluate them
// themselves, so the body runs through the chain interpreter adapter that preserves those nodes
// (the default interpreter would hand effect.draw an already-evaluated literal).
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";

const CANONICAL = "card.hash-3f69a145be4d251c39abc78150e49fb2f5cf77555f18e1d30c3814c595b0f3f1";

const [triggered] = program.abilities;
const [optional] = triggered.body;
const [exhaustSelf, draw] = optional.args.body.value;
const targetSpec = exhaustSelf.targets[0];

function shrineWorld({ exhausted = false } = {}) {
  const base = world()
    .unit("solari-shrine", {
      types: ["gear"],
      zone: "board",
      exhausted,
      location: { type: "base", player: "A" }
    })
    .deck("top-card")
    .build();
  // The host's current zone-bound reference; the interpreter binds `self` to it.
  return base.clone({ sourceSnapshot: base.getObject("solari-shrine") });
}

/** Run the card's real body with the optional answer supplied and the target locked. */
function runBody(body, answer, options) {
  const kernel = shrineWorld(options);
  kernel.setTargets(targetSpec.id, [kernel.ref("solari-shrine")]);
  kernel.setAnswers({ "solari-shrine.exhaust-opt/optional": answer });
  return { kernel, outcome: resolveChainBody(body, kernel) };
}

test("ogn-072-298 Solari Shrine: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  // judge-required: the kill attribution (429.5.c.1) is not in the killing payload.
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /429\.5\.c\.1/);
  assert.match(program.judgeReason, /object-killed/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.equal(
    program.sourceText,
    "When you kill a stunned enemy unit, you may exhaust this to draw 1."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Solari Shrine structure: kill trigger and the optional exhaust-to-draw branch", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.optional, true);
  assert.equal(triggered.trigger.at, "object-killed");
  // The stunned enemy unit filter (CR 424.1.a, 383.2.c.3.b last-known information).
  // The kill attribution clause is not represented because the payload cannot express it.
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-killed",
    object: { type: "unit", controller: "opponent", states: "stunned" }
  });
  assert.equal(triggered.trigger.once, undefined);

  // Contract 3.9: the printed "you may ..." is choice.optional wrapping the chosen instructions.
  assert.equal(triggered.body.length, 1);
  assert.equal(optional.id, "solari-shrine.exhaust-opt");
  assert.equal(optional.op, "choice.optional");
  assert.deepEqual(optional.args.prompt, {
    kind: "constant",
    value: "Exhaust Solari Shrine to draw 1?"
  });
  assert.equal(optional.args.body.kind, "constant");
  assert.deepEqual(optional.args.body.value.map(instruction => instruction.id), [
    "solari-shrine.exhaust-self",
    "solari-shrine.draw"
  ]);
  assert.equal(optional.linkedTo, undefined);

  // "exhaust this" - an effect exhaust (CR 415.1); its target is the host itself.
  assert.equal(exhaustSelf.op, "effect.exhaust");
  assert.deepEqual(exhaustSelf.args.target, {
    kind: "constant",
    value: "solari-shrine.this"
  });
  assert.equal(exhaustSelf.linkedTo, undefined);
  assert.equal(exhaustSelf.targets.length, 1);
  assert.equal(targetSpec.id, "solari-shrine.this");
  assert.deepEqual(targetSpec.filter, { object: "self", type: "gear" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");

  // "to draw 1" - linked to the exhaust so an ignored exhaust does not draw.
  assert.equal(draw.op, "effect.draw");
  assert.equal(draw.linkedTo, "solari-shrine.exhaust-self");
  assert.deepEqual(draw.args.amount, { kind: "constant", value: 1 });
});

test("Solari Shrine golden: accepting exhausts the Shrine and draws exactly 1", () => {
  const { kernel, outcome } = runBody(triggered.body, true);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [
      ["solari-shrine.exhaust-self", "executed"],
      ["solari-shrine.draw", "executed"],
      ["solari-shrine.exhaust-opt", "executed"]
    ]
  );
  assert.equal(kernel.getObject("solari-shrine").exhausted, true);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("Solari Shrine golden: declining skips both the exhaust and the draw", () => {
  const { kernel, outcome } = runBody(triggered.body, false);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => result.id), ["solari-shrine.exhaust-opt"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("solari-shrine").exhausted, false);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(kernel.events, []);
});

test("Solari Shrine golden: an already-exhausted Shrine draws nothing", () => {
  const { kernel, outcome } = runBody(triggered.body, true, { exhausted: true });
  // CR 415.1.b/c: exhausting an already-exhausted permanent does nothing additional, so the
  // instruction stays a no-op execution and the linked draw still resolves.
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.exhausted, {
    count: 0,
    objects: [],
    alreadyExhausted: 1
  });
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
});

test("Solari Shrine golden: a Shrine that left the board is ignored instead of exhausting another Gear", () => {
  const base = world()
    .unit("solari-shrine", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .unit("other-gear", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .deck("top-card")
    .build();
  const stale = base.ref("solari-shrine");
  const kernel = base.clone({
    sourceSnapshot: base.getObject("solari-shrine"),
    answers: new Map([["solari-shrine.exhaust-opt/optional", true]])
  });
  // The host leaves its zone before resolution: its reference dies (CR 124), so the
  // locked / self-bound target is stale and must not rebind to the other Gear.
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets(targetSpec.id, [stale]);

  const outcome = resolveChainBody(triggered.body, kernel);
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.results[1].result, { status: "ignored", reason: "linked-ignored" });
  assert.equal(kernel.getObject("other-gear").exhausted, false);
  // Only the Shrine itself is in hand (it left the board); the linked draw never happened.
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand"), [kernel.ref("solari-shrine")]);
});

test("Solari Shrine: the current object-killed event carries the victim controller, not the kill-effect controller", () => {
  const kernel = world()
    .unit("killer", { owner: "A", controller: "A", zone: "board" })
    .unit("victim", { owner: "B", controller: "B", zone: "board", stunned: true })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint })
  });

  const execution = host.execute({ type: "kill", object: kernel.ref("victim") });
  const killed = execution.emissions.find(event => event.timingPoint === "object-killed");
  assert.ok(killed);
  assert.equal(killed.object.ref.id, "victim");
  assert.equal(killed.player, "B");
  assert.equal(killed.source, undefined);
});

test.todo(
  "Solari Shrine: the 'When you kill ...' attribution (CR v1.5 429.5.c.1: the effect's " +
    "controller is responsible for the kill) is missing from the object-killed payload. " +
    "events/timing-points.ts declares payloadType 'object' with no payloadFields, and " +
    "events/action-adapter.ts records the killed object's controller as the event player, " +
    "so player: 'self' would invert the meaning. The event contract must add the attribution " +
    "before the trigger can be honestly wired."
);
