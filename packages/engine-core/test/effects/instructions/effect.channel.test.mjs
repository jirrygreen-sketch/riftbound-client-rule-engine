import assert from "node:assert/strict";
import test from "node:test";

import channel from "../../../src/effects/instructions/effect.channel.ts";
import {
  AwaitChoice,
  runInstruction,
  world
} from "../../../src/effects/testing/index.ts";

const zero = { kind: "constant", value: 0 };
const one = { kind: "constant", value: 1 };
const two = { kind: "constant", value: 2 };
const asPlayer = { kind: "constant", value: "A" };

test("effect.channel channels a rune from the rune deck readied by default", () => {
  const kernel = world().rune("r1").rune("r2").build();
  const run = runInstruction(channel, { player: "A", amount: one }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.getObject("r2").zone, "rune-zone");
  assert.equal(kernel.getObject("r1").zone, "rune-deck");
});

test("ogn-216-298 Soaring Scout: Deathknell channels 1 rune exhausted", () => {
  const kernel = world().rune("r1").build();
  const run = runInstruction(
    channel,
    { player: "A", amount: one, exhausted: true },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.equal(kernel.player("A").runePool.length, 1);
});

test("rad-029-167 Life from Stone: channel 1 rune exhausted links the actual count", () => {
  const kernel = world().rune("r1").rune("r2").build();
  const run = runInstruction(
    channel,
    { player: "A", amount: one, exhausted: true },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.linked("channeled"), 1);
});

test("sfd-205-221 Grand Duelist (M1 Fiora deck): Mighty trigger channels 1 rune exhausted", () => {
  const kernel = world().rune("r1").rune("r2").build();
  const run = runInstruction(
    channel,
    { player: "A", amount: one, exhausted: true },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.getObject("r2").zone, "rune-zone");
});

test("effect.channel channels as many runes as possible on shortfall (CR 431.3)", () => {
  const kernel = world().rune("r1").build();
  const run = runInstruction(channel, { player: "A", amount: two }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.equal(kernel.player("A").runePool.length, 1);
});

test("effect.channel with an empty rune deck executes with zero channeled (CR 431.3)", () => {
  const kernel = world().build();
  const run = runInstruction(channel, { player: "A", amount: two }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
  assert.equal(kernel.player("A").runePool.length, 0);
});

test("effect.channel amount 0 executes without touching the rune deck", () => {
  const kernel = world().rune("r1").build();
  const run = runInstruction(channel, { player: "A", amount: zero }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 0);
});

test("effect.channel is negated when a replacement hook replaces the channel-rune action", () => {
  const kernel = world().rune("r1").build();
  kernel.addReplacement((action) => (action.type === "channel-rune" ? "replaced" : null));
  const run = runInstruction(channel, { player: "A", amount: one }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 0);
  assert.equal(kernel.linked("channeled"), undefined);
});

test("effect.channel is negated when the channel-rune action is impossible", () => {
  const kernel = world().rune("r1").build();
  const run = runInstruction(channel, { player: "C", amount: one }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.player("A").runeDeckSize, 1);
});

test("effect.channel negates when a target player reference has left its zone (stale zoneEntryId)", () => {
  const kernel = world().hand("moved").build();
  const staleRef = kernel.ref("moved");
  kernel.perform({ type: "discard", object: staleRef });
  assert.equal(kernel.object(staleRef), null);
  const playerFromStale = { kind: "object-property", object: staleRef, property: "controller" };
  const run = runInstruction(channel, { player: playerFromStale, amount: one }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.player("A").runeDeckSize, 0);
});

test("effect.channel suspends on choose and replays with the answered amount", () => {
  const kernel = world().rune("r1").rune("r2").build();
  const request = {
    id: "channel-count",
    type: "number",
    min: 1,
    max: 2,
    chooser: "A",
    visibility: "public"
  };
  const choosing = {
    op: "effect.channel",
    argsSchema: channel.argsSchema,
    execute(ctx, args) {
      const chosen = ctx.choose(request);
      return channel.execute(ctx, { ...args, amount: { kind: "constant", value: chosen } });
    }
  };
  const asked = runInstruction(choosing, { player: "A", amount: one }, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.id, "channel-count");
  assert.equal(kernel.player("A").runeDeckSize, 2);
  const answered = runInstruction(
    choosing,
    { player: "A", amount: one },
    { world: kernel, answers: { "channel-count": 2 } }
  );
  assert.equal(answered.result.status, "executed");
  assert.equal(answered.linked.channeled, 2);
  assert.equal(kernel.player("A").runePool.length, 2);
});

test("effect.channel defaults to the controller when no player arg is given", () => {
  const kernel = world().rune("r1").build();
  const run = runInstruction(channel, { amount: one }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.player("B").runePool.length, 0);
});

test("effect.channel evaluates a player Expr", () => {
  const kernel = world().rune("r1").build();
  const run = runInstruction(channel, { player: asPlayer, amount: one }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").runePool.length, 1);
});

test("effect.channel rejects invalid amounts as impossible", () => {
  const negativeKernel = world().rune("r1").build();
  const negative = runInstruction(
    channel,
    { player: "A", amount: { kind: "constant", value: -1 } },
    { world: negativeKernel }
  );
  assert.equal(negative.result.status, "negated");
  assert.equal(negative.result.reason, "impossible");
  assert.equal(negativeKernel.player("A").runeDeckSize, 1);
  const fractionalKernel = world().rune("r1").build();
  const fractional = runInstruction(
    channel,
    { player: "A", amount: { kind: "constant", value: 1.5 } },
    { world: fractionalKernel }
  );
  assert.equal(fractional.result.status, "negated");
  assert.equal(fractionalKernel.player("A").runeDeckSize, 1);
});
