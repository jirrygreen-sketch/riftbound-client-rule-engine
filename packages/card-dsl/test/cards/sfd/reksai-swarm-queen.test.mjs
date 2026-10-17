import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/reksai-swarm-queen.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import {
  bindResolveContext,
  createActionPipelineHost
} from "../../../../engine-core/dist/events/action-adapter.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL = "card.hash-66da1ff0419b3ebf3d4e801af0a225acbd65b392adf96224c9e14101755c0716";
const [ability] = program.abilities;
const [mayReveal] = ability.body;
const [revealInstruction, mayPlay, recycleRest] = mayReveal.args.body.value;
const [playOne] = mayPlay.args.body.value;

test("sfd-170-221 Rek'Sai, Swarm Queen: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /ordered picks/);
  assert.match(program.judgeReason, /RIFT-66/);
  assert.match(program.judgeReason, /费用路径已合入/);
  assert.match(program.judgeReason, /印刷费用/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /attack-declared/);
  // The type gate is expressible; the gap is the missing object list on
  // effect.play's receipt.
  assert.match(program.judgeReason, /played 计数|linkKey/);
  assert.equal(
    program.sourceText,
    "When I attack, you may reveal the top 2 cards of your Main Deck. You may play one. Then " +
      "recycle the rest. If the played card is a unit, you may play it here."
  );
});

test("sfd-170-221 Rek'Sai, Swarm Queen: attack trigger with the optional reveal wrapper", () => {
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "attack-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  // Contract 3.9: "you may reveal ..." wraps the chosen instructions in body.
  assert.equal(mayReveal.id, "reksai.may-reveal");
  assert.equal(mayReveal.op, "choice.optional");
  assert.deepEqual(mayReveal.args.body.value.map((entry) => entry.id), [
    "reksai.reveal",
    "reksai.may-play",
    "reksai.recycle-rest"
  ]);
});

test("sfd-170-221 Rek'Sai, Swarm Queen: reveal reads the ordered top-two pick, rest recycles", () => {
  // 425.1 / 425.2.a reveal of a Secret zone; the top-2 slice must arrive as an
  // ordered pick because query order is not deck order (RIFT-66 zoneSlice).
  assert.equal(revealInstruction.op, "effect.reveal");
  assert.deepEqual(revealInstruction.args.pick, {
    kind: "constant",
    value: "reksai.top-two"
  });
  assert.deepEqual(revealInstruction.picks, [
    {
      id: "reksai.top-two",
      options: [], ordered: true, selection: "all",
      zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 2 } }
    }
  ]);

  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.linkedTo, "reksai.reveal");
  assert.equal(playOne.op, "effect.play");
  assert.equal(playOne.linkedTo, "reksai.reveal");
  assert.equal(playOne.args.location, undefined);
  assert.deepEqual(playOne.picks, [{
    id: "reksai.revealed-play", options: [], ordered: true, selection: "all",
    linked: { kind: "linked-value", instructionId: "reksai.reveal", key: "revealed" }
  }]);
  assert.deepEqual(playOne.args.choice, { kind: "constant", value: { id: "reksai.choose-one", min: 1, max: 1 } });
  assert.deepEqual(playOne.args.amount, { kind: "constant", value: 1 });

  // 417.1.a/417.1.c: the rest go to the bottom of their owner's Main Deck.
  assert.equal(recycleRest.op, "effect.recycle");
  assert.equal(recycleRest.linkedTo, "reksai.reveal");
  assert.deepEqual(recycleRest.args.objects, {
    kind: "linked-value",
    instructionId: "reksai.reveal",
    key: "revealed"
  });
});

test("sfd-170-221 Rek'Sai, Swarm Queen: the merged reveal primitive reveals the locked ordered top two", () => {
  const kernel = world().player("A").deck(["c1", "c2", "c3"]).build();
  const top = kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref);
  assert.deepEqual(top.map((ref) => ref.id), ["c1", "c2"]);
  const run = runInstruction(
    reveal,
    { pick: "reksai.top-two" },
    { world: kernel, picks: { "reksai.top-two": top } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.revealed, top);
  assert.equal(run.linked.revealedCount, 2);
  // 425.1.a.2: revealed cards stay in their zone, order unchanged.
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["c1", "c2", "c3"]);
});

test("sfd-170-221 Rek'Sai, Swarm Queen: the original reveal Expr executes through the chain adapter with ordered picks", () => {
  const base = world()
    .unit("reksai", { owner: "A", might: 5 })
    .deck(["c1", "c2", "c3"])
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("reksai") });
  const top = kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref);
  kernel.setPicks(revealInstruction.picks[0].id, top);
  assert.deepEqual(kernel.picks("reksai.top-two"), top);
  assert.deepEqual(top.map((ref) => ref.id), ["c1", "c2"]);

  const outcome = resolveChainBody([revealInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["reksai.reveal.revealed"], top);
  assert.equal(outcome.linkedValues["reksai.reveal.revealedCount"], 2);
  assert.deepEqual(kernel.events.map(event => event.action), ["reveal", "reveal"]);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["c1", "c2", "c3"]);
});

// Isolate the supported body from the still-blocked attack event and here
// permission. Actual plays use the production card-program adapter, derive
// printed cost, enter the chain, and resolve their own effects.
function chainFixture({ revealCards = true, playCard = true, deck = ["c1", "c2", "c3"], types = ["spell"] } = {}) {
  const kernel = world()
    .player("A", { energy: 20, power: ["Fury"] })
    .unit("reksai", { cardId: CANONICAL, energy: 5, power: ["Order"], might: 5, location: { type: "battlefield", id: "bf-1" } })
    .deck(deck, { cardId: "synthetic:revealed", types, energy: 3, power: ["Fury"], might: types.includes("unit") ? 3 : null })
    .build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "optional" && request.id === "reksai.may-reveal/optional") return revealCards;
    if (request.type === "optional" && request.id.includes("reksai.may-play")) return playCard;
    if (request.type === "select-objects" && request.id.includes("reksai.choose-one")) {
      return [request.options.at(-1)];
    }
    throw new AwaitChoice(request);
  };
  const binding = createProgramBinding({ cardPrograms: [{
    canonicalCardId: "synthetic:revealed", rulesetVersion: "core-1.5", status: "executable",
    sourceText: types.includes("spell") ? "Draw 1." : "Synthetic vanilla unit.",
    abilities: [{ kind: "play", body: types.includes("spell") ? [{ id: "revealed.draw", op: "effect.draw", args: { amount: { kind: "constant", value: 1 } } }] : [] }]
  }] });
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    describePlay: binding.describePlay,
    cleanup: chain => {
      let changed = false;
      for (const object of kernel.objects) {
        if (object.zone === "board" && object.types.includes("unit") && object.might !== null &&
            (object.might <= 0 || object.damage >= object.might)) {
          changed = chain.commit({ type: "kill", object: object.ref }).status === "done" || changed;
        }
      }
      return changed;
    }
  });
  const top = kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
  engine.execute({ id: "reksai-body", source: kernel.getObject("reksai"), controller: "A", kind: "activated", speed: "reaction", body: ability.body });
  assert.deepEqual(engine.items[0].pickPlans, [{ id: "reksai.top-two", refs: top }]);
  assert.deepEqual(requests, [], "Finalize locks references without revealing cards or asking Resolve choices");
  assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "card-revealed").length, 0);
  return { kernel, engine, top, requests };
}

test("sfd-170-221 Rek'Sai, Swarm Queen: recycling the rest drops references actually played through the chain", () => {
  const { kernel, engine, top, requests } = chainFixture();
  resolveAll(engine);
  assert.deepEqual(kernel.linked("reksai.may-reveal/reksai.reveal.revealed"), top);
  assert.deepEqual(kernel.linked("reksai.may-reveal/reksai.recycle-rest.recycled"), [top[0]]);
  assert.equal(kernel.linked("reksai.may-reveal/reksai.recycle-rest.recycledCount"), 1);
  assert.equal(kernel.linked("reksai.may-reveal/reksai.may-play/reksai.play-one.played"), 1);
  assert.equal(kernel.getObject("c2").zone, "trash", "the chosen spell really resolves");
  assert.equal(kernel.getObject("c3").zone, "hand", "the played spell's own Draw 1 resolves");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["c1"]);
  const selection = requests.find(request => request.id.includes("reksai.choose-one"));
  assert.deepEqual(selection.options, top);
  assert.equal(selection.min, 1);
  assert.equal(selection.max, 1);
  assert.equal(kernel.player("A").energy, 17);
  assert.deepEqual(kernel.snapshot().history.filter(entry => entry.action.type === "pay").map(entry => entry.action.plan), [
    { finalized: true, energy: 3, power: ["Fury"] }
  ]);
  assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "card-played").length, 1);
  assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);
});

test("sfd-170-221 Rek'Sai, Swarm Queen: declining the reveal skips the whole chosen body", () => {
  const { kernel, engine } = chainFixture({ revealCards: false });
  resolveAll(engine);
  assert.equal(kernel.player("A").deckSize, 3);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["c1", "c2", "c3"]);
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.linked("reksai.may-reveal/reksai.reveal.revealed"), undefined);
  assert.equal(kernel.player("A").energy, 20);
});

test("sfd-170-221 Rek'Sai, Swarm Queen: declining the optional wrapper retains its skipped result", () => {
  const kernel = world().deck(["c1", "c2", "c3"]).unit("reksai", { might: 5 }).build();
  kernel.setAnswers({ "reksai.may-reveal/optional": false });
  const outcome = resolveChainBody(ability.body, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["reksai.may-reveal", "negated", "skipped"]
  ]);
  assert.equal(kernel.player("A").deckSize, 3);
  assert.deepEqual(outcome.events, []);
});

test("sfd-170-221 Rek'Sai, Swarm Queen: accepting reveal but declining play recycles the revealed cards", () => {
  const { kernel, engine, top } = chainFixture({ playCard: false });
  resolveAll(engine);
  assert.deepEqual(kernel.linked("reksai.may-reveal/reksai.reveal.revealed"), top);
  assert.equal(kernel.linked("reksai.may-reveal/reksai.recycle-rest.recycledCount"), 2);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id).slice(0, 1), ["c3"]);
  assert.deepEqual(new Set(kernel.zone("A", "deck").map(ref => ref.id).slice(1)), new Set(["c1", "c2"]));
  assert.equal(kernel.player("A").energy, 20);
  assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "card-played").length, 0);
});

test("sfd-170-221 Rek'Sai, Swarm Queen: Finalize uses all available cards from a short deck", () => {
  const { kernel, engine, top } = chainFixture({ deck: ["c1"], playCard: false });
  resolveAll(engine);
  assert.equal(top.length, 1);
  assert.deepEqual(kernel.linked("reksai.may-reveal/reksai.reveal.revealed"), top);
  assert.equal(kernel.linked("reksai.may-reveal/reksai.reveal.revealedCount"), 1);
  assert.equal(kernel.linked("reksai.may-reveal/reksai.recycle-rest.recycledCount"), 1);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["c1"]);
});

test("sfd-170-221 Rek'Sai, Swarm Queen: a chain play derives and pays the printed unit cost", () => {
  const { kernel, engine } = chainFixture({ types: ["unit"] });
  resolveAll(engine);
  assert.equal(kernel.player("A").energy, 17);
  assert.deepEqual(kernel.snapshot().history.filter(entry => entry.action.type === "pay").map(entry => entry.action.plan), [
    { finalized: true, energy: 3, power: ["Fury"] }
  ]);
  assert.equal(kernel.getObject("c2").zone, "board");
  // Ordinary effect.play entry remains the control case; offering the extra
  // unit-only here destination is the separate TODO below.
  assert.deepEqual(kernel.getObject("c2").location, { type: "base", player: "A" });
  assert.equal(kernel.linked("reksai.may-reveal/reksai.may-play/reksai.play-one.played"), 1);
  assert.equal(kernel.linked("reksai.may-reveal/reksai.may-play/reksai.play-one.playedObjects"), undefined);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["c3", "c1"]);
});

test.todo(
  "sfd-170-221 Rek'Sai, Swarm Queen: combat start must emit attack-declared for the real attack trigger (CR 383.4.e / RIFT-124)"
);

test.todo(
  "sfd-170-221 Rek'Sai, Swarm Queen: gate the 'you may play it here' entry-location choice on the played unit " +
    "(CR 355.2.b); effect.play still links only its played count, with no played object reference for the types gate"
);
