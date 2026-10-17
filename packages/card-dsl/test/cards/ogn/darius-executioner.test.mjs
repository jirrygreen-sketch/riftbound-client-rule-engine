import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/darius-executioner.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { createTestWorld } = await import(new URL("effects/testing/index.js", engineCore));
const { keywordRegistryById } = await import(
  new URL("effects/keywords/registry.generated.js", engineCore)
);

const CANONICAL = "card.hash-e6a58258933ab19a3c7228a2f9c1ca8bc777a3d378b3ee92ae1b4deca50792b9";
const SOURCE_TEXT =
  "[Legion] — When you play me, ready me. (Get the effect if you've played another card this turn)\n" +
  "Other friendly units have +1 :rb_might: here.";

const [legion, playTrigger, aura] = program.abilities;

/** A world whose ability source is Darius himself, optionally exhausted. */
const dariusWorld = ({ exhausted }) => {
  const kernel = createTestWorld();
  kernel.addObject(
    {
      ref: { id: "darius", zoneEntryId: 1 },
      owner: "A",
      zone: "board",
      exhausted,
      might: 6,
      types: ["unit"],
      location: { type: "battlefield", id: "battlefield-1" }
    },
    "board"
  );
  // "ready me" resolves against the ability source; point the kernel's source
  // at Darius so the effect.ready default ({ kind: "source" }) targets him.
  Object.defineProperty(kernel, "source", { value: kernel.getObject("darius") });
  return kernel;
};

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Legion/);
  assert.match(program.judgeReason, /812\.1\.c/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /479\.4/);
  assert.match(program.judgeReason, /exclude:self/);
  assert.match(program.judgeReason, /excluding:canonicalCardId/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: Legion keyword, the play trigger that readies self, and the 'here' aura", () => {
  assert.equal(program.abilities.length, 3);

  // CR 812.1.a/.b: the whole statement is the Legion ability; the dependent
  // [Text] is carried by the card program, not by the keyword expansion.
  assert.deepEqual(legion, { kind: "keyword", keyword: "legion" });

  // 383.4.a Play Effect: "When you play me" subscribes at card-played for self.
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(playTrigger.trigger.once, undefined);
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.body.length, 1);
  const [ready] = playTrigger.body;
  assert.equal(ready.id, "darius.ready-self");
  assert.equal(ready.op, "effect.ready");
  assert.deepEqual(ready.args, {});
  assert.equal(ready.targets, undefined);
  assert.equal(ready.picks, undefined);
  assert.equal(ready.linkedTo, undefined);

  // "Other friendly units have +1 [M] here": an arithmetic-layer continuous
  // Might grant scoped to the controller's units at the source's location,
  // excluding the source itself (other).
  assert.equal(aura.kind, "static");
  assert.equal(aura.condition, undefined);
  assert.equal(aura.effect.kind, "continuous.might");
  assert.equal(aura.effect.layer, "arithmetic");
  assert.deepEqual(aura.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(aura.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    sameLocationAs: "source",
    exclude: "source"
  });
});

test("Legion declaration matches the merged KeywordDef and its 812.1.b.1 condition (RIFT-82)", () => {
  const legionDef = keywordRegistryById.get("Legion");
  assert.ok(legionDef, "effects/keywords/Legion.ts must be merged for the [Legion] declaration");
  assert.equal(legionDef.valued, false);
  // 812.2: one played card satisfies every Legion instance; they do not sum.
  assert.equal(legionDef.stacking, "single");

  const [predicate] = legionDef.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(predicate.kind, "static");
  assert.equal(predicate.effect.kind, "condition.predicate");
  // 812.1.b.1: "If you have played another card this turn" — a turn-scoped play
  // history for the controller, excluding this card's own identity (812.1.c).
  assert.deepEqual(predicate.effect.history, {
    scope: "turn",
    action: "play",
    player: "controller",
    excluding: CANONICAL
  });
  assert.equal(predicate.effect.operator, "gte");
  assert.equal(predicate.effect.right, 1);
});

test("golden execution: the 'ready me' body readies an exhausted source (CR 416.1)", () => {
  const kernel = dariusWorld({ exhausted: true });
  const outcome = runAbilityBody(playTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].op, "effect.ready");
  assert.equal(outcome.results[0].result.status, "executed");
  // The link receipt records the object actually readied: Darius himself.
  assert.deepEqual(outcome.results[0].result.linkedValues, {
    readied: { count: 1, objects: [kernel.ref("darius")] }
  });
  assert.deepEqual(kernel.events.map(event => event.action), ["ready"]);
  assert.equal(kernel.getObject("darius").exhausted, false);
});

test("golden execution: an already-ready source is not readied again (CR 416.1.b/416.1.c)", () => {
  const kernel = dariusWorld({ exhausted: false });
  const outcome = runAbilityBody(playTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // "nothing additional happens": no action, no event, count stays 0.
  assert.deepEqual(outcome.results[0].result.linkedValues, {
    readied: { count: 0, objects: [] }
  });
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.getObject("darius").exhausted, false);
});

test("golden execution: a source that already left the board is not readied (CR 359.3.e.7)", () => {
  const kernel = dariusWorld({ exhausted: true });
  const stale = kernel.ref("darius");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");

  const outcome = runAbilityBody(playTrigger.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(kernel.getObject("darius").zone, "trash");
  assert.equal(kernel.getObject("darius").exhausted, true);
  // Only the kill's own event exists; the ready action never happened.
  assert.deepEqual(kernel.events.map(event => event.action), ["kill"]);
});

test.todo(
  "[Legion] gate on the play trigger (CR 812.1.b.1, 812.1.c): the merged KeywordDef expansion needs a " +
    "condition.predicate-to-trigger consumption using the existing physical-source history exclusion (812.1.c)"
);

test.todo(
  "'Other friendly units have +1 [M] here.' (CR 479.4 arithmetic layer, 053/740.1.a scoping): the static binder does not support " +
    "the static binder and layer filter to support the dynamic controller, sameLocationAs, and exclude anchors, " +
    "so the aura's scope cannot be evaluated as printed"
);


test("Legion supported history: exclude earlier source entries while counting a separate Darius of the same identity", () => {
  const kernel = createTestWorld();
  kernel.addObject({ ref: { id: "darius", zoneEntryId: 1 }, cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"] }, "hand");
  kernel.addObject({ ref: { id: "another-darius", zoneEntryId: 1 }, cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"] }, "hand");
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("darius") });
  for (const id of ["darius", "another-darius"]) {
    assert.equal(scoped.perform({ type: "play", object: scoped.ref(id), player: "A" }).status, "done");
  }
  assert.equal(scoped.perform({ type: "return-to-hand", object: scoped.ref("darius") }).status, "done");
  assert.equal(scoped.perform({ type: "play", object: scoped.ref("darius"), player: "A" }).status, "done");
  const result = runAbilityBody([{
    id: "legion-history", op: "condition.history",
    args: { query: { kind: "constant", value: { scope: "turn", action: "play", player: "A", exclude: "self" } } }
  }], scoped);
  assert.equal(result.status, "executed");
  assert.equal(result.linkedValues["legion-history.count"], 1);
  assert.equal(scoped.history({ action: "play", player: "A" }), 3);
});
