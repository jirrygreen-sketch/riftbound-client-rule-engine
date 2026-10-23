import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/coalesced-energy.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { EventPipeline } = await import(new URL("events/pipeline.js", engineCore));
const { assertTriggerSpec } = await import(new URL("events/trigger-spec.js", engineCore));

const CANONICAL = "card.hash-5a4ff9de2d69584e442e29d394392ce09de6bc41ca2d52dadd0958701383a1c1";
const [ability] = program.abilities;
const [recycleRunes, channelFour] = ability.body;

test("rad-016-167 Coalesced Energy: program passes validateCardProgram and keeps the printing text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "At the end of your turn, recycle all your runes, then channel 4 runes exhausted."
  );
});

test("rad-016-167 Coalesced Energy: judge-required naming the phase-event filter gap", () => {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason.includes("translateTriggerFilter"));
  assert.ok(program.judgeReason.includes("player:self"));
  // turn-end now has a merged emitter and the program adapter exists. The
  // remaining gap is the closed EventPattern vocabulary for phase timings;
  // the executor test below proves both accepted spellings are wrong.
  assert.match(program.judgeReason, /turn-end/);
  assert.match(program.judgeReason, /317\.1\.a/);
  assert.match(program.judgeReason, /EventPattern/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
  assert.doesNotMatch(program.judgeReason, /RIFT-357/);
});

test("rad-016-167 Coalesced Energy: end-of-turn trigger recycling all runes then channeling 4 exhausted", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 383.1: "At ... a point in time during the turn sequence" is a triggered
  // ability; the end-of-turn step is the merged "turn-end" timing point.
  assert.equal(ability.trigger.at, "turn-end");
  assert.deepEqual(ability.trigger.filter, { event: "turn-end", player: "self" });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);

  assert.deepEqual(ability.body.map((instruction) => instruction.id), [
    "coalesced-energy.recycle-runes",
    "coalesced-energy.channel-4"
  ]);

  // "recycle all your runes": the 417.6 non-targeting "Recycle X from [Zone]"
  // form, with the amount read as the current number of runes in the rune zone
  // (417.4 recycles as many as possible) — never a TargetSpec.
  assert.equal(recycleRunes.op, "effect.recycle");
  assert.equal(recycleRunes.targets, undefined);
  assert.equal(recycleRunes.picks, undefined);
  assert.deepEqual(recycleRunes.args, {
    from: {
      kind: "constant",
      value: {
        zone: "rune-zone",
        owner: "controller",
        amount: {
          kind: "count",
          subject: "runes",
          filter: { zone: "rune-zone", owner: "self" }
        }
      }
    }
  });

  // "then channel 4 runes exhausted": 431.1 + the printed 431.2 stipulation.
  assert.equal(channelFour.op, "effect.channel");
  assert.deepEqual(channelFour.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(channelFour.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelFour.linkedTo, "coalesced-energy.recycle-runes");
});

test("rad-016-167 Coalesced Energy golden: all runes are recycled, then 4 are channeled exhausted", () => {
  const kernel = world()
    .rune(["rune-1", "rune-2", "rune-3", "rune-4", "rune-5", "rune-6"])
    .build();
  // Two runes are already on the board (the rune zone) before the trigger.
  kernel.perform({ type: "channel-rune", player: "A", amount: 2, exhausted: false });
  const onBoard = kernel.zone("A", "rune-zone");
  assert.deepEqual(onBoard.map((ref) => ref.id), ["rune-1", "rune-2"]);

  // Substitute the production "self" controller selector with the concrete
  // player id, exactly as the merged sfd-106-221 Show of Strength golden does
  // for its uncaptured filter compatibility (the reference kernel compares
  // filter scalars literally).
  const body = {
    ...recycleRunes,
    args: {
      from: {
        kind: "constant",
        value: {
          ...recycleRunes.args.from.value,
          amount: {
            kind: "count",
            subject: "runes",
            filter: { zone: "rune-zone", owner: "A" }
          }
        }
      }
    }
  };
  // The recycle asks the controller which cards leave the rune zone (417.6).
  kernel.setAnswers({
    "coalesced-energy.recycle-runes/effect.recycle%3Arune-zone%3Acontroller%3A2": onBoard
  });

  const outcome = resolveChainBody([body, channelFour], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["coalesced-energy.recycle-runes", "executed"],
      ["coalesced-energy.channel-4", "executed"]
    ]
  );
  // CR 417.1.b: the two runes go to the bottom of their owner's Rune Deck; the
  // safe re-entry keeps the same card identity with a new zoneEntryId.
  assert.equal(outcome.linkedValues["coalesced-energy.recycle-runes.recycledCount"], 2);
  assert.deepEqual(
    outcome.linkedValues["coalesced-energy.recycle-runes.recycled"].map((ref) => ref.id),
    ["rune-1", "rune-2"]
  );
  // CR 431.1/431.3: 4 runes channel from the top of the Rune Deck; the rune
  // deck had 4 left, so exactly 4 arrive.
  assert.equal(outcome.linkedValues["coalesced-energy.channel-4.channeled"], 4);
  assert.equal(kernel.player("A").runeDeckSize, 2);
  assert.equal(kernel.player("A").runePool.length, 4);
  assert.deepEqual(
    kernel.zone("A", "rune-zone").map((ref) => ref.id),
    ["rune-3", "rune-4", "rune-5", "rune-6"]
  );
});

test("rad-016-167 Coalesced Energy golden: an empty rune zone still channels the printed 4", () => {
  const kernel = world()
    .rune(["rune-1", "rune-2", "rune-3", "rune-4", "rune-5"])
    .build();
  const body = {
    ...recycleRunes,
    args: {
      from: {
        kind: "constant",
        value: {
          ...recycleRunes.args.from.value,
          amount: {
            kind: "count",
            subject: "runes",
            filter: { zone: "rune-zone", owner: "A" }
          }
        }
      }
    }
  };
  const outcome = resolveChainBody([body, channelFour], kernel);
  // CR 417.4: recycling as many as possible from an empty rune zone is not a
  // failure, and the linked channel still resolves.
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["coalesced-energy.recycle-runes.recycledCount"], 0);
  assert.equal(outcome.linkedValues["coalesced-energy.channel-4.channeled"], 4);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 4);
});

test("rad-016-167 Coalesced Energy golden: a short Rune Deck channels as many as possible (CR 431.3)", () => {
  const kernel = world().rune(["rune-1", "rune-2"]).build();
  const body = {
    ...recycleRunes,
    args: {
      from: {
        kind: "constant",
        value: {
          ...recycleRunes.args.from.value,
          amount: { kind: "count", subject: "runes", filter: { zone: "rune-zone", owner: "A" } }
        }
      }
    }
  };
  const outcome = resolveChainBody([body, channelFour], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["coalesced-energy.channel-4.channeled"], 2);
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.equal(kernel.player("A").runePool.length, 2);
});

test("rad-016-167 Coalesced Energy: the turn-end EventPattern validates without widening to a phase event", () => {
  // CR 317.1.a: the declared turn-end event is accepted by the closed
  // vocabulary. Its player:self filter remains part of the specification, so
  // acceptance does not turn it into an unconditional turn-end subscription.
  assert.doesNotThrow(() => assertTriggerSpec(ability.trigger));
  assert.deepEqual(ability.trigger, {
    at: "turn-end",
    filter: { event: "turn-end", player: "self" }
  });
});

test("rad-016-167 Coalesced Energy: the two accepted spellings are both wrong, so neither is used", () => {
  // Registered through the merged event pipeline:
  // - { controller: "self" } is accepted but a phase emission carries no
  //   event.object/target, so it can never match.
  // - {} would match every player's turn-end, widening "your turn".
  const kernel = world().player("A").player("B").unit("hero", { owner: "A" }).build();
  const host = {
    checkpoint: () => ({}),
    restore: () => {},
    objects: () => kernel.objects,
    execute: (action) => ({ outcome: kernel.perform(action), emissions: [] }),
    context: () => { throw new Error("No context needed"); },
    choose: (request) => { throw new Error(`Unexpected choice: ${request.id}`); }
  };
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const fired = [];
  pipeline.onTrigger = (snapshot) => fired.push(snapshot.registration.id);
  const source = kernel.getObject("hero");

  pipeline.registerTrigger({
    id: "controller-self",
    source,
    controller: "A",
    spec: { at: "turn-end", filter: { controller: "self" } },
    body: []
  });
  pipeline.emit({ timingPoint: "turn-end", player: "A" });
  assert.deepEqual(fired, [], "{ controller: 'self' } never matches a phase event");

  pipeline.registerTrigger({
    id: "empty-filter",
    source,
    controller: "A",
    spec: { at: "turn-end", filter: {} },
    body: []
  });
  pipeline.emit({ timingPoint: "turn-end", player: "B" });
  assert.deepEqual(fired, ["empty-filter"], "{} widens 'your turn' to the opponent's turn-end");
});

test.todo(
  "rad-016-167 Coalesced Energy: the printing is a Unit (4 Might / 4 Energy / 2 Mind Power, " +
    "Shurima) per the official RAD-016/167 image, while packages/card-data/data/deck-catalog.json " +
    "records cardType 'Spell' and might 4 — a card-data defect reported by this task (not edited here)"
);

for (const controller of ["A", "B"]) {
  test(`Coalesced Energy resweep: original body recycles only ${controller}'s runes through ChainEngine`, () => {
    const requests = [];
    const f = fixture({ turnPlayer: controller, choose: request => {
      requests.push(structuredClone(request));
      if (request.type === "select-objects") return [...request.options];
      throw new Error(`Unexpected choice: ${request.id}`);
    } });
    const opponent = controller === "A" ? "B" : "A";
    const source = f.kernel.getObject(controller === "A" ? "source" : "enemy");
    // Initial objects only; the program performs every subsequent zone change.
    for (const [owner, ids, zone] of [
      [controller, ["r1", "r2"], "rune-zone"],
      [controller, ["r3", "r4", "r5", "r6"], "rune-deck"],
      [opponent, ["opponent-rune"], "rune-zone"]
    ]) for (const id of zone === "rune-deck" ? [...ids].reverse() : ids) f.kernel.addObject({
      ...source, ref: { id, zoneEntryId: 1 }, name: id, owner, controller: owner,
      types: ["rune"], zone, location: null, energy: null, power: null, might: null
    }, zone);
    const opponentRunes = f.kernel.zone(opponent, "rune-zone");
    f.engine.advance();
    // This is body evidence only: the printed turn-end subscription remains
    // judge-required. The original IR, including owner:self, is unchanged.
    f.engine.execute({ id: "coalesced-body", controller, source, kind: "activated", speed: "reaction", body: ability.body });
    resolveAll(f.engine);
    assert.equal(f.kernel.linked("coalesced-energy.recycle-runes.recycledCount"), 2);
    assert.equal(f.kernel.linked("coalesced-energy.channel-4.channeled"), 4);
    assert.deepEqual(f.kernel.zone(controller, "rune-zone").map(ref => ref.id), ["r3", "r4", "r5", "r6"]);
    assert.deepEqual(f.kernel.zone(controller, "rune-deck").map(ref => ref.id), ["r1", "r2"]);
    assert.deepEqual(f.kernel.zone(opponent, "rune-zone"), opponentRunes);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].chooser, controller);
    assert.equal(requests[0].visibility, "chooser-only");
    assert.deepEqual(requests[0].options.map(ref => ref.id), ["r1", "r2"]);
    const actions = f.engine.pipeline.events.flatMap(event => event.action ? [event.action] : []);
    const channel = actions.find(action => action.type === "channel-rune");
    assert.deepEqual(channel, { type: "channel-rune", player: controller, amount: 4, exhausted: true });
    assert.deepEqual([...new Set(actions.filter(action => action.type === "recycle").map(action => action.object.id))], ["r1", "r2"]);
    assert.ok(actions.findIndex(action => action.type === "channel-rune") > actions.findIndex(action => action.type === "recycle"));
  });
}
