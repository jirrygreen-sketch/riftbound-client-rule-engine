import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import enGarde from "../../../dist/cards/ogn/en-garde.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-9e538f0004c80732dc1212c4b54ff1803de134cd9a4b8e1bb91a6c710b43a73a";
const [keyword, play] = enGarde.abilities;
const [firstClause, secondClause] = play.body;
const field = { type: "battlefield", id: "battlefield-1" };

function scenario({ ally = false, enemy = false, turnPlayer = "A" } = {}) {
  const binding = createProgramBinding({ cardPrograms: [enGarde] });
  const requests = [];
  const f = fixture({
    turnPlayer,
    energy: 3,
    describePlay: binding.describePlay,
    cards: [
      { id: "en-garde", cardId: CANONICAL, types: ["spell"], energy: 1, power: [] },
      { id: "solo", types: ["unit"], might: 2 },
      ...(ally ? [{ id: "ally", types: ["unit"], might: 2 }] : []),
      ...(enemy ? [{ id: "opponent", types: ["unit"], owner: "B", controller: "B", might: 2 }] : [])
    ],
    choose: request => {
      if (request.type !== "select-objects") return undefined;
      requests.push(request);
      return [request.options.find(ref => ref.id === "solo")];
    }
  });
  for (const id of ["solo", ...(ally ? ["ally"] : []), ...(enemy ? ["opponent"] : [])]) {
    f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "battlefield", location: field });
  }
  f.engine.advance();
  binding.attachLifecycle(f.engine, (error, source) => {
    if (source.cardId === CANONICAL) throw error;
  });
  return { ...f, binding, requests };
}

function playCard(f) {
  f.engine.execute(f.binding.describePlay(
    { type: "play", object: f.kernel.ref("en-garde"), player: "A" }, f.kernel.getObject("en-garde")
  ));
  const item = f.engine.items.find(entry => entry.source.cardId === CANONICAL);
  assert.equal(item.status, "finalized");
  assert.equal(item.speed, "reaction");
  assert.equal(item.costPlan.total.energy, 1);
  assert.equal(item.targetPlans.length, 1);
  assert.deepEqual(item.targetPlans[0].selected, [f.kernel.ref("solo")]);
  assert.equal(f.kernel.player("A").energy, 2);
  return item;
}

test("En Garde validates, is registered and preserves its identity and printed text", () => {
  const result = validateCardProgram(enGarde);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(enGarde.canonicalCardId, CANONICAL);
  assert.equal(enGarde.rulesetVersion, "core-1.5");
  assert.equal(enGarde.status, "executable");
  assert.equal(cardRegistryById.get(CANONICAL), enGarde);
  assert.equal(enGarde.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a friendly unit +1 :rb_might: this turn, then an additional +1 :rb_might: this turn " +
    "if it is the only unit you control there.");
});

test("En Garde declares one target shared by the two ordered temporary Might clauses", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["grant-plus-1", "continuous.might"],
    ["grant-plus-1-conditional", "continuous.might"]
  ]);
  for (const instruction of play.body) {
    assert.deepEqual(instruction.args, {
      amount: { kind: "constant", value: 1 },
      duration: { kind: "constant", value: "this-turn" },
      objects: { kind: "constant", value: { kind: "target", id: "friendly-unit" } }
    });
    assert.equal(instruction.linkedTo, undefined);
  }
  assert.deepEqual(firstClause.targets, [{
    id: "friendly-unit", filter: { type: "unit", controller: "controller" },
    min: 1, max: 1, selection: "one"
  }]);
  assert.equal(secondClause.targets, undefined);
  assert.equal(firstClause.condition, undefined);
  assert.deepEqual(secondClause.condition, {
    kind: "compare",
    left: { kind: "count", subject: "units", filter: {
      type: "unit", controller: "self",
      sameLocationAs: { target: "friendly-unit" }, exclude: { target: "friendly-unit" }
    } },
    operator: "eq", right: { kind: "constant", value: 0 }
  });
});

test("En Garde executes both clauses for a lone friendly unit even with an enemy there, then expires", () => {
  const f = scenario({ enemy: true });
  playCard(f);
  resolveAll(f.engine);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("solo")).might, 4);
  assert.equal(f.kernel.getObject("opponent").might, 2);
  assert.equal(f.kernel.getObject("solo").buffs, 0);
  assert.equal(f.kernel.getObject("en-garde").zone, "trash");
  assert.equal(f.requests.length, 1, "one Finalize selection for both clauses");
  const targets = f.engine.pipeline.events.filter(event => event.timingPoint === "became-target");
  assert.deepEqual(targets.map(event => event.object.ref.id), ["solo"]);
  assert.deepEqual(f.engine.layers.registry.snapshot().map(entry => entry.effect.effect.amount), [1, 1]);
  f.engine.emit({ timingPoint: "turn-end", player: "A" });
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("solo")).might, 2);
});

test("En Garde rechecks the target's live location at Resolve and ignores allies elsewhere", () => {
  const f = scenario({ ally: true });
  playCard(f);
  f.engine.commit({ type: "move-location", object: f.kernel.ref("solo"), to: { type: "battlefield", id: "battlefield-2" } });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("solo")).might, 4);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("ally")).might, 2);
  f.engine.emit({ timingPoint: "turn-end", player: "A" });
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("solo")).might, 2);
});

test("En Garde reacts on the opponent's turn, gives only +1 beside an ally and ignores a departed target", () => {
  for (const leaves of [false, true]) {
    const f = scenario({ ally: true, turnPlayer: "B" });
    // An ordinary ability on B's turn opens Priority; En Garde is played as
    // a Reaction above it, through its unmodified CardProgram binding.
    f.engine.execute(f.draft("opponent-ability", { controller: "B" }));
    f.engine.pass("B");
    assert.equal(f.engine.canAct("A", "reaction"), true);
    playCard(f);
    if (leaves) {
      f.engine.commit({ type: "return-to-hand", object: f.kernel.ref("solo") });
      f.engine.advance();
    }
    resolveAll(f.engine);
    assert.equal(f.engine.layers.snapshot(f.kernel.ref("solo")).might, leaves ? 2 : 3);
    assert.equal(f.engine.layers.registry.snapshot().length, leaves ? 0 : 1);
    assert.equal(f.kernel.getObject("en-garde").zone, "trash");
    f.engine.emit({ timingPoint: "turn-end", player: "B" });
    assert.equal(f.engine.layers.snapshot(f.kernel.ref("solo")).might, 2);
  }
});
