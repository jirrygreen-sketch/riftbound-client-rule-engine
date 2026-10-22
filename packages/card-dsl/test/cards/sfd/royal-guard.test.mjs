import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/royal-guard.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { productionPlay } from "../../fixtures/production-play.mjs";
// card-dsl has no dependency edge on engine-core, so the chain body entry point
// is loaded through the workspace layout (same as Faithful Manufactor).
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));

const CANONICAL_ID = "card.hash-0ba141b975db96cac65aab56bfd7dbb63904c538cc3d9c32bdfb3b2d98e486de";
const READ_ID = "royal-guard.read-here";
const PLAY_ID = "royal-guard.play-sand-soldier";
const BATTLEFIELD = { type: "battlefield", id: "bf1" };
const BASE_A = { type: "base", player: "A" };

const sandSoldiers = (kernel) =>
  kernel.objects.filter((object) => object.zone === "board" && object.isToken && object.name === "Sand Soldier");

test("sfd-157-221 Royal Guard: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "executable");
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(
    program.sourceText,
    "When you play me, play a 2 :rb_might: Sand Soldier unit token here."
  );
});

test("sfd-157-221 Royal Guard: card-played self trigger reads here then plays one linked token", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.equal(ability.trigger.filter.self, true);
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 2, "mode play already hands the token to Play; no second effect.play");
  const [read, play] = ability.body;
  assert.equal(read.id, READ_ID);
  assert.equal(read.op, "condition.value");
  assert.deepEqual(read.args.value, { kind: "object-property", object: "source", property: "location" });
  assert.deepEqual(read.args.key, { kind: "constant", value: "here" });

  assert.equal(play.id, PLAY_ID);
  assert.equal(play.op, "effect.token");
  assert.equal(play.linkedTo, READ_ID);
  assert.deepEqual(play.args.token, { kind: "constant", value: "sand-soldier" });
  assert.deepEqual(play.args.amount, { kind: "constant", value: 1 });
  // CR v1.5 440.2.c / 185.2.a：被"打出"的 token 先在链上生成再走打出流程。
  assert.deepEqual(play.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(play.args.location, { kind: "linked-value", instructionId: READ_ID, key: "here" });
});

test("sfd-157-221 Royal Guard chain body: plays a 2-Might Shurima Sand Soldier at the source battlefield", () => {
  const kernel = world().unit("royal-guard", { might: 3, location: BATTLEFIELD }).build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("royal-guard") });

  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [[READ_ID, "executed"], [PLAY_ID, "executed"]]
  );
  assert.deepEqual(outcome.linkedValues[READ_ID + ".here"], BATTLEFIELD);
  const tokens = sandSoldiers(kernel);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].might, 2);
  assert.deepEqual(tokens[0].tags, ["Shurima"]);
  assert.deepEqual(tokens[0].location, BATTLEFIELD);
  assert.equal(tokens[0].controller, "A");
});

function playRoyalGuard(location) {
  const f = productionPlay({
    programs: cardProgramsById,
    build: (w) => w.player("A", { energy: 6, power: [] }).player("B", { energy: 2 })
      .object("rg", { owner: "A", controller: "A", cardId: CANONICAL_ID, types: ["unit"], zone: "hand", energy: 3, power: [], might: 3 })
      .unit("held", { owner: "A", controller: "A", might: 1, location: BATTLEFIELD })
  });
  const source = f.kernel.getObject("rg");
  const draft = f.binding.describePlay(
    { type: "play", object: source.ref, player: "A", ...(location ? { location } : {}) },
    source
  );
  f.engine.execute(draft);
  f.settle();
  return f;
}

for (const [label, location, expected] of [
  ["its controller's Base", undefined, BASE_A],
  ["a controlled Battlefield", BATTLEFIELD, BATTLEFIELD]
]) {
  test(`sfd-157-221 Royal Guard production golden: played to ${label}, exactly one Sand Soldier is played there`, () => {
    const f = playRoyalGuard(location);
    assert.deepEqual(f.requests, [], "no unexpected prompts");
    assert.deepEqual(f.kernel.getObject("rg").location, expected);
    const tokens = sandSoldiers(f.kernel);
    assert.equal(tokens.length, 1, "the token is played once, not twice");
    const [soldier] = tokens;
    // CR 187.3: Sand Soldier is a 2 Might Shurima unit token.
    assert.equal(soldier.might, 2);
    assert.deepEqual(soldier.tags, ["Shurima"]);
    assert.equal(soldier.controller, "A");
    // CR 359.3.f: "here" is where Royal Guard is when the instruction executes.
    assert.deepEqual(soldier.location, expected);
    // CR 143.4: a played Unit enters exhausted.
    assert.equal(soldier.exhausted, true);
    assert.equal(f.engine.items.length, 0);
  });
}
