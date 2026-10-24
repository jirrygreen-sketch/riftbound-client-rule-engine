// Forecaster (sfd-065-221), checked through ProgramBinding, ChainEngine and the
// attached production lifecycle. CR v1.5 817.1.b/c expands each Vision instance
// to a Board-entry Predict, while 817.2 keeps separate instances separate.
import test from "node:test";
import assert from "node:assert/strict";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/forecaster.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CANONICAL = "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40";
const SOURCE_TEXT =
  "Your Mechs have [Vision]. (When you play us, look at the top card of your " +
  "Main Deck. You may recycle it.)";

// Official interaction evidence:
// - Core Rules v1.5 (last updated 2026-10-09, effective 2026-10-16):
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - Radiance patch notes, effective 2026-10-16:
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// canonicalCardId: card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40.
// The continuous grant is applied under 478/479 to each controlled Board Mech
// without a Pending item. Vision is 817.1.b-c: each separate instance looks at
// that controller's top Main Deck card when its host is played; 817.2.a keeps
// repeated instances separate. The optional recycle is a Finalize-time choice,
// the inherited ordinary Priority response follows, and Resolve either keeps
// the card or recycles it to its owner's Main Deck under 417.1.
// This is a Board-entry Play Effect, not a Showdown, so it creates no Focus.
// Vision reads the top card before any recycle moves it and requires no LKI of
// a target that has already left its zone.

const [grant] = program.abilities;

function playForecaster({
  controller = "A",
  recycle = false,
  includeBoundaryObjects = false
} = {}) {
  const turnPlayer = controller;
  const answerRecycle = recycle
    ? (_kernel, request) => {
        const top = request.options[0];
        return top?.id === `${controller.toLowerCase()}-top` ? [top] : [];
      }
    : () => [];
  const f = productionPlay({
    programs: [program],
    turnPlayer,
    answers: {
      "trigger:": (_kernel, request) => request.type === "mode" ? request.options[0] : undefined,
      "vision-look": answerRecycle
    },
    build: (w) => {
      let builder = w
        .player("A", { energy: 10, power: [] })
        .player("B", { energy: 10, power: [] })
        .deck(["a-top", "a-second", "a-third", "a-fourth"], { owner: "A" })
        .deck(["b-top", "b-second", "b-third", "b-fourth"], { owner: "B" })
        .hand("forecaster", {
          owner: controller,
          controller,
          cardId: CANONICAL,
          types: ["unit"],
          tags: ["Mech"],
          energy: 2,
          power: null,
          might: 2
        });
      if (includeBoundaryObjects) {
        builder = builder
          .hand("friendly-mech", {
            owner: "A",
            controller: "A",
            cardId: "card:friendly-mech",
            types: ["unit"],
            tags: ["Mech"],
            energy: null,
            power: null,
            might: 3
          })
          .hand("plain-ally", {
            owner: "A",
            controller: "A",
            cardId: "card:plain-ally",
            types: ["unit"],
            tags: [],
            energy: null,
            power: null,
            might: 3
          })
          .hand("enemy-mech", {
            owner: "B",
            controller: "B",
            cardId: "card:enemy-mech",
            types: ["unit"],
            tags: ["Mech"],
            energy: null,
            power: null,
            might: 3
          });
      }
      return builder;
    }
  });
  const draft = f.play("forecaster", controller);
  return { f, draft };
}

function inspectLinks(f) {
  return Object.entries(f.kernel.linkedSnapshot()).filter(([key]) => key.endsWith(".inspected"));
}

function visionAsks(f) {
  return f.requests.filter(request =>
    request.type === "select-objects" && request.id.startsWith("vision-look")
  );
}

function keywordTriggerIds(f, id = "forecaster") {
  return [...f.engine.pipeline.checkpoint().triggers.values()]
    .filter(registration => registration.source?.ref.id === id &&
      registration.id.startsWith("program-keyword-ability:"))
    .map(registration => registration.id);
}

function enterBoard(f, id) {
  const entered = f.kernel.getObject(id);
  assert.equal(f.engine.commit({ type: "move-zone", object: entered.ref, to: "chain" }).status, "done");
  const onChain = f.kernel.getObject(id);
  assert.equal(f.engine.commit({
    type: "move-zone",
    object: onChain.ref,
    to: "base",
    location: { type: "base", player: onChain.controller }
  }).status, "done");
  f.engine.advance();
  f.settle();
}

test("sfd-065-221 Forecaster: program is valid, registered and executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-065-221 Forecaster: the static body grants Vision to the controller's Mechs", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "Vision");
  assert.deepEqual(grant.effect.filter, {
    zone: "board",
    controller: "controller",
    tag: "Mech"
  });
  assert.equal(grant.condition, undefined);
  assert.deepEqual(translateObjectFilter(grant.effect.filter), {
    zone: "board",
    controller: "self",
    tags: ["Mech"]
  });
  assert.equal(keywordDefinitionsById.get("Vision")?.stacking, "separate");
});

test("sfd-065-221 Forecaster production: the grant follows the controller and Mech tag without an extra card-type assumption", () => {
  const kernel = world()
    .player("A")
    .player("B")
    .unit("forecaster", { owner: "A", controller: "A", cardId: CANONICAL, tags: ["Mech"] })
    .unit("friendly-mech", { owner: "A", controller: "A", tags: ["Mech"] })
    .object("friendly-mech-gear", {
      owner: "A",
      controller: "A",
      types: ["gear"],
      tags: ["Mech"],
      zone: "board",
      location: { type: "base", player: "A" },
      might: null
    })
    .unit("friendly-plain", { owner: "A", controller: "A", tags: [] })
    .object("enemy-mech", {
      owner: "B",
      controller: "B",
      types: ["unit"],
      tags: ["Mech"],
      zone: "hand"
    })
    .build();
  const choose = () => { throw new Error("static layer evaluation must not prompt"); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  createEngineStaticBinder(engine).bindStatic(grant, kernel.getObject("forecaster"));
  engine.layers.setObjects(kernel.objects);
  const keywords = (id) => engine.layers.evaluate(kernel.ref(id)).keywords.map(keyword => keyword.id);
  assert.deepEqual(keywords("forecaster"), ["Vision"]);
  assert.deepEqual(keywords("friendly-mech"), ["Vision"]);
  assert.deepEqual(keywords("friendly-mech-gear"), ["Vision"], "CR 133.8 tags can apply across game-object types");
  assert.deepEqual(keywords("friendly-plain"), []);
  assert.deepEqual(keywords("enemy-mech"), []);
});

test("sfd-065-221 Forecaster production golden: one Vision instance uses A's own deck top and pays the printed cost", () => {
  const { f } = playForecaster({ controller: "A" });
  const asks = visionAsks(f);
  assert.equal(asks.length, 1, "one static grant contributes exactly one Vision instance");
  assert.deepEqual(new Set(asks.map(request => request.chooser)), new Set(["A"]));
  assert.deepEqual(
    new Set(asks.map(request => request.options[0]?.id)),
    new Set(["a-top"]),
    "the lifecycle viewer is the actual controller"
  );
  assert.equal(f.kernel.events.filter(event => event.action === "look").length, 1);
  assert.equal(f.kernel.events.filter(event => event.action === "recycle").length, 0);
  assert.equal(inspectLinks(f).length, 1);
  assert.equal(f.kernel.player("A").energy, 8, "2 Energy was paid by the real play path");
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("forecaster").zone, "board");
  assert.deepEqual(
    f.engine.layers.evaluate(f.kernel.ref("forecaster")).keywords.map(keyword => keyword.id),
    ["Vision"]
  );
});

test("sfd-065-221 Forecaster production boundary: declining recycle leaves both decks unchanged", () => {
  const { f } = playForecaster({ controller: "A" });
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["a-top", "a-second", "a-third", "a-fourth"]);
  assert.deepEqual(f.kernel.zone("B", "deck").map(ref => ref.id), ["b-top", "b-second", "b-third", "b-fourth"]);
  assert.equal(f.kernel.events.filter(event => event.action === "recycle").length, 0);
  for (const [key, value] of inspectLinks(f)) {
    assert.equal(value, 1, `${key} looked at exactly the real top card`);
  }
});

test("sfd-065-221 Forecaster production: B's controlled Vision reads B's own top before the recycle boundary", () => {
  const { f } = playForecaster({ controller: "B" });
  const asks = visionAsks(f);
  assert.equal(asks.length, 1);
  assert.deepEqual(
    new Set(asks.map(request => request.options[0]?.id)),
    new Set(["b-top"]),
    "the lifecycle viewer follows the controller rather than assuming player A"
  );
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["a-top", "a-second", "a-third", "a-fourth"]);
  assert.deepEqual(f.kernel.zone("B", "deck").map(ref => ref.id), ["b-top", "b-second", "b-third", "b-fourth"]);
  assert.equal(f.kernel.linkedSnapshot()["vision-recycle.recycledCount"], 0);
  assert.equal(f.kernel.events.filter(event => event.action === "recycle").length, 0);
});

test("sfd-065-221 Forecaster production boundary: accepting an A-controlled recycle recycles A's top card", () => {
  const { f } = playForecaster({ controller: "A", recycle: true });
  assert.deepEqual(
    f.kernel.zone("A", "deck").map(ref => ref.id),
    ["a-second", "a-third", "a-fourth", "a-top"]
  );
  assert.deepEqual(f.kernel.zone("B", "deck").map(ref => ref.id), ["b-top", "b-second", "b-third", "b-fourth"]);
  const recycled = f.kernel.events.filter(event => event.action === "recycle");
  assert.equal(recycled.length, 1, "one Vision instance performs one real recycle");
  assert.equal(f.kernel.linkedSnapshot()["vision-recycle.recycledCount"], 1);
  assert.deepEqual(
    f.kernel.linkedSnapshot()["vision-recycle.recycled"].map(ref => ref.id),
    ["a-top"]
  );
});

test("sfd-065-221 Forecaster production boundary: one static grant registers exactly one Vision trigger", () => {
  const { f } = playForecaster({ controller: "A" });
  const source = f.kernel.getObject("forecaster");
  const keywordTriggers = keywordTriggerIds(f);
  assert.equal(keywordTriggers.length, 1);
  assert.deepEqual(
    keywordTriggers,
    [`program-keyword-ability:forecaster:${source.ref.zoneEntryId}:vision:printed-0:0`]
  );
  assert.equal(visionAsks(f).length, 1);
  assert.equal(inspectLinks(f).length, 1);
});

test("sfd-065-221 Forecaster production boundary: only this controller's Mechs receive the grant", () => {
  const { f } = playForecaster({ includeBoundaryObjects: true });
  const before = visionAsks(f).length;

  enterBoard(f, "friendly-mech");
  const friendlyAsks = visionAsks(f).slice(before);
  assert.equal(friendlyAsks.length, 1, "one Forecaster grant creates one Vision instance");
  assert.deepEqual(friendlyAsks.map(request => request.chooser), ["A"]);
  assert.deepEqual(friendlyAsks.map(request => request.options[0]?.id), ["a-top"]);
  assert.deepEqual(
    f.engine.layers.evaluate(f.kernel.ref("friendly-mech")).keywords.map(keyword => keyword.id),
    ["Vision"]
  );
  assert.equal(keywordTriggerIds(f, "friendly-mech").length, 1);

  enterBoard(f, "plain-ally");
  assert.equal(visionAsks(f).length, before + 1, "a non-Mech receives no Vision trigger");
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("plain-ally")).keywords, []);

  enterBoard(f, "enemy-mech");
  assert.equal(visionAsks(f).length, before + 1, "an opposing Mech receives no grant from Forecaster");
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("enemy-mech")).keywords, []);
});

test("sfd-065-221 Forecaster reference: one Vision instance has one Board-entry Predict body", () => {
  assert.equal(keywordDefinitionsById.has("Vision"), true);
  const expanded = keywordDefinitionsById.get("Vision").expand({ host: { canonicalCardId: "sfd-065-221" } });
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].kind, "triggered");
  assert.equal(expanded[0].trigger.at, "object-enters-board");
  assert.deepEqual(expanded[0].body.map(instruction => instruction.op), ["effect.inspect", "effect.recycle"]);

  const source = world()
    .player("A")
    .deck(["top", "rest"], { owner: "A" })
    .unit("mech", { owner: "A", controller: "A", tags: ["Mech"], keywords: [{ id: "Vision" }] })
    .build()
    .getObject("mech");
  assert.equal(source.keywords.filter(keyword => keyword.id === "Vision").length, 1);
});
