import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/kadregrin-the-infernal.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-398b3826ce23339dadae173c5f1fa39994abe8d2eed99f68d1de01806763d379";

test("ogn-038-298 Kadregrin the Infernal: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Mighty/);
  assert.match(program.judgeReason, /mightGte/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /静默忽略/);
});

test("ogn-038-298 Kadregrin the Infernal: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "When you play me, draw 1 for each of your [Mighty] units. (A unit is Mighty while it has 5+ :rb_might:.)"
  );
});

test("ogn-038-298 Kadregrin the Infernal: card-played self trigger with a count-driven draw and no target", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "kadregrin.draw-per-mighty");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, {
    kind: "count",
    subject: "units",
    filter: { type: "unit", controller: "self", zone: "board", mightGte: 5 }
  });
  // "for each of your [Mighty] units" is a programmatic set query (355.10.d),
  // not a target: no TargetSpec / PickSpec is declared.
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogn-038-298 Kadregrin the Infernal: the count drives an exactly-sized draw through the reference kernel", () => {
  // No merged filter consumer implements the Mighty predicate (CR 706-708/710),
  // so this golden pins the count -> draw shape with an explicit board filter
  // (controller + zone); the Mighty predicate itself remains the judged part.
  const kernel = world()
    .deck(["a", "b", "c"])
    .unit("mighty-1", { owner: "A", might: 6 })
    .unit("mighty-2", { owner: "A", might: 5 })
    .unit("enemy", { owner: "B", might: 7 })
    .build();
  const amountExpr = {
    kind: "count",
    subject: "units",
    filter: { type: "unit", controller: "A", zone: "board" }
  };
  assert.equal(kernel.evaluate(amountExpr), 2);

  const run = runInstruction(draw, { amount: amountExpr }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("ogn-038-298 Kadregrin the Infernal: zero qualifying units draws zero cards", () => {
  const kernel = world().deck(["a"]).build();
  const run = runInstruction(
    draw,
    { amount: { kind: "count", subject: "units", filter: { type: "unit", controller: "A", zone: "board" } } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(kernel.events.length, 0);
});

test.todo(
  "Kadregrin: apply the Mighty >=5 predicate to every friendly Board candidate using current layered Might; " +
    "exclude non-Mighty, enemy and off-Board units before the declared count-driven draw (CR 706-711; RIFT-359)"
);

test("ogn-038-298 Kadregrin the Infernal: the play trigger registers from the CardProgram through the merged binding", () => {
  // RIFT-257's binding turns { self: true } into the event pattern for this incarnation and
  // registers it on the Board zone, where permanents evaluate their triggers (384.1). The
  // registry refuses judge-required programs, so the same IR is bound under an executable
  // status (sfd/honest-broker precedent); the shipped status is asserted above.
  const source = {
    ref: { id: "kadregrin", zoneEntryId: 1 },
    cardId: program.canonicalCardId,
    name: "Kadregrin the Infernal",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 5,
    energy: 8,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const registered = [];
  const ids = binding.registerProgramTriggers(
    { pipeline: { registerTrigger: (registration) => registered.push(registration) } },
    source
  );
  assert.deepEqual(ids, ["program:kadregrin:1:0"]);
  assert.equal(registered[0].spec.at, "card-played");
  assert.deepEqual(registered[0].spec.filter, {
    event: "card-played",
    object: { objectId: "kadregrin" }
  });
  assert.deepEqual(registered[0].activeZones, ["board"]);
});

test("ogn-038-298 Kadregrin the Infernal: the count expression really reads the board through the merged kernel", () => {
  // Only the board predicate dimensions that ARE consumed are asserted here (type/controller/zone
  // via ctx.query). The Mighty threshold itself is the judged part, asserted by the TODO below.
  const kernel = world()
    .deck(["a", "b", "c"])
    .unit("mighty", { owner: "A", might: 6 })
    .unit("enemy", { owner: "B", might: 6 })
    .unit("benched", { owner: "A", might: 6, zone: "deck" })
    .build();
  const declared = program.abilities[0].body[0].args.amount;
  assert.deepEqual(declared.filter, {
    type: "unit",
    controller: "self",
    zone: "board",
    mightGte: 5
  });
  // The placeholder controller resolves to the resolving player, and only Board objects qualify.
  assert.deepEqual(
    kernel.query({ ...declared.filter, controller: "A" }).map((object) => object.ref.id),
    ["mighty"]
  );
  assert.equal(kernel.evaluate({ ...declared, filter: { ...declared.filter, controller: "A" } }), 1);
});

test("ogn-038-298 Kadregrin the Infernal TODO: the declared Mighty threshold decides the draw count", {
  todo: "CR 707/708/710: apply the Mighty >= 5 predicate to every friendly Board candidate (RIFT-359)"
}, () => {
  // The correct expectation: 2 friendly units, only 1 of them Mighty -> draw 1. The merged set
  // query ignores the unknown mightGte key, so this fails today; it must pass once the predicate
  // has a consumer, and the current looser count is never asserted as the expected result.
  const kernel = world()
    .deck(["a", "b", "c"])
    .unit("mighty", { owner: "A", might: 6 })
    .unit("not-mighty", { owner: "A", might: 4 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mighty") });
  const amount = program.abilities[0].body[0].args.amount;
  assert.equal(scoped.evaluate(amount), 1);
});
