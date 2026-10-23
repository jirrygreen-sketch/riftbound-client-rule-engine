import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/lux-illuminated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL =
  "card.hash-c2754bbf1ee513e71200b5c341447c73af45af5ba81a41efde12ac2d348cbcd8";
const SOURCE_TEXT =
  "When you play a spell that costs :rb_energy_5: or more, give me +3 :rb_might: this turn.";

const [ability] = program.abilities;
const [grantMight] = ability.body;

const registrations = (kernel) =>
  kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

test("ogs-006-024 Lux, Illuminated: program validates as judge-required with the current engine gaps", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /settlement-1/);
  assert.match(program.judgeReason, /Continuous effect already registered/);
  assert.match(program.judgeReason, /registry\.get/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogs-006-024 Lux, Illuminated: the translated trigger binding retains the printed-cost condition and source zone", () => {
  const kernel = world().unit("lux", { cardId: CANONICAL, might: 5 }).build();
  const [registration] = triggerRegistrations({ get: () => program }, kernel.getObject("lux"));
  assert.deepEqual(registration.spec.condition, ability.trigger.condition);
  assert.deepEqual(registration.spec.filter, ability.trigger.filter);
  assert.deepEqual(registration.body, ability.body);
  assert.deepEqual(registration.activeZones, ["board"]);
  assert.equal(registration.boundToIncarnation, true);
});

test("ogs-006-024 Lux, Illuminated: the production registry rejects the judge-required program", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world().unit("lux", { cardId: CANONICAL, might: 5 }).build();
  assert.throws(
    () => triggerRegistrations(binding.registry, kernel.getObject("lux")),
    (error) => error.name === "ProgramBindingError" && error.code === "judge-required"
  );
});

test("ogs-006-024 Lux, Illuminated: card-played trigger with the printed-energy gate and a temporary +3 Might body", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  // CR 206: printed/copied cost is independent of the resources actually paid.
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played", object: { type: "spell" }, player: "self"
  });
  assert.deepEqual(ability.trigger.condition, {
    kind: "event-printed", object: "object", characteristic: "energy",
    operator: "gte", right: { kind: "constant", value: 5 }
  });

  assert.equal(ability.body.length, 1);
  assert.equal(grantMight.id, "lux-illuminated.grant-might");
  // "give me +3 :rb_might: this turn": a duration-bounded Might modification
  // (CR 143.2) carried by the merged continuous.might primitive, not a Buff.
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantMight.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(grantMight.targets, undefined);
  assert.equal(grantMight.linkedTo, undefined);
});

test("ogs-006-024 Lux, Illuminated: translated trigger matches only the controller's spells", () => {
  const base = world().unit("lux", { zone: "board" }).build();
  const source = base.getObject("lux");
  const pattern = translateTriggerFilter(ability.trigger.filter, source.ref.id, "card-played");
  assert.deepEqual(pattern, { event: "card-played", object: { type: "spell" }, player: "self" });
  const event = { timingPoint: "card-played", object: { ...source, types: ["spell"] }, player: "A" };
  assert.equal(matchesTriggerEvent(pattern, event, "A"), true);
  assert.equal(matchesTriggerEvent(pattern, { ...event, object: { ...source, types: ["gear"] } }, "A"), false);
  assert.equal(matchesTriggerEvent(pattern, { ...event, player: "B" }, "A"), false);
});

test("ogs-006-024 Lux, Illuminated golden: the body registers +3 Might in the arithmetic layer until end of turn", () => {
  const base = world().unit("lux", { zone: "board", might: 5 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("lux") });

  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["lux-illuminated.grant-might", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 478 / 478.1.a: Might modifications live in the arithmetic layer.
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 3);
  assert.deepEqual(registration.effect.filter.objectId, "lux");
  // 317.1.a / 468.7.c: "this turn" expires in the Expiration Step.
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(effectiveMight(kernel, "lux"), 8);

  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(engine.evaluate(kernel.ref("lux")).might, 5);
});

test("ogs-006-024 Lux, Illuminated golden: a source that left the Board registers nothing (CR 359.3.e.6)", () => {
  const base = world().unit("lux", { zone: "trash", might: 5 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("lux") });

  const outcome = resolveChainBody(ability.body, kernel);
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
});

function productionGame({ printed = 5, types = ["spell"], count = 1 } = {}) {
  // The probe spell needs a registered play program for the production
  // describePlay adapter; its printed Energy is injected per scenario.
  const PROBE = "card.probe.lux-illuminated.spell";
  const probeProgram = {
    canonicalCardId: PROBE, rulesetVersion: "core-1.5", status: "executable",
    abilities: [{ kind: "play", cost: { kind: "cost.printed", energy: { kind: "constant", value: printed } }, body: [] }],
    sourceText: "[Probe] (No ability.)"
  };
  const binding = createProgramBinding({ cardPrograms: [probeProgram] });
  // Lux's production lifecycle cannot bind while the program is judge-required,
  // so the golden attaches the card's own translated trigger to the engine
  // pipeline manually (the same convention as lady-of-luminosity-starter) while
  // plays still take the production payment and event path.
  const game = fixture({
    cards: [
      { id: "lux", cardId: CANONICAL, types: ["unit"], energy: 6, power: ["Mind"], might: 5 },
      ...Array.from({ length: count }, (_, index) => ({
        id: `probe-${index}`, cardId: PROBE, types, energy: printed, power: [], might: 2
      }))
    ],
    describePlay: binding.describePlay
  });
  const [ability] = program.abilities;
  game.engine.pipeline.registerTrigger({
    id: "lux.cost-gate",
    source: game.kernel.getObject("lux"),
    controller: "A",
    spec: ability.trigger,
    body: ability.body,
    optional: ability.optional
  });
  assert.equal(game.engine.commit({ type: "gain-power", player: "A", power: ["Mind"] }).status, "done");
  // The trigger's active zone is Board; place Lux there without claiming a
  // production play binding for the judge-required program.
  assert.equal(game.engine.commit({ type: "move-zone", object: game.kernel.ref("lux"), to: "board" }).status, "done");
  assert.equal(game.kernel.getObject("lux").zone, "board");
  assert.equal(game.engine.layers.evaluate(game.kernel.ref("lux")).might, 5);
  assert.equal(game.engine.layers.registry.list().length, 0, "Lux's own unit play does not trigger");
  assert.equal(game.kernel.player("A").energy, 20, "setup must not pay for the judge-required Lux");
  return game;
}

function playCard(game, id, extra = {}) {
  assert.equal(game.engine.commit({ type: "play", object: game.kernel.ref(id), player: "A", ...extra }).status, "done");
  game.engine.advance();
  resolveAll(game.engine);
  assert.equal(game.engine.items.length, 0);
}

test("ogs-006-024 Lux, Illuminated golden: real program lifecycle grants +3 only for a 5+ printed-Energy spell", () => {
  for (const [printed, types, expected] of [[4, ["spell"], 5], [5, ["spell"], 8], [6, ["spell"], 8], [5, ["unit"], 5]]) {
    const game = productionGame({ printed, types });
    playCard(game, "probe-0");
    const event = game.engine.pipeline.events.find(entry => entry.timingPoint === "card-played" && entry.object.ref.id === "probe-0");
    assert.ok(event, "cost gate must consume a real play event");
    assert.equal(event.details.printed.energy, printed);
    assert.equal(event.player, "A");
    assert.deepEqual(event.object.types, types);
    assert.equal(game.kernel.player("A").energy, 20 - printed);
    assert.equal(game.engine.layers.evaluate(game.kernel.ref("lux")).might, expected);
    const entries = game.engine.layers.registry.list();
    assert.equal(entries.length, expected === 8 ? 1 : 0);
    if (entries.length) {
      assert.equal(entries[0].effect.filter.objectId, "lux");
      assert.equal(entries[0].effect.effect.amount, 3);
      assert.deepEqual(entries[0].duration, { type: "end-of-turn" });
    }
    assert.equal(game.engine.trace.filter(entry => entry.step === "resolved" && entry.item.startsWith("trigger:")).length, expected === 8 ? 1 : 0);
  }
});

test("ogs-006-024 Lux, Illuminated golden: CR 206 uses the printed cost when the real play pays less or more", () => {
  for (const [printed, paid, expected] of [[5, 1, 8], [4, 7, 5]]) {
    const game = productionGame({ printed });
    playCard(game, "probe-0", { cost: { finalized: true, energy: paid, power: [] } });
    const event = game.engine.pipeline.events.find(entry => entry.timingPoint === "card-played" && entry.object.ref.id === "probe-0");
    assert.equal(event.details.printed.energy, printed);
    assert.equal(game.kernel.player("A").energy, 20 - paid);
    assert.equal(game.engine.layers.evaluate(game.kernel.ref("lux")).might, expected);
  }
});

test("ogs-006-024 Lux, Illuminated evidence: same-turn grants stack with distinct settlement identities", () => {
  const game = productionGame({ count: 2 });
  playCard(game, "probe-0");
  assert.equal(game.engine.layers.evaluate(game.kernel.ref("lux")).might, 8);
  // CR 478.1/814.2: each trigger resolution is its own settlement, so the
  // second +3 stacks independently and both expire together at turn-end.
  playCard(game, "probe-1");
  assert.equal(game.engine.layers.evaluate(game.kernel.ref("lux")).might, 11);
  assert.equal(game.engine.layers.registry.list().length, 2);
  const ids = game.engine.layers.registry.list().map(entry => entry.effect.id);
  assert.equal(new Set(ids).size, 2);
  assert.equal(game.kernel.getObject("lux").might, 5, "printed Might remains unchanged");
  game.engine.layers.expireAt("turn-end");
  assert.equal(game.engine.layers.evaluate(game.kernel.ref("lux")).might, 5);
});
