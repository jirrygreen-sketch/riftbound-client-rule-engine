import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/zhonyas-hourglass.js";
// card-dsl has no dependency edge on engine-core, so golden execution loads
// the built engine through its workspace layout.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runInstruction } = await import(new URL("effects/testing/run-instruction.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));
const { default: move } = await import(new URL("effects/instructions/effect.move.js", ENGINE));
const { default: kill } = await import(new URL("effects/instructions/effect.kill.js", ENGINE));
const { planReplacementBody, bindReplacement } = await import(new URL("replacement/index.js", ENGINE));
const { createEngineStaticBinder } = await import(new URL("programs/index.js", ENGINE));
const { keywordDefinitionsById: hiddenDefinitionsById } = await import(
  new URL("effects/keywords/registry.generated.js", ENGINE)
);
const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");

const [hidden, replacement] = program.abilities;
const [killThis, recall, exhaust] = replacement.with;
const literal = (value) => ({ kind: "constant", value });
const CANONICAL_ID = "card.hash-876fbb11303be19701acffe6831c8d2c74d73130b38f29962ed2cef06bc76387";

test("zhonyas-hourglass: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("zhonyas-hourglass: identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, "card.hash-876fbb11303be19701acffe6831c8d2c74d73130b38f29962ed2cef06bc76387");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The reason must name the missing primitive and the missing rule basis.
  assert.match(program.judgeReason, /Recall/);
  assert.match(program.judgeReason, /effect\.move/);
  assert.match(program.judgeReason, /457/);
  assert.match(program.judgeReason, /replacement\.object/);
  assert.match(program.judgeReason, /replacement\.event/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(260|84)/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(
    program.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "The next time a friendly unit would die, kill this instead. Recall that unit exhausted. (Send it to base. This isn't a move.)"
  );
});

test("zhonyas-hourglass: [Hidden] keyword plus one replacement ability", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.equal(replacement.kind, "replacement");
  // "The next time a friendly unit would die" — the intercepted event is the
  // death of a unit the controller controls (369.1 / 370.1.a.1).
  assert.deepEqual(replacement.replaces, { event: "object-killed", filter: { type: "unit", controller: "self" } });
  assert.equal(replacement.condition, undefined);
});

test("zhonyas-hourglass: replacement body is kill-this, recall-that-unit, exhaust-that-unit", () => {
  assert.deepEqual(replacement.with.map((instruction) => instruction.id), [
    "kill-this",
    "recall-dying-unit",
    "exhaust-dying-unit"
  ]);

  // "kill this instead" — the replacement kills the source gear itself.
  assert.equal(killThis.op, "effect.kill");
  assert.deepEqual(killThis.args, { target: literal({ kind: "source" }) });
  assert.equal(killThis.targets, undefined);

  // "Recall that unit" — 457/458: a Recall is not a Move, so the instruction
  // asks for mode "recall" and names the intercepted unit through the merged
  // The replaced-event selector (355.10.c: not a new target).
  assert.equal(recall.op, "effect.move");
  assert.deepEqual(recall.args.mode, literal("recall"));
  assert.deepEqual(recall.args.to, literal("controller-base"));
  assert.deepEqual(recall.args.objects, literal({ linked: "replacement.object" }));
  assert.equal(recall.targets, undefined);

  // "Recall that unit exhausted" states the 460.1 exception: the recall sets
  // the status, and "that unit" is the same replaced-event referent.
  assert.equal(exhaust.op, "effect.exhaust");
  assert.deepEqual(exhaust.args, { objects: literal({ linked: "replacement.object" }) });
  assert.equal(exhaust.targets, undefined);
});

/** A gear host plus the unit whose death the replacement intercepts. */
function hourglassWorld() {
  const kernel = world()
    .unit("zhonyas-hourglass", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .unit("friendly-unit", { zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const planner = {
    host: { object: ref => kernel.getObject(ref.id), objects: () => kernel.objects, context: () => kernel },
    controller: "A",
    evaluate: expr => kernel.evaluate(expr)
  };
  return {
    kernel,
    hostRef: kernel.ref("zhonyas-hourglass"),
    dyingRef: kernel.ref("friendly-unit"),
    plan: instruction => planReplacementBody(
      [instruction],
      { hostRef: kernel.ref("zhonyas-hourglass"), replacedObject: kernel.ref("friendly-unit"), usedWindow: false },
      planner
    )
  };
}

test("zhonyas-hourglass boundary: the merged planner supports kill-this but not the linked objects spelling for exhaust", () => {
  const { hostRef, dyingRef, plan } = hourglassWorld();
  // The merged replacement planner resolves { linked: "replacement.object" } to
  // the replaced event's unit, so the body addresses the dying unit without
  // making it a target (355.10.c). kill-this resolves the source selector to
  // the gear host.
  assert.deepEqual(plan(killThis), [{ type: "kill", object: hostRef }]);
  assert.throws(
    () => plan(exhaust),
    error => error instanceof Error && /effect\.exhaust requires exactly one of target, pick, or choose/.test(error.message)
  );
});

test("zhonyas-hourglass golden: the supported kill-this action really runs while the exhaust plan is blocked", () => {
  const { kernel, plan } = hourglassWorld();
  const killPlan = plan(killThis);

  assert.equal(kernel.perform(killPlan[0]).status, "done");
  // 429.1: the gear really went to the trash; the intercepted unit is alive.
  assert.equal(kernel.getObject("zhonyas-hourglass").zone, "trash");
  assert.equal(kernel.getObject("friendly-unit").zone, "board");

});

test("zhonyas-hourglass golden: the kill-this half executes through effect.kill self", () => {
  const kernel = world()
    .unit("zhonyas-hourglass", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .unit("friendly-unit", { zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("zhonyas-hourglass") });

  const run = runInstruction(kill, { self: true }, { world: context });
  assert.equal(run.result.status, "executed");
  assert.equal(context.getObject("zhonyas-hourglass").zone, "trash");
  // The intercepted unit is untouched: this half only kills the gear.
  assert.equal(context.getObject("friendly-unit").zone, "board");
  assert.deepEqual(run.linked.killed.map((ref) => ref.id), ["zhonyas-hourglass"]);
});

test("zhonyas-hourglass boundary: the linked-objects exhaust spelling blocks binding without Recall", () => {
  const { hostRef, kernel } = hourglassWorld();
  const pipeline = { clock: { turn: 1 }, registerReplacement() {}, unregisterReplacement() {} };

  assert.throws(
    () => bindReplacement(
      { replaces: replacement.replaces, with: [killThis, exhaust] },
      hostRef,
      { host: { object: ref => kernel.getObject(ref.id), objects: () => kernel.objects, context: () => kernel }, pipeline }
    ),
    /effect\.exhaust requires exactly one of target, pick, or choose/
  );
});

test("zhonyas-hourglass: the full replacement binding stops at the missing Recall action", () => {
  const { hostRef, kernel } = hourglassWorld();
  const pipeline = { clock: { turn: 1 }, registerReplacement() {}, unregisterReplacement() {} };

  assert.throws(
    () => bindReplacement(
      { replaces: replacement.replaces, with: replacement.with },
      hostRef,
      { host: { object: ref => kernel.getObject(ref.id), objects: () => kernel.objects, context: () => kernel }, pipeline }
    ),
    /no Recall action exists|mode "recall" is blocked/
  );
});

test("zhonyas-hourglass boundary: the linked exhaust spelling blocks the one-shot replacement before registration", () => {
  // CR 369.1 / 370.2: the printed "the next time" limits this replacement to a
  // single death. The static ability shape has no window field, so the bound
  // registration matches a second qualifying kill too — which is why the card
  // cannot ship the static form as the printed effect.
  const registered = [];
  const pipeline = { clock: { turn: 1 }, registerReplacement: registration => registered.push(registration), unregisterReplacement() {} };
  const kernel = world()
    .unit("zhonyas-hourglass", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .unit("friendly-unit", { zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("friendly-unit-2", { zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const error = (() => {
    try {
      bindReplacement(
        { replaces: replacement.replaces, with: [killThis, exhaust] },
        kernel.ref("zhonyas-hourglass"),
        { host: { object: ref => kernel.getObject(ref.id), objects: () => kernel.objects, context: () => kernel }, pipeline }
      );
      return null;
    } catch (thrown) {
      return thrown;
    }
  })();
  assert.ok(error);
  assert.match(error.message, /effect\.exhaust requires exactly one of target, pick, or choose/);
  assert.deepEqual(registered, []);
});

test("zhonyas-hourglass: [Hidden]'s cost.hidden declaration registers as a hidden capability", () => {
  const { engine, kernel } = fixture({
    cards: [{ id: "zhonyas-hourglass", cardId: CANONICAL_ID, types: ["gear"], energy: 2 }]
  });
  assert.equal(engine.commit({ type: "move-zone", object: kernel.ref("zhonyas-hourglass"), to: "board" }).status, "done");
  const expansion = hiddenDefinitionsById.get("Hidden");
  assert.ok(expansion, "the merged Hidden KeywordDef must be registered");
  const [declaration] = expansion.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(declaration.effect, { kind: "cost.hidden" });
  const handle = createEngineStaticBinder(engine).bindStatic(declaration, kernel.getObject("zhonyas-hourglass"));
  assert.equal(engine.layers.registry.list()[0].effect.effect.capabilityKind, "hidden");
  handle.unbind();
});

test("zhonyas-hourglass golden: Recall moves the unit to its controller's Base without changing status", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("zhonyas-hourglass", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .unit("friendly-unit", { zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const run = runInstruction(
    move,
    { objects: literal({ target: "dying-unit" }), to: recall.args.to, mode: recall.args.mode },
    { world: kernel, targets: { "dying-unit": [kernel.ref("friendly-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.mode, "recall");
  assert.deepEqual(kernel.getObject("friendly-unit").location, { type: "base", player: "A" });
  assert.equal(kernel.getObject("friendly-unit").exhausted, false);
});

test.todo(
  "zhonyas-hourglass: encode the printed 'the next time' one-shot lifetime with a static replacement " +
    "window that survives across turns; the current replacement ability shape only binds permanent " +
    "static registrations, while replacement.event runtime dependencies are unavailable to the ordinary card ResolveContext"
);

test.todo(
  "zhonyas-hourglass: a real Recall (457-460) plus the printed 'exhausted' status exception (460.1) needs a " +
    "recall GameAction distinct from move-location; effect.move and the merged replacement planner deliberately " +
    "block the approximation"
);

test.todo(
  "zhonyas-hourglass: [Hidden]'s Hide action and facedown play need the cost.hidden consumption path " +
    "(811.1.b / 811.1.c.2); the keyword declaration expands to cost.hidden, but no production Hide/facedown consumer exists"
);

