// Forecaster (sfd-065-221), checked against the current production lifecycle.
//
// CR v1.5 817.1.b/c expands each Vision instance to a Board-entry Predict;
// 817.2 requires multiple instances to trigger separately. The production
// lifecycle now supplies the real controller and ordered deck-top pick, but
// currently expands one static grant twice. That observable trigger-count
// defect keeps the card judge-required and is reproduced below without
// manually settling or synthesizing events.
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

const [grant] = program.abilities;

function playForecaster({ controller = "A", recycle = false } = {}) {
  const f = productionPlay({
    programs: [{ ...program, status: "executable", judgeReason: undefined }],
    turnPlayer: controller,
    answers: {
      "trigger:": (_kernel, request) => request.type === "mode" ? request.options[0] : undefined,
      "vision-look": (_kernel, request) => {
        if (!recycle) return [];
        const top = request.options[0];
        return top?.id === `${controller.toLowerCase()}-top` ? [top] : [];
      }
    },
    build: (w) => w
      .player("A", { energy: 10, power: [] })
      .player("B", { energy: 10, power: [] })
      .deck(["a-top", "a-second"], { owner: "A" })
      .deck(["b-top", "b-second"], { owner: "B" })
      .hand("forecaster", {
        owner: controller,
        controller,
        cardId: CANONICAL,
        types: ["unit"],
        tags: ["Mech"],
        energy: 2,
        power: null,
        might: 2
      })
  });
  const draft = f.play("forecaster", controller);
  return { f, draft };
}

function inspectLinks(f) {
  return Object.entries(f.kernel.linkedSnapshot()).filter(([key]) => key.endsWith(".inspected"));
}

test("sfd-065-221 Forecaster: program is valid, registered and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-065-221 Forecaster: current judgeReason names the duplicate Vision instance lifecycle gap", () => {
  assert.match(program.judgeReason, /单个静态 Vision grant/);
  assert.match(program.judgeReason, /keyword-grants\.ts:568/);
  assert.match(program.judgeReason, /`expansions`/);
  assert.match(program.judgeReason, /`this\.expansions`/);
  assert.match(program.judgeReason, /vision:printed-0/);
  assert.match(program.judgeReason, /vision:printed-1/);
  assert.match(program.judgeReason, /817\.2/);
  assert.doesNotMatch(program.judgeReason, /静默查 0 张|constant\("A"\) 占位/);
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

test("sfd-065-221 Forecaster production: the lifecycle uses A's own deck top and separated recycle choices", () => {
  const { f } = playForecaster({ controller: "A" });
  const asks = f.requests.filter(request => request.type === "select-objects");
  assert.equal(asks.length, 2, "the current blocker emits two Predict choices for one Vision grant");
  assert.deepEqual(new Set(asks.map(request => request.chooser)), new Set(["A"]));
  assert.deepEqual(
    new Set(asks.map(request => request.options[0]?.id)),
    new Set(["a-top"]),
    "the lifecycle viewer is the actual controller, not hard-coded from the test"
  );
  assert.equal(
    f.kernel.events.filter(event => event.action === "look").length,
    2,
    "both duplicated Vision instances really reach the production Resolve path"
  );
  assert.equal(inspectLinks(f).length, 2);
});

test("sfd-065-221 Forecaster production boundary: declining recycle leaves both decks unchanged", () => {
  const { f } = playForecaster({ controller: "A" });
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["a-top", "a-second"]);
  assert.deepEqual(f.kernel.zone("B", "deck").map(ref => ref.id), ["b-top", "b-second"]);
  assert.equal(f.kernel.events.filter(event => event.action === "recycle").length, 0);
  for (const [key, value] of inspectLinks(f)) {
    assert.equal(value, 1, `${key} looked at exactly the real top card`);
  }
});

test("sfd-065-221 Forecaster production: B's controlled Vision reads B's own top before the recycle boundary", () => {
  const { f } = playForecaster({ controller: "B" });
  const asks = f.requests.filter(request => request.type === "select-objects");
  assert.equal(asks.length, 2);
  assert.deepEqual(
    new Set(asks.map(request => request.options[0]?.id)),
    new Set(["b-top"]),
    "the lifecycle viewer follows the controller rather than assuming player A"
  );
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["a-top", "a-second"]);
  assert.deepEqual(f.kernel.zone("B", "deck").map(ref => ref.id), ["b-top", "b-second"]);
  const recycledLinks = Object.entries(f.kernel.linkedSnapshot()).filter(([key]) =>
    key.includes("vision-recycle") && key.endsWith(".recycled")
  );
  assert.equal(recycledLinks.length, 2);
  assert.deepEqual(recycledLinks.flatMap(([, value]) => value), []);
});

test("sfd-065-221 Forecaster production boundary: accepting an A-controlled recycle recycles A's top card", () => {
  const { f } = playForecaster({ controller: "A", recycle: true });
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["a-second", "a-top"]);
  assert.deepEqual(f.kernel.zone("B", "deck").map(ref => ref.id), ["b-top", "b-second"]);
  const recycled = f.kernel.events.filter(event => event.action === "recycle");
  assert.equal(recycled.length, 1, "the duplicated second instance sees the same kept top and declines it");
  const recycledLinks = Object.entries(f.kernel.linkedSnapshot()).filter(([key]) =>
    key.includes("vision-recycle") && key.endsWith(".recycled")
  );
  assert.equal(recycledLinks.length, 2);
  assert.deepEqual(
    recycledLinks.flatMap(([, value]) => value).map(ref => ref.id),
    ["a-top"]
  );
});

test("sfd-065-221 Forecaster production gap: one static Vision grant registers two independent trigger instances", () => {
  const { f } = playForecaster({ controller: "A" });
  const source = f.kernel.getObject("forecaster");
  const keywordTriggers = [...f.engine.pipeline.checkpoint().triggers.values()].filter(registration =>
    registration.source?.ref.id === "forecaster" && registration.id.startsWith("program-keyword-ability:")
  );
  assert.equal(keywordTriggers.length, 2);
  assert.deepEqual(
    keywordTriggers.map(registration => registration.id).sort(),
    [
      `program-keyword-ability:forecaster:${source.ref.zoneEntryId}:vision:printed-0:0`,
      `program-keyword-ability:forecaster:${source.ref.zoneEntryId}:vision:printed-1:0`
    ]
  );
  assert.equal(
    f.requests.filter(request => request.type === "mode" && request.id.startsWith("trigger:")).length,
    1,
    "the two same-controller triggers also require a real ordering choice"
  );
  assert.equal(inspectLinks(f).length, 2);
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
