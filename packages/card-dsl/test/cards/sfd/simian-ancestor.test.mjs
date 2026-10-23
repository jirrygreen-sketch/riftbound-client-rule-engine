import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/simian-ancestor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-971a51eafa8489e035057774061242847cfa0865c5aa2018f634cc048d093610";
const SOURCE_TEXT = "When you buff me, ready me.";

const [ability] = program.abilities;
const [readySelf] = ability.body;

/** 参考内核的 source 指向宿主；能力体用符号选择器 "self"/"source"，由解释器绑定。 */
const hostWorld = (kernel, id) => kernel.clone({ source: kernel.ref(id), sourceSnapshot: kernel.getObject(id) });

test("sfd-047-221 Simian Ancestor: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-047-221 Simian Ancestor: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /buff-added/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
  assert.match(program.judgeReason, /invalid-event-type/);
  // The merged parts must be named as merged, not as outstanding dependencies.
  assert.match(program.judgeReason, /effect\.ready/);
  assert.match(program.judgeReason, /绑定层/);
  assert.match(program.judgeReason, /TriggerRegistration/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-047-221 Simian Ancestor: buff-added self trigger with one ready instruction (427.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 427.1/702.2.a: "When you buff me" subscribes to the buff-added timing point.
  assert.equal(ability.trigger.at, "buff-added");
  assert.deepEqual(ability.trigger.filter, { event: "buff-added", filter: { source: "self" } });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 403.1: the printed sentence has no "you may", so the trigger is mandatory.
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(readySelf.id, "simian-ancestor.ready-self");
  assert.equal(readySelf.op, "effect.ready");
  // "ready me" — the host travels as the contract 3.6 symbolic source selector.
  assert.deepEqual(readySelf.args.objects, { kind: "constant", value: { kind: "source" } });
  assert.equal(readySelf.targets, undefined);
  assert.equal(readySelf.picks, undefined);
  assert.equal(readySelf.linkedTo, undefined);
  assert.equal(readySelf.condition, undefined);
});

test("sfd-047-221 Simian Ancestor golden: the body readies the exhausted host (416.1)", () => {
  const kernel = hostWorld(world().unit("simian", { might: 5, exhausted: true }).deck(["top"]).build(), "simian");
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["simian-ancestor.ready-self", "executed"]
  ]);
  assert.equal(kernel.getObject("simian").exhausted, false);
  assert.deepEqual(outcome.linkedValues["simian-ancestor.ready-self.readied"], {
    count: 1,
    objects: [kernel.ref("simian")]
  });
  assert.deepEqual(outcome.events.map((event) => event.action), ["ready"]);
});

test("sfd-047-221 Simian Ancestor golden: an already-ready host stays legal with 0 readied (416.1.b)", () => {
  const kernel = hostWorld(world().unit("simian", { might: 5, exhausted: false }).build(), "simian");
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("simian").exhausted, false);
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(outcome.linkedValues["simian-ancestor.ready-self.readied"], { count: 0, objects: [] });
});

test("sfd-047-221 Simian Ancestor golden: the merged ready primitive alone readies the chosen host", () => {
  const base = world().unit("simian", { might: 5, exhausted: true }).build();
  const kernel = base.clone({ source: base.ref("simian"), sourceSnapshot: base.getObject("simian") });
  const run = runInstruction(ready, { objects: { kind: "constant", value: { kind: "source" } } }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("simian").exhausted, false);
  assert.deepEqual(run.linked.readied, { count: 1, objects: [kernel.ref("simian")] });
});

test("sfd-047-221 Simian Ancestor golden: the merged binding layer binds the buff-added trigger to the host", () => {
  // Durable contract (programs/triggers.ts): the declared
  // `{ event: "buff-added", filter: { source: "self" } }` must translate into a
  // filter whose object anchor is this card's host, so "me" in "When you buff
  // me" is the unit itself and never a fresh target choice (355.10.c).
  const translated = translateTriggerFilter(ability.trigger.filter, "simian", "buff-added");
  assert.deepEqual(translated, { event: "buff-added", object: { objectId: "simian" } });

  // The card must keep the printed event name rather than rewrite the trigger
  // onto a different (already-listed) timing point to slip past the validator;
  // any validation failure must concern the event-name vocabulary only, never
  // the translated object anchor.
  assert.equal(translated.event, "buff-added");
  assert.equal(ability.trigger.at, "buff-added");
  const validation = validateTriggerSpec({ at: "buff-added", filter: translated });
  if (!validation.ok) {
    assert.deepEqual([...new Set(validation.issues.map(issue => issue.code))], ["invalid-event-type"]);
  }
});

test.todo(
  "sfd-047-221 Simian Ancestor: buff-added must be emitted only when a Buff counter is actually placed " +
    "(427.1.c: a unit that is chosen but already has a counter is not Buffed and must not trigger); the " +
    "timing point producer already emits it (see the pipeline evidence below), the remaining dependency is " +
    "the EventPattern vocabulary"
);

// Direct evidence for the one current gap in the judgeReason: the merged
// binding layer produces the correct host-bound filter, but the closed
// EventPattern vocabulary rejects the printed event name, so registration on
// the real pipeline throws instead of silently skipping validation.
test("sfd-047-221 Simian Ancestor: registerProgramTriggers installs the host-bound buff-added subscription", () => {
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const { engine, kernel } = fixture({ cards: [{ id: "simian", cardId: CARD_ID, types: ["unit"], might: 5 }] });
  engine.commit({ type: "move-zone", object: kernel.ref("simian"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  const ids = binding.registerProgramTriggers(engine, kernel.getObject("simian"));
  assert.equal(ids.length, 1);
  const [registration] = engine.pipeline.checkpoint().triggers.values();
  assert.equal(registration.spec.at, "buff-added");
  assert.deepEqual(registration.spec.filter, {
    event: "buff-added",
    object: { objectId: "simian" }
  });
});

test("sfd-047-221 Simian Ancestor: the merged action adapter really emits buff-added for a placed Buff counter (427.1)", () => {
  // 427.1.c: the trigger depends on the counter actually being placed; the
  // merged adapter emits the timing point exactly for that action outcome.
  const kernel = world().unit("simian", { might: 5 }).deck(["top"]).build();
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(),
    restore: state => kernel.restore(state),
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("unexpected choice"); },
    context: (source, controller, at) => bindResolveContext(kernel, { source, controller, timingPoint: at })
  });
  const outcome = host.execute({ type: "buff", object: kernel.ref("simian"), amount: 1 });
  assert.equal(outcome.outcome.status, "done");
  assert.deepEqual(outcome.emissions.map(emission => emission.timingPoint), ["buff-added"]);
  assert.equal(kernel.getObject("simian").buffs, 1);
});
