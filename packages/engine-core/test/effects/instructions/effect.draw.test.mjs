import assert from "node:assert/strict";
import test from "node:test";

import draw from "../../../src/effects/instructions/effect.draw.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "constant", value });
const zero = literal(0);
const one = literal(1);
const two = literal(2);

test("effect.draw moves cards from the Main Deck to Hand and links the actual count", () => {
  const kernel = world().deck("bottom-ish").deck("top-most").build();
  const run = runInstruction(draw, { amount: two }, { world: kernel });

  assert.equal(draw.op, "effect.draw");
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 0);
  assert.equal(kernel.player("B").handSize, 0);
  assert.equal(run.linked.drawn, 2);
  assert.equal(run.linked.drawnTo, "A");
  assert.deepEqual(run.result.linkedValues, { drawn: 2, drawnTo: "A" });
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
  assert.equal(kernel.history({ action: "draw", player: "A" }), 1);
});

test("effect.draw with amount 0 performs no draw and links zero", () => {
  const kernel = world().deck("card").build();
  const run = runInstruction(draw, { amount: zero }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 0);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(run.linked.drawn, 0);
});

test("effect.draw draws as many as possible when the amount exceeds the deck (CR 414.4a)", () => {
  const kernel = world().deck("one").deck("two").build();
  const run = runInstruction(draw, { amount: literal(5) }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("effect.draw on an empty Main Deck links zero (Burn Out stays with the kernel)", () => {
  const kernel = world().build();
  const run = runInstruction(draw, { amount: one }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test("effect.draw is negated when the draw action is replaced", () => {
  const kernel = world().deck("card").build();
  kernel.addReplacement(action => (action.type === "draw" ? "replaced" : null));
  const run = runInstruction(draw, { amount: one }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(run.linked, {});
  assert.equal(run.events[0].action, "draw");
  assert.equal(run.events[0].outcome, "replaced");
});

test("effect.draw maps a prevented draw to negated/skipped", () => {
  const kernel = world().deck("card").build();
  kernel.addReplacement(action => (action.type === "draw" ? "prevented" : null));
  const run = runInstruction(draw, { amount: one }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.player("A").handSize, 0);
});

test("effect.draw ignores a target whose object left its zone (old zoneEntryId)", () => {
  const kernel = world().unit("vanishing").deck("card").build();
  const stale = kernel.ref("vanishing");
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "trash" }).status, "done");
  const before = kernel.stateForTest();

  const run = runInstruction(draw, { target: "chosen", amount: one }, {
    world: kernel,
    targets: { chosen: [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.deepEqual(kernel.stateForTest(), before);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(run.linked, {});
});

test("effect.draw keeps the legal targets when only part of the target group is stale", () => {
  const kernel = world().unit("survivor").unit("leaver").deck("card").build();
  const stale = kernel.ref("leaver");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");

  const run = runInstruction(draw, { target: "chosen", amount: one }, {
    world: kernel,
    targets: { chosen: [stale, kernel.ref("survivor")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawnTo, "A");
  // The returned "leaver" is already in hand (1), plus the drawn card (1).
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("effect.draw asks for the drawing player when the target group spans controllers", () => {
  const kernel = world()
    .unit("ally")
    .unit("enemy", { owner: "B" })
    .deck("a-card")
    .deck("b-card", { owner: "B" })
    .build();
  const args = {
    target: "chosen",
    amount: one,
    choice: { id: "drawing-player", prompt: "Choose the player who draws" }
  };
  const targets = { chosen: [kernel.ref("ally"), kernel.ref("enemy")] };

  const asked = runInstruction(draw, args, { world: kernel, targets });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.id, "drawing-player");
  assert.equal(asked.asked.request.type, "mode");
  assert.equal(asked.asked.request.chooser, "A");
  assert.deepEqual(asked.asked.request.options, ["A", "B"]);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("B").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(kernel.player("B").deckSize, 1);

  const answered = runInstruction(draw, args, {
    world: kernel,
    targets,
    answers: { "drawing-player": "B" }
  });
  assert.equal(answered.result.status, "executed");
  assert.equal(answered.linked.drawnTo, "B");
  assert.equal(answered.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("B").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(kernel.player("B").deckSize, 0);
});

test("effect.draw negates an out-of-range choice answer instead of drawing", () => {
  const kernel = world().unit("ally").unit("enemy", { owner: "B" }).deck("card").build();
  const run = runInstruction(draw, {
    target: "chosen",
    amount: one,
    choice: { id: "drawing-player" }
  }, {
    world: kernel,
    targets: { chosen: [kernel.ref("ally"), kernel.ref("enemy")] },
    answers: { "drawing-player": "C" }
  });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("B").handSize, 0);
});

test("effect.draw reads a non-target pick, including an ObjectRef resolved via last-known info", () => {
  const kernel = world()
    .unit("enemy-gear", { owner: "B", types: ["gear"], zone: "board" })
    .deck("b-card", { owner: "B" })
    .build();
  const ref = kernel.ref("enemy-gear");
  assert.equal(kernel.perform({ type: "kill", object: ref }).status, "done");
  assert.equal(kernel.object(ref), null);

  const run = runInstruction(draw, { pick: "recipient", amount: one }, {
    world: kernel,
    picks: { recipient: [ref] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawnTo, "B");
  assert.equal(kernel.player("B").handSize, 1);
  assert.equal(kernel.player("A").handSize, 0);
});

test("effect.draw accepts a static PlayerId and an evaluated player Expr", () => {
  const staticKernel = world().deck("card", { owner: "B" }).build();
  const staticRun = runInstruction(draw, { player: "B", amount: one }, { world: staticKernel });
  assert.equal(staticRun.result.status, "executed");
  assert.equal(staticKernel.player("B").handSize, 1);
  assert.equal(staticKernel.player("A").handSize, 0);

  const exprKernel = world().deck("card", { owner: "B" }).build();
  const exprRun = runInstruction(draw, { player: literal("B"), amount: one }, { world: exprKernel });
  assert.equal(exprRun.result.status, "executed");
  assert.equal(exprKernel.player("B").handSize, 1);
});

test("effect.draw evaluates a linked count expression for the amount", () => {
  const kernel = world().deck("one").deck("two").build();
  const run = runInstruction(draw, {
    amount: { kind: "linked-value", instructionId: "previous", key: "cards" }
  }, { world: kernel, linked: { cards: 2 } });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(kernel.player("A").handSize, 2);
});

test("effect.draw negates an unknown player and invalid amounts instead of drawing", () => {
  const unknown = world().deck("card").build();
  const unknownRun = runInstruction(draw, { player: "C", amount: one }, { world: unknown });
  assert.equal(unknownRun.result.status, "negated");
  assert.equal(unknownRun.result.reason, "impossible");
  assert.equal(unknown.player("A").deckSize, 1);

  for (const amount of [literal(-1), literal(1.5), literal("two")]) {
    const kernel = world().deck("card").build();
    const run = runInstruction(draw, { amount }, { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, "impossible");
    assert.equal(kernel.player("A").handSize, 0);
  }
});

test("effect.draw argsSchema rejects ambiguous recipient sources", () => {
  assert.throws(
    () => draw.argsSchema.parse({ target: "chosen", player: "A", amount: one }),
    /only one of target, pick, or player/
  );
  assert.throws(
    () => draw.argsSchema.parse({ amount: one, choice: { id: "" } }),
    /choice.id/
  );
  assert.throws(
    () => draw.argsSchema.parse({ amount: one, linkKey: "drawnTo" }),
    /reserved "drawnTo" key/
  );
});

test("ogn-213-298 Hidden Blade: a linked unit reference makes its controller draw 2", () => {
  const kernel = world()
    .unit("hidden-blade-target", { owner: "B" })
    .deck("one", { owner: "B" })
    .deck("two", { owner: "B" })
    .build();
  const ref = kernel.ref("hidden-blade-target");
  assert.equal(kernel.perform({ type: "kill", object: ref }).status, "done");

  const run = runInstruction(draw, {
    amount: two,
    player: { kind: "linked-value", instructionId: "kill", key: "killed" }
  }, { world: kernel, linked: { killed: ref } });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawnTo, "B");
  assert.equal(kernel.player("B").handSize, 2);
  assert.equal(kernel.player("A").handSize, 0);
});

test("ogn-083-298 Consult the Past: Draw 2 (M1 Rumble deck)", () => {
  const kernel = world().deck("first").deck("second").build();
  const run = runInstruction(draw, { amount: two }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("sfd-048-221 Stellacorn Herder: When I move, draw 1", () => {
  const kernel = world().unit("stellacorn-herder", { owner: "A", zone: "board" }).deck("card").build();
  const run = runInstruction(draw, { amount: one }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
});

test("ogn-099-298 Garbage Grabber: Recycle 3 from your trash, [1], [E]: Draw 1", () => {
  const kernel = world().object("garbage-grabber", { owner: "A", types: ["gear"], zone: "board" }).deck("card").build();
  const run = runInstruction(draw, { amount: one }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
});

test("sfd-076-221 Production Surge: draw 1 after the token is played (M1 Rumble deck)", () => {
  const kernel = world().deck("card").build();
  const run = runInstruction(draw, { amount: one }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
});

test("sfd-106-221 Show of Strength: draw 1 for each Mighty unit (M1 Fiora deck)", () => {
  const kernel = world()
    .unit("mighty-one", { controller: "A", might: 6 })
    .unit("mighty-two", { controller: "A", might: 5 })
    .deck("card-a")
    .deck("card-b")
    .build();
  const run = runInstruction(draw, {
    amount: {
      kind: "count",
      subject: "mighty-units",
      filter: { zone: "board", controller: "A" }
    }
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(kernel.player("A").handSize, 2);
});

test("sfd-167-221 Unsung Hero: Deathknell draw 2 for the controller (M1 Fiora deck)", () => {
  const kernel = world()
    .unit("unsung-hero", { owner: "A", might: 6, zone: "board" })
    .deck("card-a")
    .deck("card-b")
    .build();
  const run = runInstruction(draw, { amount: two }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(kernel.player("A").handSize, 2);
});
