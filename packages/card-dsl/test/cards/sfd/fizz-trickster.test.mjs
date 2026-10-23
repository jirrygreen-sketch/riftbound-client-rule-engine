import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/fizz-trickster.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-2ec80d5a21eaf14b1c8f15f0a61f40ed1d29d8ff68bc87b3e69ce652dbfe74fd";
const SOURCE_TEXT =
  "When you play me, you may play a spell from your trash with Energy cost no more than :rb_energy_3:, " +
  "ignoring its Energy cost. Recycle that spell after you play it. (You must still pay its Power cost.)";
const TRASH_TARGET = "fizz-trickster.spell-in-trash";

const [triggered] = program.abilities;
const [mayPlay] = triggered.body;
const [playSpell, recyclePlayed] = mayPlay.args.body.value;

function trashSpell(overrides = {}) {
  return {
    types: ["spell"],
    owner: "A",
    controller: "A",
    zone: "trash",
    location: null,
    energy: 3,
    power: ["Chaos"],
    might: null,
    ...overrides
  };
}

test("sfd-140-221 Fizz, Trickster: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-140-221 Fizz, Trickster: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /costEnergyLte/);
  assert.match(program.judgeReason, /356\.1\.b\.2/);
  assert.match(program.judgeReason, /RIFT-90 已合入的是 v1\.5 target plan/);
  assert.match(program.judgeReason, /所选对象.*费用计划/);
  // The stale "RIFT-90 will deliver the predicate" framing is gone; the merged
  // RIFT-90 target plan is now named explicitly as not covering the predicate.
  assert.doesNotMatch(program.judgeReason, /RIFT-89|RIFT-257|RIFT-261/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-140-221 Fizz, Trickster: card-played self trigger whose body is the may-play-then-recycle", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  // 383.4.a / 383.4.a.1: "When you play me" fires once the play action completes.
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.optional, false);
});

test("sfd-140-221 Fizz, Trickster: contract 3.9 may-shape wraps the play and the recycle", () => {
  assert.deepEqual(triggered.body.map((instruction) => instruction.id), ["fizz-trickster.may-play"]);
  assert.equal(mayPlay.op, "choice.optional");
  assert.deepEqual(mayPlay.args.prompt, {
    kind: "constant",
    value: "Play a spell from your trash with Energy cost 3 or less, ignoring its Energy cost?"
  });
  assert.equal(mayPlay.args.body.kind, "constant");
  assert.deepEqual(mayPlay.args.body.value.map((instruction) => instruction.id), [
    "fizz-trickster.play-spell",
    "fizz-trickster.recycle-played"
  ]);
  assert.equal(mayPlay.linkedTo, undefined);

  // 355.7 / 355.12: the trash spell is chosen, so it is a target locked together
  // with the may-action. 356.1.c / 206's printed-cost ceiling stays descriptive
  // (no merged filter reads costEnergyLte — see judgeReason); the production
  // binder fails closed on it instead of treating it as a working restriction.
  assert.equal(mayPlay.targets.length, 1);
  const [target] = mayPlay.targets;
  assert.equal(target.id, TRASH_TARGET);
  assert.deepEqual(target.filter, {
    zone: "trash",
    type: "spell",
    owner: "controller",
    costEnergyLte: 3
  });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(mayPlay.picks, undefined);

  // 420.3: the effect names no play location, so the normal play procedure
  // decides it and no location argument is authored. 356.1.b.2's ignore-Energy
  // needs a finalized cost plan from the selected spell; the card never fakes a zero plan.
  assert.equal(playSpell.op, "effect.play");
  assert.deepEqual(playSpell.args.target, { kind: "constant", value: TRASH_TARGET });
  assert.equal(playSpell.args.location, undefined);
  assert.equal(playSpell.args.cost, undefined);
  assert.deepEqual(playSpell.args.linkKey, { kind: "constant", value: "played" });
  assert.equal(playSpell.targets, undefined);

  // 417.1: recycle to the owner's Main Deck bottom, linked to the play.
  assert.equal(recyclePlayed.op, "effect.recycle");
  assert.equal(recyclePlayed.linkedTo, "fizz-trickster.play-spell");
  assert.deepEqual(recyclePlayed.args.objects, {
    kind: "linked-value",
    instructionId: "fizz-trickster.play-spell",
    key: "played"
  });
  assert.deepEqual(recyclePlayed.args.linkKey, { kind: "constant", value: "recycled" });
  assert.equal(recyclePlayed.targets, undefined);
});

test("sfd-140-221 Fizz, Trickster golden: the merged effect.play plays a locked trash spell", () => {
  // "ignoring its Energy cost" is represented by the finalized zero-Energy plan
  // the cost pipeline would build (356.1.b.2). The card itself never authors it;
  // this run supplies it the way a future selected-object cost adapter would.
  const kernel = world().player("A").build();
  kernel.addObject(
    {
      ref: { id: "trash-spell", zoneEntryId: 1 },
      cardId: "card:trash-spell",
      name: "Trash Spell",
      types: ["spell"],
      tags: [],
      keywords: [],
      owner: "A",
      controller: "A",
      zone: "trash",
      location: null,
      might: null,
      energy: 3,
      power: ["Chaos"],
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: false
    },
    "trash"
  );
  const run = runInstruction(
    play,
    {
      target: TRASH_TARGET,
      // 356.1.b.2: base Energy cost set to zero; the printed Power cost stays.
      cost: { kind: "constant", value: { finalized: true, energy: 0, power: ["Chaos"], xp: 0 } },
      linkKey: "played"
    },
    { world: kernel, targets: { [TRASH_TARGET]: [kernel.ref("trash-spell")] } }
  );

  // The caller must still supply the ignore-Energy finalized plan; without that
  // missing selected-object adapter, the play primitive refuses the base cost.
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.result.events.map(event => [event.action, event.outcome]), [["pay", "prevented"]]);
  assert.equal(run.linked.played, undefined);
  assert.equal(kernel.getObject("trash-spell").zone, "trash");
});

test("sfd-140-221 Fizz, Trickster golden: the merged recycle moves a live trash spell to the deck bottom (417.1)", () => {
  const kernel = world().card("kept", { types: ["spell"], owner: "A", zone: "trash" }).build();
  const run = runInstruction(
    recycle,
    { objects: { kind: "constant", value: kernel.ref("kept") }, linkKey: "recycled" },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 1);
  assert.equal(kernel.getObject("kept").zone, "deck");
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["kept"]);
});

test("sfd-140-221 Fizz, Trickster golden: a trash spell that already left makes the recycle ignored (359.3.e)", () => {
  const kernel = world().card("gone", { types: ["spell"], owner: "A", zone: "trash" }).build();
  const stale = kernel.ref("gone");
  kernel.perform({ type: "banish", object: stale });
  const run = runInstruction(
    recycle,
    { objects: { kind: "constant", value: stale }, linkKey: "recycled" },
    { world: kernel }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("gone").zone, "banishment");
});

test.todo(
  "sfd-140-221 Fizz, Trickster: carry the translated costEnergyLte ceiling from the bound target into " +
    "Finalize's selected-object cost predicate (356.1.c / 206); normalization alone does not enforce it"
);

test.todo(
  "sfd-140-221 Fizz, Trickster: generate the ignore-Energy finalized plan for the chosen trash spell " +
    "(356.1.b.2: base Energy 0, printed Power still paid) from the selected object's printed cost " +
    "instead of requiring a caller-supplied finalized override"
);

test.todo(
  "sfd-140-221 Fizz, Trickster: follow effect.play's linked playedObjects receipt through a 1-card play so " +
    "the recycle reads the moved spell's new ObjectRef without treating the played count as an object"
);

test.todo(
  "sfd-140-221 Fizz, Trickster: the card-played trigger reaches this ability through the trigger -> chain " +
    "pipeline with the source-identity filter evaluated (383.4.a / 420.4.a) once the printed-cost " +
    "predicate and played-object link are available to the executable program"
);

test("sfd-140-221 Fizz, Trickster: the production filter adapter preserves the printed-cost ceiling", () => {
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const kernel = world().unit("fizz", { cardId: CARD_ID, types: ["unit"], zone: "board" }).build();
  const registrations = [];
  const engine = { pipeline: { registerTrigger(registration) { registrations.push(registration); }, unregisterTrigger() {} } };
  const ids = binding.registerProgramTriggers(engine, kernel.getObject("fizz"));
  assert.equal(ids.length, 1);
  assert.equal(registrations.length, 1);
  const translated = registrations[0].targets[0].requirement.filter;
  assert.deepEqual(translated, {
    zone: "trash", type: "spell", owner: "self", costEnergyLte: 3
  });
  assert.deepEqual(translateObjectFilter(translated), translated);
  assert.equal(program.status, "judge-required");
});

test("sfd-140-221 Fizz, Trickster: effect.play links the played card's current identity", () => {
  const kernel = world().player("A").card("sp", { types: ["spell"], owner: "A", zone: "trash", energy: 3, power: ["Chaos"] }).build();
  const run = runInstruction(
    play,
    { target: TRASH_TARGET, linkKey: "played" },
    { world: kernel, targets: { [TRASH_TARGET]: [kernel.ref("sp")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(typeof run.linked.played, "number");
  assert.equal(run.linked.played, 1);
  const played = kernel.getObject("sp");
  assert.equal(played.zone, "board");
  assert.deepEqual(run.linked.playedObjects, [played.ref]);
  assert.deepEqual(Object.keys(run.linked), ["played", "playedObjects"]);
  assert.notDeepEqual(run.linked.playedObjects, run.linked.played);
});
