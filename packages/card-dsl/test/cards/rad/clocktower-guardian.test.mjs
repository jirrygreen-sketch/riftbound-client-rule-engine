import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/clocktower-guardian.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import inspect from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import order from "../../../../engine-core/dist/effects/instructions/effect.order.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CARD_ID =
  "card.hash-9acbf5e3c7be24dcd9c72b8ec614e8dd1d7ef60d52c6394559ece574843ccdaf";

const [deathknell, played, held, dying] = program.abilities;
const [bindController, look, recycleChosen, replaceRest] = played.body;
const [deathknellBindController, banishTop, mayPlay] = dying.body;
const [playBanished] = mayPlay.args.body.value;

test("rad-067-167 Clocktower Guardian: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /动态计划/);
  assert.match(program.judgeReason, /Predict/);
});

test("rad-067-167 Clocktower Guardian: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "When you play me or when I hold, [Predict 3].\n" +
      "[Deathknell][>] Banish the top card of your Main Deck. You may play it, ignoring its Energy cost."
  );
});

test("rad-067-167 Clocktower Guardian: [Deathknell] is declared as a keyword ability (808.1)", () => {
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
});

test("rad-067-167 Clocktower Guardian: 'when you play me OR when I hold' becomes two triggers with identical bodies (383.4.a.1 / 471.2)", () => {
  // card-played and hold are distinct timing points in the closed enum, so the disjunction is
  // modelled as two abilities rather than one compound filter.
  assert.equal(played.kind, "triggered");
  assert.equal(played.trigger.at, "card-played");
  assert.deepEqual(played.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(held.kind, "triggered");
  assert.equal(held.trigger.at, "hold");
  assert.deepEqual(held.trigger.filter, { event: "hold", filter: { source: "self" } });
  assert.deepEqual(played.body, held.body, "both triggers carry the same [Predict 3] body");
  assert.equal(played.optional, false);
  assert.equal(held.optional, false);
});

test("rad-067-167 Clocktower Guardian: [Predict 3] looks at exactly the top three in deck order (437.1 / 437.3)", () => {
  assert.equal(bindController.op, "condition.value");
  assert.deepEqual(bindController.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(bindController.args.key, { kind: "constant", value: "controller" });
  assert.equal(look.linkedTo, "clocktower-guardian.bind-controller");
  assert.deepEqual(look.args.player, {
    kind: "linked-value",
    instructionId: "clocktower-guardian.bind-controller",
    key: "controller"
  });
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(look.args.picksSpecId, {
    kind: "constant",
    value: "clocktower-guardian.predict-range"
  });
  assert.deepEqual(look.args.chooseCount, { kind: "constant", value: { min: 0, max: 3 } });
  assert.deepEqual(look.args.choiceId, { kind: "constant", value: "clocktower-guardian.predict" });
  assert.equal(look.picks.length, 1);
  assert.deepEqual(look.picks[0], {
    id: "clocktower-guardian.predict-range",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 3 } }
  });
  // Recycled cards go to the deck bottom; the rest is reordered on top (437.1.a).
  assert.equal(recycleChosen.op, "effect.recycle");
  assert.equal(recycleChosen.linkedTo, "clocktower-guardian.predict-look");
  assert.equal(replaceRest.op, "effect.order");
  assert.equal(replaceRest.linkedTo, "clocktower-guardian.recycle-predicted");
  assert.deepEqual(replaceRest.args.destination, { kind: "constant", value: "top" });
  assert.deepEqual(replaceRest.args.count, {
    kind: "arithmetic",
    operator: "sub",
    operands: [
      { kind: "constant", value: 3 },
      {
        kind: "linked-value",
        instructionId: "clocktower-guardian.recycle-predicted",
        key: "recycledCount"
      }
    ]
  });
  assert.deepEqual(replaceRest.args.chooseOrder, { kind: "constant", value: true });
});

test("rad-067-167 Clocktower Guardian: the Deathknell effect is a self-death trigger (808.1.c / 808.1.d)", () => {
  assert.equal(dying.kind, "triggered");
  assert.equal(dying.trigger.at, "object-killed");
  assert.deepEqual(dying.trigger.filter, {
    event: "object-killed",
    filter: { source: "self" }
  });
  assert.equal(dying.body.length, 3);
  assert.equal(deathknellBindController.op, "condition.value");
  assert.deepEqual(deathknellBindController.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
});

test("rad-067-167 Clocktower Guardian: 'Banish the top card of your Main Deck' reads the deck top in zone order (428.1)", () => {
  assert.equal(banishTop.op, "effect.banish");
  assert.deepEqual(banishTop.args.objects, {
    kind: "constant",
    value: { zone: "deck", from: "top" }
  });
  assert.deepEqual(banishTop.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(banishTop.args.linkKey, { kind: "constant", value: "banished-card" });
  assert.equal(banishTop.targets, undefined, "the deck top is not chosen by the player");
});

test("rad-067-167 Clocktower Guardian: 'You may play it, ignoring its Energy cost' is an optional play with Energy set to zero (356.1.b.2 / 420.3)", () => {
  assert.equal(mayPlay.op, "choice.optional");
  assert.deepEqual(mayPlay.args.prompt, {
    kind: "constant",
    value: "Play the banished card?"
  });
  assert.equal(mayPlay.args.body.value.length, 1);

  assert.equal(playBanished.op, "effect.play");
  assert.equal(playBanished.linkedTo, "clocktower-guardian.banish-top");
  assert.deepEqual(playBanished.args.player, {
    kind: "linked-value",
    instructionId: "clocktower-guardian.deathknell-bind-controller",
    key: "controller"
  });
  assert.deepEqual(playBanished.args.object, {
    kind: "linked-value",
    instructionId: "clocktower-guardian.banish-top",
    key: "banished-cardObject"
  });
  // 356.1.b.2: only the base Energy cost is set to zero; Power is untouched.
  assert.deepEqual(playBanished.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0 }
  });
  assert.equal(
    Object.hasOwn(playBanished.args.cost.value, "power"),
    false,
    "no blanket ignore-all-costs: only Energy is zeroed (356.1.b.2)"
  );
});

test("rad-067-167 Clocktower Guardian: Deathknell expansion carries its leave-trigger body", () => {
  const deathknellDefinition = keywordDefinitionsById.get("Deathknell");
  assert.notEqual(deathknellDefinition, undefined);
  const [expanded] = deathknellDefinition.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expanded.kind, "triggered");
  assert.equal(expanded.trigger.at, "object-killed");
  assert.equal(expanded.body[0].op, "trigger.leave");
});

test("rad-067-167 Clocktower Guardian: the Predict 3 body executes against the reference kernel (437.1 / 437.1.a)", () => {
  const kernel = world().deck(["top", "second", "third", "fourth"]).build();
  const range = kernel.zoneSlice("A", "deck", "top", 3).map(object => object.ref);

  const looked = runInstruction(
    inspect,
    {
      player: { kind: "constant", value: "A" },
      zone: { kind: "constant", value: "deck" },
      scope: { kind: "constant", value: "picks" },
      picksSpecId: { kind: "constant", value: "clocktower-guardian.predict-range" },
      choose: { kind: "constant", value: true },
      chooseCount: { kind: "constant", value: { min: 0, max: 3 } },
      pickedKey: { kind: "constant", value: "clocktower-guardian.predicted" },
      choosePicksKey: { kind: "constant", value: "clocktower-guardian.recycle" }
    },
    {
      world: kernel,
      picks: { "clocktower-guardian.predict-range": range },
      answers: { "effect.inspect:select:A:A:deck": [range[0], range[2]] }
    }
  );
  assert.equal(looked.result.status, "executed");
  assert.equal(looked.linked.inspected, 3);
  assert.deepEqual(looked.linked["clocktower-guardian.predicted"], range);
  assert.deepEqual(looked.linked["clocktower-guardian.recycle"], [range[0], range[2]]);
  assert.equal(kernel.player("A").deckSize, 4, "looking never moves cards");

  const recycled = runInstruction(
    recycle,
    { objects: { kind: "constant", value: [range[0], range[2]] } },
    { world: kernel }
  );
  assert.equal(recycled.result.status, "executed");
  assert.equal(recycled.linked.recycledCount, 2);

  const reordered = runInstruction(
    order,
    {
      destination: { kind: "constant", value: "top" },
      count: { kind: "constant", value: 1 },
      chooseOrder: { kind: "constant", value: true }
    },
    { world: kernel }
  );
  assert.equal(reordered.result.status, "executed");
  assert.equal(reordered.linked.ordered, 1);
  const deckIds = kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id);
  assert.equal(deckIds[0], range[1].id, "the kept card goes back on top in the chosen order");
});

test("rad-067-167 Clocktower Guardian: the printed Predict body binds its controller and resolves in order (437.1)", () => {
  const kernel = world()
    .unit("clocktower-guardian", { owner: "A", controller: "A", zone: "board", might: 8 })
    .deck(["top", "second", "third", "fourth"])
    .build();
  const source = kernel.getObject("clocktower-guardian");
  const scoped = kernel.clone({ sourceSnapshot: source });
  const range = kernel.zoneSlice("A", "deck", "top", 3).map(object => object.ref);
  scoped.setPicks("clocktower-guardian.predict-range", range);
  scoped.setAnswers({
    "clocktower-guardian.predict-look/clocktower-guardian.predict": [range[0], range[2]]
  });

  const outcome = resolveChainBody(played.body, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [
      ["clocktower-guardian.bind-controller", "executed"],
      ["clocktower-guardian.predict-look", "executed"],
      ["clocktower-guardian.recycle-predicted", "executed"],
      ["clocktower-guardian.replace-predicted", "executed"]
    ]
  );
  assert.equal(outcome.linkedValues["clocktower-guardian.bind-controller.controller"], "A");
  assert.equal(outcome.linkedValues["clocktower-guardian.predict-look.inspected"], 3);
  assert.deepEqual(outcome.linkedValues["clocktower-guardian.recycle-predicted.recycledCount"], 2);
  // The unselected second card remains on top; the two selected cards recycle to
  // the bottom in the kernel's actual recycle action order.
  assert.deepEqual(scoped.zone("A", "deck").map(ref => ref.id), ["second", "fourth", "top", "third"]);
});

test("rad-067-167 Clocktower Guardian: effect.banish really banishes the deck top and links it (428.1)", () => {
  const source = { kind: "constant", value: { zone: "deck", player: "A", from: "top" } };
  const kernel = world()
    .unit("clocktower-guardian", { might: 8 })
    .deck(["top-card", "second-card"])
    .build();
  const run = runInstruction(
    banish,
    { objects: source, amount: { kind: "constant", value: 1 }, linkKey: { kind: "constant", value: "banished-card" } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  // A custom linkKey replaces the default "banished" family with its own keys (428.1).
  assert.equal(run.linked["banished-cardCount"], 1);
  assert.deepEqual(run.linked["banished-card"].objects, [{ id: "top-card", zoneEntryId: 2 }]);
  assert.equal(kernel.player("A").deckSize, 1);
  const banished = kernel.query({ zone: "banishment" });
  assert.equal(banished.length, 1);
  assert.equal(banished[0].ref.id, "top-card", "the deck top is the first card in zone order");
  assert.equal(kernel.zoneSlice("A", "deck", "top")[0].ref.id, "second-card");
  // The linked object reference is what the optional play consumes.
  assert.deepEqual(run.linked["banished-cardObject"], banished[0].ref);
});

test("rad-067-167 Clocktower Guardian: the optional play half could move the banished card out with a finalized zero-Energy plan (420.3)", () => {
  const kernel = world()
    .unit("clocktower-guardian", { might: 8 })
    .object("banished-card", { zone: "banishment", types: ["unit"] })
    .build();
  const ref = kernel.ref("banished-card");
  const run = runInstruction(
    play,
    {
      object: { kind: "constant", value: ref },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      cost: { kind: "constant", value: { finalized: true, energy: 0 } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.played, 1);
  assert.equal(kernel.getObject("banished-card").zone, "board");
  assert.deepEqual(kernel.getObject("banished-card").location, { type: "base", player: "A" });
});

test("rad-067-167 Clocktower Guardian: the Deathknell effect body binds its controller and can execute banish plus optional play", () => {
  const kernel = world()
    .unit("clocktower-guardian", { owner: "A", controller: "A", zone: "board", might: 8 })
    .deck(["top-card", "second-card"])
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("clocktower-guardian") });
  scoped.setAnswers({ "clocktower-guardian.may-play/optional": true });

  const outcome = resolveChainBody(dying.body, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [
      ["clocktower-guardian.deathknell-bind-controller", "executed"],
      ["clocktower-guardian.banish-top", "executed"],
      ["clocktower-guardian.play-banished", "executed"],
      ["clocktower-guardian.may-play", "executed"]
    ]
  );
  assert.equal(outcome.linkedValues["clocktower-guardian.deathknell-bind-controller.controller"], "A");
  assert.equal(scoped.getObject("top-card").zone, "board");
  assert.equal(scoped.getObject("second-card").zone, "deck");
});

test.todo(
  "rad-067-167 Clocktower Guardian: [Predict 3] as a reusable keyword expansion (437) — the Predict " +
    "KeywordDef has no registered Predict expansion; the existing Vision keyword inlines only Predict 1"
);

test.todo(
  "rad-067-167 Clocktower Guardian: [Deathknell] trigger.leave must enter the chain before the " +
    "permanent reaches Trash (808.1.d.2); the leave-trigger consumer and event ordering remain open"
);

test.todo(
  "rad-067-167 Clocktower Guardian: generate a dynamic finalized cost plan from the banished card that " +
    "zeros only Base Energy while retaining its other costs (356.1.b.2 / 420.3)"
);
