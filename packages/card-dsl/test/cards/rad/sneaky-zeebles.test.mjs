import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/sneaky-zeebles.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";

const CARD_ID =
  "card.hash-36af4340a3b4308d5a0aaf002e73ae4fb29bec09c724487100a7387c8f819063";

const [triggered] = program.abilities;
const [addRainbow] = triggered.body;

test("rad-076-167 Sneaky Zeebles: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /rainbow/);
  assert.match(program.judgeReason, /135\.2\.e\.5/);
  assert.match(program.judgeReason, /430\.2/);
  assert.match(program.judgeReason, /383\.4\.c\.1/);
});

test("rad-076-167 Sneaky Zeebles: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "When I conquer, [Add] :rb_rune_rainbow:. (Abilities that add resources can't be reacted to.)"
  );
});

test("rad-076-167 Sneaky Zeebles: 'When I conquer' subscribes to the conquer timing point (383.4.c / 471.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, {
    event: "conquer",
    filter: { source: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
});

test("rad-076-167 Sneaky Zeebles: the body adds one rainbow power through effect.resources (430.1 / 135.2.e.5)", () => {
  assert.equal(addRainbow.id, "sneaky-zeebles.add-rainbow");
  assert.equal(addRainbow.op, "effect.resources");
  assert.deepEqual(addRainbow.args.power, { kind: "constant", value: ["rainbow"] });
  assert.deepEqual(addRainbow.args.linkKey, {
    kind: "constant",
    value: "sneaky-zeebles.added"
  });
  // "Add [A]" needs no recipient choice: the controller is the implicit recipient (190.6.d).
  assert.equal(addRainbow.args.player, undefined);
  assert.equal(addRainbow.args.target, undefined);
  assert.equal(addRainbow.targets, undefined);
});

test("rad-076-167 Sneaky Zeebles: the same primitive path really adds power for a concrete domain", () => {
  // Evidence that only the domain representation is missing: with one of the six domains the
  // merged primitive performs the Add and links the actual gain.
  const kernel = world().build();
  const run = runInstruction(
    resources,
    { power: { kind: "constant", value: ["Fury"] }, linkKey: { kind: "constant", value: "sneaky-zeebles.added" } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked["sneaky-zeebles.added"], {
    player: "A",
    energy: 0,
    power: ["Fury"]
  });
  assert.deepEqual(kernel.player("A").power, ["Fury"]);
  assert.deepEqual(run.events.map(event => event.action), ["gain-power"]);
});

test("rad-076-167 Sneaky Zeebles: the declared Add body executes through the merged resource primitive", () => {
  // The concrete-domain execution is the supported half of the printed Add.
  // Immediate Finalize/priority handling remains a separate TODO below.
  const kernel = world().build();
  const run = runInstruction(
    resources,
    {
      power: { kind: "constant", value: ["Body"] },
      linkKey: { kind: "constant", value: "sneaky-zeebles.added" }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.player("A").power, ["Body"]);
  assert.deepEqual(run.events.map(event => event.action), ["gain-power"]);
  assert.deepEqual(run.linked["sneaky-zeebles.added"], {
    player: "A",
    energy: 0,
    power: ["Body"]
  });
});

test("rad-076-167 Sneaky Zeebles: the printed [A] is still rejected by the closed Domain vocabulary", () => {
  // 135.2.e.5 / 163.2.b: [A] Power can be spent on a cost of any Domain. The
  // merged primitive still accepts only the six Domains, so passing the printed
  // symbol must fail closed instead of being approximated by a chosen domain.
  const run = runInstruction(
    resources,
    { power: { kind: "constant", value: ["rainbow"] } },
    { world: world().build() }
  );
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
});

test("rad-076-167 Sneaky Zeebles: the registered conquer trigger does not match the real conquer emission", () => {
  // 383.4.c.1: the trigger is about the Unit that participated in and conquered
  // the Battlefield. turn/flow.ts's scheduleScore publishes { timingPoint:
  // 'conquer', player, details.battlefieldId } with no object, so the bound
  // self-object filter (falls back to objectId of the source) can never match,
  // and dropping the filter would also fire for other units' conquests.
  const kernel = world().player("A").player("B")
    .unit("zeebles", { controller: "A", owner: "A", zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const snapshot = { ...kernel.getObject("zeebles"), cardId: CARD_ID };
  const registry = new Map([[CARD_ID, program]]);
  const [registration] = triggerRegistrations(registry, snapshot);
  assert.deepEqual(registration.spec.filter, { event: "conquer", object: { objectId: "zeebles" } });
  assert.equal(
    matchesTriggerEvent(registration.spec.filter, { timingPoint: "conquer", player: "A", details: { battlefieldId: "bf-1" } }, "A"),
    false,
    "the real conquer emission carries no object, so the bound self filter cannot match"
  );
  assert.equal(
    matchesTriggerEvent(registration.spec.filter, { timingPoint: "conquer", player: "A", object: snapshot, details: { battlefieldId: "bf-1" } }, "A"),
    true,
    "the same filter matches once a conquering object is supplied"
  );
});

test.todo(
  "rad-076-167 Sneaky Zeebles: add 1 Power of any domain ([A], 135.2.e.5 / 163.2.b) — the closed " +
    "Domain type and effect.resources accept only Fury/Calm/Mind/Body/Chaos/Order, so universal " +
    "Power has no representation (contract change request in the task reply)"
);

test.todo(
  "rad-076-167 Sneaky Zeebles: Add abilities finalize and resolve immediately without passing " +
    "Priority or Focus (430.2 / 430.2.a) — ChainKind 'add' and advance()'s immediate resolve are merged, " +
    "but programs/triggers.ts always produces a kind: 'triggered' draft; the Add binding is the gap"
);

test.todo(
  "rad-076-167 Sneaky Zeebles: 'When I conquer' must name the conquering Unit (383.4.c.1) — the scoring " +
    "emission only carries player + details.battlefieldId, so no producer supplies the event object"
);
