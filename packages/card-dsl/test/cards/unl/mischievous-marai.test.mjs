import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/mischievous-marai.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-4f529d5b9537795c6b9a9afa995ca33097983bdd25950e1c2a6b00ddfb5a5eb2";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me to a battlefield, deal 2 to an enemy unit here.";

const [hidden, triggered] = program.abilities;
const [dealTwo] = triggered.body;
const targetSpec = dealTwo.targets[0];

/** Mirrors chain/engine.ts's normalization of the static controller spellings. */
function chainQuery(kernel, controller) {
  return value => {
    const normalized = { ...value };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self") normalized[key] = controller;
    }
    return kernel.listObjects().filter(object => {
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "opponent" && object[key] === controller) return false;
      }
      return matchesObjectFilter({
        ...normalized,
        ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
        ...(normalized.owner === "opponent" ? { owner: "any" } : {})
      }, object);
    });
  };
}

/** The target set resolved by the sameLocationAs anchor, as the interpreter does. */
function resolveEnemyHere(kernel) {
  return queryObjects(targetSpec.filter, {
    context: kernel,
    host: kernel.ref("marai"),
    query: chainQuery(kernel, "A"),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  }).map(object => object.ref);
}

function boardWorld() {
  return world()
    .unit("marai", {
      owner: "A",
      controller: "A",
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("enemy-here", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" } })
    .unit("enemy-at-base", { owner: "B", controller: "B", location: { type: "base", player: "B" } })
    .unit("friendly-here", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
}

/**
 * Execute the card's own instruction with the Finalize-locked target set
 * supplied to the kernel (the facebreaker/pit-rookie convention). The reference
 * kernel compares filter values literally, so it cannot re-run the richer
 * "enemy unit here" filter (opponent + sameLocationAs anchor) on locked
 * targets; the anchor itself is asserted separately through queryObjects.
 */
function bodyWithLockedTargets() {
  return triggered.body.map(({ targets, ...rest }) => rest);
}

test("unl-003-219 Mischievous Marai: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-003-219 Mischievous Marai: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /811\.1\.b/);
  assert.match(program.judgeReason, /card-played/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("unl-003-219 Mischievous Marai: Hidden keyword plus a self play trigger dealing 2", () => {
  assert.equal(program.abilities.length, 2);
  // 811.1: [Hidden] carries no value; its cost.hidden expansion is merged and its
  // consumer is the judged part recorded in judgeReason.
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.equal(hidden.value, undefined);

  // 383.4.a: "When you play me…" is this card's Play Effect, subscribed at the
  // card-played timing point (359 / 407) with the event object the played unit.
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    object: { type: "unit", controller: "self" },
    player: "self",
    details: { playedTo: "battlefield" }
  });
  assert.equal(triggered.trigger.once, undefined);
});

test("unl-003-219 Mischievous Marai: 'deal 2 to an enemy unit here' is one targeted Deal", () => {
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["mischievous-marai.deal-2"]);
  assert.equal(dealTwo.op, "effect.damage");
  assert.deepEqual(dealTwo.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(dealTwo.args.target, {
    kind: "constant",
    value: "mischievous-marai.enemy-unit-here"
  });
  // 418.6.a: no source is named, so the carrying card is the damage source.
  assert.equal(dealTwo.args.source, undefined);
  assert.equal(dealTwo.linkedTo, undefined);
  assert.equal(dealTwo.picks, undefined);
  // 355.9 / 355.10: "an enemy unit here" is chosen by the controller, so it is a
  // target; "enemy" and "here" are restrictions on that target (740.1.b / 053.3).
  assert.deepEqual(targetSpec, {
    id: "mischievous-marai.enemy-unit-here",
    filter: {
      zone: "board",
      type: "unit",
      controller: "opponent",
      sameLocationAs: "self"
    },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-003-219 Mischievous Marai: the 'here' anchor selects only enemy units at the card's location", () => {
  const kernel = boardWorld();
  assert.deepEqual(resolveEnemyHere(kernel).map(ref => ref.id), ["enemy-here"]);

  // The same anchor at a Base excludes battlefield units and vice versa.
  const baseKernel = world()
    .unit("marai", { owner: "A", controller: "A", location: { type: "base", player: "A" } })
    .unit("enemy-here", { owner: "B", controller: "B", location: { type: "base", player: "A" } })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  assert.deepEqual(resolveEnemyHere(baseKernel).map(ref => ref.id), ["enemy-here"]);
});

test("unl-003-219 Mischievous Marai: the trigger body deals exactly 2 to the locked enemy here", () => {
  const kernel = boardWorld();
  const scoped = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("marai")) });
  scoped.setTargets(targetSpec.id, [scoped.ref("enemy-here")]);
  const outcome = resolveChainBody(bodyWithLockedTargets(), scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["mischievous-marai.deal-2", "executed"]
  ]);
  // 418.1.c: the damage is marked on that unit only; a friendly unit and
  // enemies at other locations take nothing.
  assert.equal(scoped.getObject("enemy-here").damage, 2);
  assert.equal(scoped.getObject("enemy-elsewhere").damage, 0);
  assert.equal(scoped.getObject("enemy-at-base").damage, 0);
  assert.equal(scoped.getObject("friendly-here").damage, 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["damage"]);
});

test("unl-003-219 Mischievous Marai: a stale locked target is ignored instead of retargeted (CR 359.3.e.5-e.8)", () => {
  const kernel = boardWorld();
  const scoped = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("marai")) });
  const stale = scoped.ref("enemy-here");
  scoped.perform({ type: "kill", object: stale });
  scoped.setTargets(targetSpec.id, [stale]);
  const outcome = resolveChainBody(bodyWithLockedTargets(), scoped);
  // 359.3.e.5-e.8: the locked reference left its zone, so the Deal is ignored
  // and nothing is retargeted at another enemy unit.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(scoped.getObject("enemy-elsewhere").damage, 0);
  assert.deepEqual(outcome.events, []);
});

test("unl-003-219 Mischievous Marai: the primitive itself reports the full target set's damage (CR 418.1.c)", () => {
  // Primitive-level statement of the printed amount against a locked set: two
  // enemy units here each take 2 (418.1.c marks damage separately per unit).
  const kernel = world()
    .unit("enemy-here", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here-two", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    damage,
    { amount: dealTwo.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("enemy-here"), kernel.ref("enemy-here-two")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 4);
  assert.equal(run.linked.dealtCount, 2);
  assert.equal(kernel.getObject("enemy-here").damage, 2);
  assert.equal(kernel.getObject("enemy-here-two").damage, 2);
});

test("unl-003-219 Mischievous Marai: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "unl-003-219 Mischievous Marai: Hide for :rb_rune_rainbow: and the facedown play for :rb_energy_0: " +
    "(CR 811.1.b / 811.1.d.1) — Hidden's cost.hidden expansion is merged but cost/ and zones/ have no " +
    "Facedown-Zone Hide action or free facedown play (RIFT-84 / RIFT-89)"
);

test.todo(
  "unl-003-219 Mischievous Marai: fire 'When you play me to a battlefield' from the real chain flow " +
    "(CR 383.4.a) — the card-played event carries no play-location payload, so the printed location " +
    "condition cannot be matched (RIFT-120 + event payload)"
);
