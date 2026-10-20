import assert from "node:assert/strict";
import test from "node:test";

import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../dist/events/action-adapter.js";
import {
  AwaitChoice,
  fixture,
  world
} from "../rules/keywords/support.mjs";
import ferrousForerunner from "../../../card-dsl/dist/cards/sfd/ferrous-forerunner.js";
import plunderingPoro from "../../../card-dsl/dist/cards/sfd/plundering-poro.js";
import treasureHoard from "../../../card-dsl/dist/cards/sfd/treasure-hoard.js";
import wagesOfPain from "../../../card-dsl/dist/cards/sfd/wages-of-pain.js";
import watchfulSentry from "../../../card-dsl/dist/cards/ogn/watchful-sentry.js";
import unsungHero from "../../../card-dsl/dist/cards/sfd/unsung-hero.js";

const base = player => ({ type: "base", player });
const battlefield = { type: "battlefield", id: "battlefield-1" };
const admitted = program => ({ ...program, status: "executable", judgeReason: undefined });
const runtimeContext = (kernel, source, controller = "A") => {
  const choose = request => {
    if (request.type === "mode") return request.options[0];
    if (request.type === "optional") return true;
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  return bindResolveContext(kernel, {
    source,
    controller,
    timingPoint: "chain-item-resolve",
    choose,
    perform: action => kernel.perform(action),
  });
};

test("Ferrous Forerunner's original Deathknell body plays two exhausted Mechs to its controller Base after a real kill", () => {
  const program = admitted(ferrousForerunner);
  for (const controller of ["A", "B"]) {
    const f = fixture({
      programs: [program],
      setup: w => w.unit("forerunner", {
        cardId: program.canonicalCardId,
        types: ["unit"],
        owner: controller,
        controller,
        location: battlefield,
      }),
    });

    assert.equal(f.engine.commit({ type: "kill", object: f.ref("forerunner") }).status, "done");
    assert.equal(f.engine.items.length, 1, "one printed Deathknell text creates one Pending item");
    assert.deepEqual(f.engine.items[0].body.map(instruction => instruction.op), ["effect.token"]);
    assert.equal(f.engine.items[0].trigger.source.ref.id, "forerunner");
    assert.equal(f.engine.items[0].trigger.source.zone, "board");
    assert.deepEqual(f.engine.items[0].trigger.source.location, battlefield);

    f.engine.advance();
    while (f.engine.items.length) f.engine.pass(f.engine.priority);
    const tokens = f.kernel.objects.filter(object => object.isToken);
    assert.equal(tokens.length, 2);
    for (const token of tokens) {
      assert.equal(token.name, "Mech");
      assert.equal(token.might, 3);
      assert.equal(token.controller, controller);
      assert.deepEqual(token.location, base(controller));
      assert.equal(token.exhausted, true, "CR 143.4/185.2.d default Unit entry is exhausted");
      assert.equal(token.energy, null);
      assert.equal(token.power, null);
    }
    assert.equal(f.get("forerunner").zone, "trash", "the body resolves after the killed source reached Trash");
  }
});

test("the same Deathknell body binds for a controller Base while the source is already in Trash", () => {
  const program = admitted(ferrousForerunner);
  const kernel = world().player("A").player("B")
    .card("source", { cardId: program.canonicalCardId, types: ["unit"] })
    .build();
  const sourceRef = kernel.ref("source");
  kernel.perform({ type: "move-zone", object: sourceRef, to: "base", location: base("A") });
  kernel.perform({ type: "move-location", object: kernel.ref("source"), to: battlefield });
  kernel.perform({ type: "kill", object: kernel.ref("source") });
  const context = runtimeContext(kernel, {
    ...kernel.lastKnown(sourceRef),
    ref: sourceRef,
    zone: "board",
    location: battlefield,
  });
  const trigger = program.abilities[0];
  const outcome = resolveChainBody(trigger.body, context);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(
    kernel.objects.filter(object => object.isToken).map(object => object.location),
    [base("A"), base("A")],
  );
});

test("Watchful Sentry's printed Deathknell text binds to one boundary and resolves once with source LKI", () => {
  const program = admitted(watchfulSentry);
  const f = fixture({
    programs: [program],
    setup: w => w.unit("sentry", {
      cardId: program.canonicalCardId,
      types: ["unit"],
      location: battlefield
    }),
  });

  assert.equal(f.engine.commit({ type: "kill", object: f.ref("sentry") }).status, "done");
  assert.equal(f.engine.items.length, 1, "the keyword and its printed body do not become two triggers");
  assert.deepEqual(f.engine.items[0].body.map(instruction => instruction.op), ["trigger.leave", "effect.draw"]);
  assert.equal(f.engine.items[0].trigger.source.ref.id, "sentry");
  assert.equal(f.engine.items[0].trigger.source.zone, "board");
  assert.deepEqual(f.engine.items[0].trigger.source.location, battlefield);

  f.engine.advance();
  while (f.engine.items.length) {
    f.engine.pass(f.engine.priority);
  }
  assert.equal(f.kernel.player("A").handCount, 1, "the bound Draw 1 body executed exactly once");
  assert.equal(f.get("sentry").zone, "trash");
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-killed").length, 1);
});

test("Plundering Poro's original Gold IR remains fail-closed with no token or Pending item", () => {
  const kernel = world().player("A").player("B").unit("poro", { location: battlefield }).build();
  const source = kernel.getObject("poro");
  const context = runtimeContext(kernel, source);
  const trigger = plunderingPoro.abilities.find(ability =>
    ability.kind === "triggered" && ability.trigger.at === "conquer");
  assert.ok(trigger);
  const outcome = resolveChainBody(trigger.body, context);
  const result = outcome.results[0].result;
  assert.equal(result.status, "negated");
  assert.equal(result.reason, "impossible");
  assert.equal(kernel.linked("play-gold.token").blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(kernel.linked("play-gold.token.amount"), 0);
  assert.deepEqual(kernel.linked("play-gold.token.objects"), []);
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
  assert.equal(kernel.pendingItems.length, 0);
});

test("Wages of Pain's original Gold instruction stays blocked after its executable damage half", () => {
  const kernel = world().player("A").player("B")
    .unit("victim", { owner: "B" })
    .card("wages", {
      cardId: wagesOfPain.canonicalCardId,
      name: "Wages of Pain",
      types: ["spell"],
      zone: "hand",
    })
    .build();
  const play = wagesOfPain.abilities.find(ability => ability.kind === "play");
  assert.ok(play);
  const [damage, token] = play.body;
  kernel.setTargets(damage.targets[0].id, [kernel.ref("victim")]);
  const context = runtimeContext(kernel, kernel.getObject("wages"));
  const damageOutcome = resolveChainBody([damage], context);
  assert.equal(damageOutcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("victim").damage, 3);
  const tokenOutcome = resolveChainBody([token], context);
  assert.equal(tokenOutcome.results[0].result.status, "negated");
  assert.equal(kernel.linked("play-gold-token.goldToken").blockedReason,
    "token-definition-or-abilities-judge-required");
  assert.equal(kernel.linked("play-gold-token.goldToken.amount"), 0);
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
  assert.equal(kernel.pendingItems.length, 0);
});

test("Treasure Hoard's original optional Gold branch pays Energy and then fails closed without a Token", () => {
  const kernel = world().player("A", { energy: 1 }).player("B")
    .unit("treasure-hoard", {
      cardId: treasureHoard.canonicalCardId,
      name: "Treasure Hoard",
      types: ["battlefield"],
      location: battlefield,
    })
    .build();
  const context = runtimeContext(kernel, kernel.getObject("treasure-hoard"));
  const outcome = resolveChainBody(treasureHoard.abilities[0].body, context);
  const byId = new Map(outcome.results.map(result => [result.id, result.result]));
  assert.equal(byId.get("treasure-hoard.pay").status, "executed");
  assert.equal(byId.get("treasure-hoard.create").status, "negated");
  assert.equal(kernel.player("A").energy, 0, "the optional branch made the real payment");
  assert.equal(kernel.linked("treasure-hoard.opt-in/treasure-hoard.create.goldToken").blockedReason,
    "token-definition-or-abilities-judge-required");
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
  assert.equal(kernel.pendingItems.length, 0);
});

// Unsung Hero (sfd-167-221, executable): "[Deathknell] - If I was [Mighty],
// draw 2." Its IR declares the keyword and a conditional self-death trigger.
// The condition is past tense (CR 808.1.c.2), so it is checked when the single
// Deathknell trigger is collected; it must not leave a second, body-less
// keyword trigger behind or ask the controller to order two triggers.
for (const [might, draws] of [[5, 2], [4, 0]]) {
  test(`Unsung Hero's conditional Deathknell is one trigger: Might ${might} dies and draws ${draws}`, () => {
    const f = fixture({
      programs: [unsungHero],
      setup: w => w.unit("hero", { cardId: unsungHero.canonicalCardId, types: ["unit"], might, location: battlefield })
        .deck("d1").deck("d2").deck("d3"),
    });
    assert.equal(f.engine.commit({ type: "kill", object: f.ref("hero") }).status, "done");
    assert.equal(f.engine.items.length, draws > 0 ? 1 : 0,
      "one Deathknell trigger when the past-tense condition held, none otherwise");
    if (draws > 0) assert.deepEqual(f.engine.items[0].body.map(instruction => instruction.op), ["trigger.leave", "effect.draw"]);
    f.engine.advance();
    while (f.engine.items.length) f.engine.pass(f.engine.priority);
    assert.equal(f.kernel.player("A").handCount, draws);
    assert.equal(f.get("hero").zone, "trash");
  });
}
