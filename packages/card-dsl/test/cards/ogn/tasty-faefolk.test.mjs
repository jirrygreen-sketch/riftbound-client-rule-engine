import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program, { deathknellBody } from "../../../dist/cards/ogn/tasty-faefolk.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";


test("ogn-075-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-bcc76f0b1b3b8dafd184b4a3307e12e03a80d4c9902254de9e30a4f6b0f1aba2");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /payload|trigger.leave/);
  assert.match(program.judgeReason, /programs\/keywords\.ts/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.match(program.judgeReason, /805\.2\.b/);
  assert.match(program.judgeReason, /channel-rune.*431\.2/);
  assert.equal(program.sourceText, "[Accelerate] (You may pay :rb_energy_1::rb_rune_calm: as an additional cost to have me enter ready.)\n[Deathknell] — Channel 2 runes exhausted and draw 1. (When I die, get the effect.)");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

const [accelerate, deathknell] = program.abilities;
const [channelRunes, drawCard] = deathknellBody;

test("Tasty Faefolk: declare Accelerate/Deathknell without duplicating the death trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
  assert.equal(program.abilities.some(ability => ability.kind === "triggered"), false);
  assert.equal(deathknellBody.length, 2);
  assert.match(program.judgeReason, /唯一绑定契约/);
});

test("Tasty Faefolk: channel two exhausted runes, then independent Draw 1", () => {
  assert.deepEqual(deathknellBody.map(instruction => instruction.op), ["effect.channel", "effect.draw"]);
  assert.deepEqual(channelRunes.args, { amount: { kind: "constant", value: 2 }, exhausted: { kind: "constant", value: true } });
  assert.deepEqual(drawCard.args, { amount: { kind: "constant", value: 1 } });
  for (const instruction of deathknellBody) {
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.condition, undefined);
  }
});

test("Tasty Faefolk golden: channel the actual top two Rune Deck cards with the exhausted stipulation", () => {
  const kernel = world().unit("faefolk", { might: 6, energy: 7, power: null }).rune(["rune-1", "rune-2", "rune-3"]).build();
  const run = runInstruction(channel, channelRunes.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 2);
  for (const id of ["rune-1", "rune-2"]) assert.equal(kernel.getObject(id).zone, "rune-zone");
  assert.equal(kernel.getObject("rune-3").zone, "rune-deck");
  assert.equal(kernel.getObject("faefolk").power, null);
  assert.ok(run.events.length > 0);
  assert.ok(run.events.every(event => event.action === "channel-rune"));
  assert.deepEqual(kernel.stateForTest().history.at(-1).action, {
    type: "channel-rune",
    player: "A",
    amount: 2,
    exhausted: true
  });
});

test("Tasty Faefolk golden: an undersized Rune Deck channels as many as possible with exhausted stipulation", () => {
  const kernel = world().unit("faefolk", { might: 6, power: null }).rune("last-rune").build();
  const run = runInstruction(channel, channelRunes.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.getObject("last-rune").zone, "rune-zone");
  assert.deepEqual(kernel.stateForTest().history.at(-1).action, {
    type: "channel-rune",
    player: "A",
    amount: 2,
    exhausted: true
  });
});

test("Tasty Faefolk golden subeffect: Draw 1 moves the actual top Main Deck card", () => {
  const kernel = world().unit("faefolk", { might: 6, power: null }).deck(["top-card", "next-card"]).build();
  const run = runInstruction(draw, drawCard.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.getObject("top-card").zone, "hand");
  assert.equal(kernel.getObject("next-card").zone, "deck");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("Tasty Faefolk: registered keywords preserve independent Deathknell and optional Accelerate costs (CR 808/805)", () => {
  const host = { canonicalCardId: program.canonicalCardId };
  const deathknellDef = keywordDefinitionsById.get("Deathknell");
  assert.equal(deathknellDef.valued, false);
  assert.equal(deathknellDef.stacking, "separate");
  const [expandedDeathknell] = deathknellDef.expand({ host });
  assert.equal(expandedDeathknell.kind, "triggered");
  assert.equal(expandedDeathknell.trigger.at, "object-killed");
  assert.deepEqual(expandedDeathknell.trigger.filter, { self: true, cause: "kill", destination: "trash" });
  assert.equal(expandedDeathknell.optional, false);

  const accelerateDef = keywordDefinitionsById.get("Accelerate");
  assert.equal(accelerateDef.valued, false);
  assert.equal(accelerateDef.stacking, "single");
  const [additionalCost, readyReplacement] = accelerateDef.expand({ host });
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "accelerate.cost");
  assert.deepEqual(additionalCost.effect.cost, {
    kind: "additional-cost",
    optional: true,
    payments: [
      { kind: "energy", amount: { kind: "constant", value: 1 } },
      { kind: "power", amount: { kind: "constant", value: 1 } }
    ]
  });
  assert.equal(readyReplacement.kind, "replacement");
  assert.deepEqual(readyReplacement.replaces, {
    event: "object-enters-board",
    filter: { self: true, cardId: program.canonicalCardId, exhausted: true }
  });
  assert.deepEqual(readyReplacement.with, [{
    id: "accelerate.enter-ready",
    op: "effect.ready",
    args: { objects: { kind: "constant", value: { kind: "source" } } }
  }]);
});

test.todo("Tasty Faefolk: bind the payload to exactly one Deathknell expansion, preserve LKI and suppress replaced deaths; KeywordAbility/programs/keywords.ts payload binding and trigger.leave remain missing (CR 808.1.b.1/808.1.d.1-3)");

test("Tasty Faefolk: resolveChainBody executes the original ordered deathknellBody", () => {
  const kernel = world()
    .unit("faefolk", { might: 6, power: null })
    .rune(["rune-1", "rune-2", "rune-3"])
    .deck(["top-card", "next-card"])
    .build();
  const outcome = resolveChainBody(deathknellBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["channel-runes", "executed"],
    ["draw-card", "executed"]
  ]);
  assert.equal(outcome.linkedValues["channel-runes.channeled"], 2);
  assert.equal(outcome.linkedValues["draw-card.drawn"], 1);
  assert.equal(kernel.getObject("rune-1").zone, "rune-zone");
  assert.equal(kernel.getObject("rune-2").zone, "rune-zone");
  assert.equal(kernel.getObject("rune-3").zone, "rune-deck");
  assert.equal(kernel.getObject("top-card").zone, "hand");
  assert.equal(kernel.getObject("next-card").zone, "deck");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["channel-rune", "draw"]);
  assert.deepEqual(kernel.stateForTest().history.map(entry => entry.action), [
    { type: "channel-rune", player: "A", amount: 2, exhausted: true },
    { type: "draw", player: "A", amount: 1 }
  ]);
});

test("Tasty Faefolk: resolveChainBody keeps Draw 1 independent when channel is replaced", () => {
  const kernel = world()
    .unit("faefolk", { might: 6, power: null })
    .rune(["rune-1", "rune-2"])
    .deck(["top-card"])
    .build();
  kernel.addReplacement(action => action.type === "channel-rune" ? "replaced" : null);
  const outcome = resolveChainBody(deathknellBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["channel-runes", "negated"],
    ["draw-card", "executed"]
  ]);
  assert.equal(outcome.results[0].result.reason, "replaced");
  assert.equal(outcome.linkedValues["draw-card.drawn"], 1);
  assert.equal(kernel.getObject("rune-1").zone, "rune-deck");
  assert.equal(kernel.getObject("rune-2").zone, "rune-deck");
  assert.equal(kernel.getObject("top-card").zone, "hand");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["channel-rune", "draw"]);
});

test("Tasty Faefolk: original body draws independently with zero or one rune for either controller", () => {
  for (const controller of ["A", "B"]) {
    for (const runeCount of [0, 1]) {
      const opponent = controller === "A" ? "B" : "A";
      const kernel = world()
        .unit("faefolk", { cardId: program.canonicalCardId, owner: opponent, controller, might: 6, power: null })
        .rune(runeCount ? ["last-rune"] : [], { owner: controller })
        .rune(["opponent-rune-1", "opponent-rune-2"], { owner: opponent })
        .deck(["top-card", "next-card"], { owner: controller })
        .deck("opponent-card", { owner: opponent })
        .build();
      const scoped = kernel.clone({ controller, sourceSnapshot: kernel.getObject("faefolk") });

      const outcome = resolveChainBody(deathknellBody, scoped);

      assert.equal(outcome.status, "executed");
      assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
        ["channel-runes", "executed"],
        ["draw-card", "executed"]
      ]);
      assert.equal(outcome.linkedValues["channel-runes.channeled"], runeCount);
      assert.equal(outcome.linkedValues["draw-card.drawn"], 1);
      assert.equal(outcome.linkedValues["draw-card.drawnTo"], controller);
      assert.equal(scoped.player(controller).runeDeckSize, 0);
      assert.equal(scoped.player(controller).runePool.length, runeCount);
      if (runeCount) assert.equal(scoped.getObject("last-rune").zone, "rune-zone");
      assert.equal(scoped.getObject("top-card").zone, "hand");
      assert.equal(scoped.getObject("next-card").zone, "deck");
      assert.equal(scoped.player(controller).handSize, 1);
      assert.equal(scoped.player(opponent).runeDeckSize, 2);
      assert.equal(scoped.player(opponent).runePool.length, 0);
      assert.equal(scoped.player(opponent).handSize, 0);
      assert.equal(scoped.getObject("opponent-card").zone, "deck");
      assert.equal(scoped.getObject("faefolk").power, null);
      assert.deepEqual(outcome.events.map(event => event.action), ["channel-rune", "draw"]);
      assert.deepEqual(scoped.stateForTest().history.map(entry => entry.action), [
        { type: "channel-rune", player: controller, amount: 2, exhausted: true },
        { type: "draw", player: controller, amount: 1 }
      ]);
    }
  }
});

test.todo("Tasty Faefolk: bind optional Accelerate 1 energy + matching Calm power payment in programs/play.ts to its delayed enter-ready replacement without object-readied (CR 805.1.b.1/805.2.b/805.6.a)");

test.todo("Tasty Faefolk: channel-rune must apply exhausted:true to the actual entering runes; effects/testing/test-kernel.ts currently only changes zones (CR 431.2)");

test("Tasty Faefolk golden subeffect: empty Rune Deck channels zero without negating", () => {
  const kernel = world().unit("faefolk", { might: 6, power: null }).build();
  const run = runInstruction(channel, channelRunes.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.deepEqual(run.events.map(event => event.action), ["channel-rune"]);
  assert.ok(run.events.every(event => event.type === "task-resolved"));
});
