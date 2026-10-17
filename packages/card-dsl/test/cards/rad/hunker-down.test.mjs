import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hunker-down.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { bindResolveContext } = await import(new URL("events/action-adapter.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { default: ready } = await import(new URL("effects/instructions/effect.ready.js", engineCore));
const { default: draw } = await import(new URL("effects/instructions/effect.draw.js", engineCore));
const { matchesObjectFilter } = await import(new URL("layers/filter.js", engineCore));
const { createContinuousEffectRegistry } = await import(new URL("layers/duration.js", engineCore));
const { movement } = await import(new URL("layers/rules/query.js", engineCore));

const CANONICAL = "card.hash-2664ce34bf1adce071ce02ab9d89d11c45b42381e2728fbb02be19a2d83e1575";
const [keyword, play] = program.abilities;
const [readyUnit, cantMove, drawInstruction] = play.body;

/**
 * The chain Finalize wrapper resolves the contract's "self" controller
 * placeholder and asks layers/filter.ts (chain/engine.ts). Bind the same
 * production query so the card's own filter matches without editing its data.
 */
function productionQuery(kernel, controller = kernel.controller) {
  return (filter) => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self") normalized[key] = controller;
    }
    return kernel.objects.filter((object) => {
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "opponent" && object[key] === controller) return false;
      }
      const resolved = { ...normalized };
      if (resolved.controller === "opponent") resolved.controller = "any";
      return matchesObjectFilter(resolved, object);
    });
  };
}

function runCardBody(kernel) {
  const context = bindResolveContext(kernel, { query: productionQuery(kernel, "A") });
  const outcome = resolveChainBody(play.body, context);
  const registry = createContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  return { outcome, registry };
}

test("rad-034-167 Hunker Down: program passes validateCardProgram and keeps the printing text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Ready a friendly unit. It can't move this turn. Draw 1."
  );
});

test("rad-034-167 Hunker Down: judge-required names the real remaining gap", () => {
  assert.equal(program.status, "judge-required");
  // The restriction op and the layers query exist; what is missing is the
  // movement consumer and the CardProgram binding.
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /MovementPermissions/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("rad-034-167 Hunker Down: [Reaction], ready, the no-move restriction, then an unlinked draw", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(play.body.map((instruction) => instruction.id), [
    "hunker-down.ready-unit",
    "hunker-down.cant-move",
    "hunker-down.draw"
  ]);

  // "Ready a friendly unit" — the merged effect.ready target form (355.10.a).
  assert.equal(readyUnit.op, "effect.ready");
  assert.deepEqual(readyUnit.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "hunker-down.unit" }
  });
  assert.deepEqual(readyUnit.targets, [
    {
      id: "hunker-down.unit",
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(readyUnit.linkedTo, undefined);

  // "It can't move this turn" — the merged continuous.movement restriction
  // shape (addsPermission false: 054 removes the option instead of granting a
  // route). It acts on the same finalized target the ready instruction used.
  assert.equal(cantMove.op, "continuous.movement");
  assert.deepEqual(cantMove.args.restriction, { kind: "constant", value: "cannot-move" });
  assert.deepEqual(cantMove.args.addsPermission, { kind: "constant", value: false });
  assert.deepEqual(cantMove.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(cantMove.args.target, { kind: "constant", value: "hunker-down.unit" });
  assert.equal(cantMove.linkedTo, "hunker-down.ready-unit");
  assert.equal(cantMove.targets, undefined);
  assert.equal(cantMove.picks, undefined);

  // "Draw 1." — a separate sentence, deliberately NOT linked to the ready so a
  // mistargeted ready still draws (359.3.e.14.b).
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("rad-034-167 Hunker Down golden: ready + the cannot-move restriction + draw 1", () => {
  const kernel = world()
    .deck(["deck-1", "deck-2"])
    .unit("ally", { owner: "A", controller: "A", exhausted: true })
    .build();
  kernel.setTargets("hunker-down.unit", [kernel.ref("ally")]);

  const { outcome, registry } = runCardBody(kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["hunker-down.ready-unit", "executed"],
      ["hunker-down.cant-move", "executed"],
      ["hunker-down.draw", "executed"]
    ]
  );
  // CR 416.1: the unit becomes ready.
  assert.equal(kernel.getObject("ally").exhausted, false);
  assert.deepEqual(outcome.linkedValues["hunker-down.ready-unit.readied"], {
    count: 1,
    objects: [{ id: "ally", zoneEntryId: 1 }]
  });

  // CR 054/054.1 / 450: the restriction is registered on the readied unit and
  // lasts to the end of the turn.
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "movement");
  assert.deepEqual(registration.effect.effect.restrictions, ["cannot-move"]);
  assert.deepEqual(registration.effect.effect.targetRefs, [{ id: "ally", zoneEntryId: 1 }]);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const view = movement(registry, kernel.ref("ally"), kernel.getObject("ally"));
  assert.equal(view.allowed, false);
  assert.equal(view.canMove, false);
  assert.deepEqual(view.restrictions, ["cannot-move"]);

  // CR 414.1: the draw still happens.
  assert.equal(kernel.player("A").handSize, 1);
});

test("rad-034-167 Hunker Down golden: an already-ready unit is a legal no-op and the draw still happens", () => {
  const kernel = world()
    .deck(["deck-1", "deck-2"])
    .unit("ally", { owner: "A", controller: "A", exhausted: false })
    .build();
  kernel.setTargets("hunker-down.unit", [kernel.ref("ally")]);

  const { outcome, registry } = runCardBody(kernel);

  // CR 416.1.b/416.1.c: nothing additional happens, but the ability still ran.
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["hunker-down.ready-unit.readied"], {
    count: 0,
    objects: []
  });
  assert.equal(kernel.getObject("ally").exhausted, false);
  assert.equal(kernel.player("A").handSize, 1);

  // "It can't move this turn" applies to the readied unit regardless of whether
  // the ready action changed anything; the real merged restriction registers.
  assert.equal(movement(registry, kernel.ref("ally"), kernel.getObject("ally")).canMove, false);
});

test("rad-034-167 Hunker Down boundary: a lost ready target still draws (359.3.e.14.b)", () => {
  const kernel = world()
    .deck(["deck-1", "deck-2"])
    .unit("ally", { owner: "A", controller: "A", exhausted: true })
    .build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("hunker-down.unit", [stale]);

  const { outcome } = runCardBody(kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["hunker-down.ready-unit", "ignored"],
      ["hunker-down.cant-move", "ignored"],
      ["hunker-down.draw", "executed"]
    ]
  );
  assert.equal(kernel.player("A").handSize, 1);
});

test("rad-034-167 Hunker Down golden: effect.ready alone reads the readied count", () => {
  const kernel = world().unit("ally", { owner: "A", exhausted: true }).build();
  const run = runInstruction(
    ready,
    { objects: readyUnit.args.objects.value, amount: 1 },
    { world: kernel, targets: { "hunker-down.unit": [kernel.ref("ally")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ally").exhausted, false);
  assert.deepEqual(run.linked.readied, {
    count: 1,
    objects: [{ id: "ally", zoneEntryId: 1 }]
  });
  assert.deepEqual(run.events.map((event) => event.action), ["ready"]);
});

test("rad-034-167 Hunker Down golden: effect.draw alone moves the top card to hand (CR 414.1)", () => {
  const kernel = world().deck(["deck-1", "deck-2"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["deck-1"]);
});

test.todo(
  "rad-034-167 Hunker Down: 'It can't move this turn' must actually negate a Standard Move (144.4) " +
    "and an effect Move (451.1) — zones/movement.ts and move-location still never read the layer " +
    "engine's MovementPermissions."
);
test.todo(
  "rad-034-167 Hunker Down: the [Reaction] ability and its body need the CardProgram play binding " +
    "and Finalize cost plan (1 Energy, Closed-State window) — RIFT-257 / RIFT-261."
);
