import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/keeper-of-masks.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import copy from "../../../../engine-core/dist/effects/instructions/effect.copy.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-ee62f6483d21027818d871161b12548f7f6c3e445b4af424782a65577bec4825";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Temporary] (Kill me at the start of my controller's Beginning Phase, before scoring.)\n" +
  "When you play me, play two Reflection unit tokens here. They become copies of me.";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const [hidden, temporary, ability] = program.abilities;
const [playReflections, becomeCopies] = ability.body;

test("unl-081-219 Keeper of Masks: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-081-219 Keeper of Masks: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /[Hh]idden/);
  assert.match(program.judgeReason, /811\.1/);
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /816/);
  assert.match(program.judgeReason, /446|479\.1/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-081-219 Keeper of Masks: [Hidden] and [Temporary] are declared as keywords, in printed order", () => {
  assert.equal(program.abilities.length, 3);
  // 811.1 / 816.1: keyword abilities without printed values omit `value`.
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(temporary, { kind: "keyword", keyword: "temporary" });
  assert.equal(hidden.value, undefined);
  assert.equal(temporary.value, undefined);
});

test("unl-081-219 Keeper of Masks: card-played self trigger playing two CR 187.6 Reflections here", () => {
  assert.equal(ability.kind, "triggered");
  // 383.4.a / 420.4.a: "When you play me" is the Play Effect at card-played.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(ability.optional, false);

  assert.equal(playReflections.id, "keeper-of-masks.play-reflections");
  assert.equal(playReflections.op, "effect.token");
  // 187.6: a 0 Might domainless Reflection unit token.
  assert.deepEqual(playReflections.args.token, { kind: "constant", value: "reflection" });
  assert.deepEqual(playReflections.args.amount, { kind: "constant", value: 2 });
  // 440.2.c / 185.2.a: the played tokens are created on the Chain first.
  assert.deepEqual(playReflections.args.mode, { kind: "constant", value: "play" });
  // "here": the source's current location (464.2.b) as a contract 3.6 selector.
  assert.deepEqual(playReflections.args.location, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.equal(playReflections.targets, undefined);
  assert.equal(playReflections.linkedTo, undefined);
});

test("unl-081-219 Keeper of Masks: 'They become copies of me' targets the linked Reflection tokens", () => {
  // 446 / 479.1: a copy effect on the two tokens just played; the instruction
  // consumes the producer's linked object list instead of re-selecting objects.
  assert.equal(becomeCopies.id, "keeper-of-masks.become-copies");
  assert.equal(becomeCopies.op, "effect.copy");
  assert.equal(becomeCopies.linkedTo, "keeper-of-masks.play-reflections");
  assert.deepEqual(becomeCopies.args.source, { kind: "constant", value: "self" });
  assert.deepEqual(becomeCopies.args.mode, { kind: "constant", value: "effect" });
  assert.deepEqual(becomeCopies.args.onto, {
    kind: "constant",
    value: { linked: "reflections.objects" }
  });
  assert.equal(becomeCopies.targets, undefined);
});

test("unl-081-219 Keeper of Masks golden: the two Reflection tokens are created and played at the source's location", () => {
  const kernel = world()
    .unit("keeper", { zone: "board", location: BATTLEFIELD, might: 1, energy: 2, power: null })
    .build();
  // effect.token's location must be a concrete LocationRef; the golden binds the
  // source's current location exactly as Finalize would supply it (the symbolic
  // selector itself is asserted structurally above).
  const run = runInstruction(
    token,
    {
      token: playReflections.args.token,
      amount: playReflections.args.amount,
      mode: playReflections.args.mode,
      location: { kind: "object-property", object: kernel.ref("keeper"), property: "location" },
      linkKey: { kind: "constant", value: "reflections" }
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  const reflections = run.world
    .query({ zone: "board", type: "unit" })
    .filter(object => object.isToken);
  assert.equal(reflections.length, 2);
  for (const reflection of reflections) {
    assert.equal(reflection.name, "Reflection");
    assert.equal(reflection.might, 0);
    assert.deepEqual(reflection.tags, []);
    assert.deepEqual(reflection.location, BATTLEFIELD);
    assert.equal(reflection.controller, "A");
    // 185.3: a token has no printed cost; null is never coerced to 0.
    assert.equal(reflection.energy, null);
    assert.equal(reflection.power, null);
  }
  assert.equal(run.linked["reflections.amount"], 2);
  assert.deepEqual(run.events.map(event => `${event.action}@${event.timingPoint}`), [
    "create-token@chain-item-pending",
    "play@card-played",
    "create-token@chain-item-pending",
    "play@card-played"
  ]);
});

test("unl-081-219 Keeper of Masks golden: a replacement on the play action leaves no Reflection on the board", () => {
  const kernel = world().unit("keeper", { zone: "board", location: BATTLEFIELD }).build();
  kernel.addReplacement(action => (action.type === "play" ? "replaced" : null));
  const run = runInstruction(
    token,
    {
      token: playReflections.args.token,
      amount: playReflections.args.amount,
      mode: playReflections.args.mode,
      location: { kind: "object-property", object: kernel.ref("keeper"), property: "location" },
      linkKey: { kind: "constant", value: "reflections" }
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.deepEqual(
    run.world.query({ zone: "board", type: "unit" }).filter(object => object.isToken),
    []
  );
  // The first Chain creation already happened before the replaced play; the
  // primitive stops at the failed hand-off (effect.token loops per token), so
  // the receipt keeps exactly the step that really happened.
  assert.equal(run.linked["reflections.createdAmount"], 1);
  assert.equal(run.linked["reflections.amount"], 0);
  assert.equal(
    run.world.pendingItems.length,
    1,
    "the Chain-created token remains Pending; it is not on the Board"
  );
});

test("unl-081-219 Keeper of Masks: effect.copy is the merged primitive named by the second instruction", () => {
  assert.equal(becomeCopies.op, copy.op);
});

test.todo(
  "unl-081-219 Keeper of Masks: Hide and the facedown play (CR 811.1 / 811.1.c.3) need the cost.hidden and " +
    "continuous.timing consumers — effects/keywords/Hidden.ts declares only the static cost shape (RIFT-89 / RIFT-91)"
);
test.todo(
  "unl-081-219 Keeper of Masks: the [Temporary] keyword expansion (CR 816.1.b: kill at the controller's " +
    "Beginning Phase start, before scoring) plus the keyword→timing/chain registration path (RIFT-265 / RIFT-120)"
);
test.todo(
  "unl-081-219 Keeper of Masks: 'They become copies of me' as an applied copy effect on the two played tokens " +
    "(CR 446 / 479.1 Copy Effects layer) — effect.copy mode \"effect\" needs the layer consumer and the " +
    "documented attachment-duration/exceptions model"
);
