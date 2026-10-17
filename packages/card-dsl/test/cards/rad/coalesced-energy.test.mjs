import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/coalesced-energy.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));

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
  // turn-end now has a merged emitter and the program adapter exists. The
  // remaining gap is the closed EventPattern vocabulary for phase timings.
  assert.match(program.judgeReason, /turn-end/);
  assert.match(program.judgeReason, /317\.1\.a/);
  assert.match(program.judgeReason, /EventPattern/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
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

test.todo(
  "rad-016-167 Coalesced Energy: the printing is a Unit (4 Might / 4 Energy / 2 Mind Power, " +
    "Shurima) per the official RAD-016/167 image, while packages/card-data/data/deck-catalog.json " +
    "records cardType 'Spell' and might 4 — a card-data defect reported by this task (not edited here)"
);
