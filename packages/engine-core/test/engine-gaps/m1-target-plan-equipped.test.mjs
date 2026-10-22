// RIFT-933: TargetPlan must give dependency predicates the complete visible
// object set during Finalize and Resolve. Rule evidence: CR v1.5 818.3.b.
// These tests use the shipped Strike Down IR through the production ProgramBinding,
// ChainEngine, and lifecycle assembly; no target choice or game state is settled
// by hand.
import assert from "node:assert/strict";
import test from "node:test";

import strikeDown from "../../../card-dsl/dist/cards/sfd/strike-down.js";
import { productionPlay } from "../../../card-dsl/test/fixtures/production-play.mjs";

function executableStrikeDown() {
  const program = structuredClone(strikeDown);
  // The card task owns the shipped status. This engine regression exercises its
  // complete, repaired target IR instead of a temporary variant that removes
  // the equipped restriction.
  program.status = "executable";
  delete program.judgeReason;
  return program;
}

function passUntilEmpty(engine) {
  for (let count = 0; engine.items.length; count++) {
    assert.ok(count < 20, "chain settles through real priority passes");
    engine.pass(engine.priority);
  }
}

function strikeDownFixture() {
  const program = executableStrikeDown();
  return productionPlay({
    programs: [program],
    build: world => world
      .player("A", { energy: 3, power: ["Body"] })
      .player("B")
      .object("strike-down", {
        owner: "A",
        controller: "A",
        cardId: program.canonicalCardId,
        types: ["spell"],
        zone: "hand",
        energy: 3,
        power: ["Body"],
      })
      .unit("equipped-host", {
        owner: "A",
        controller: "A",
        might: 3,
        location: { type: "battlefield", id: "bf1" },
      })
      .unit("unarmed-host", {
        owner: "A",
        controller: "A",
        might: 3,
        location: { type: "battlefield", id: "bf1" },
      })
      .unit("enemy", {
        owner: "B",
        controller: "B",
        might: 5,
        location: { type: "base", player: "B" },
      })
      .object("sword", {
        owner: "A",
        controller: "A",
        types: ["gear"],
        tags: ["Equipment"],
        zone: "board",
        location: { type: "battlefield", id: "bf1" },
        energy: null,
        power: null,
        might: null,
      }),
  });
}

test("RIFT-933 Finalize offers only equipped Units and resolves the shipped Strike Down targets", () => {
  const f = strikeDownFixture();
  assert.equal(f.engine.commit({
    type: "attach",
    object: f.kernel.ref("sword"),
    host: f.kernel.ref("equipped-host"),
  }).status, "done");
  f.engine.advance();
  f.engine.execute(f.describe("strike-down"));

  const targetRequests = f.targetRequests().filter(request => request.id.startsWith("target:"));
  assert.deepEqual(
    targetRequests.map(request => [request.id, request.options.map(option => option.id)]),
    [
      ["target:equipped-friendly-unit", ["equipped-host"]],
      ["target:enemy-unit", ["enemy"]],
    ],
  );
  const [item] = f.engine.items;
  assert.equal(item.status, "finalized");
  assert.deepEqual(item.targetPlans[0].selected, [f.kernel.ref("equipped-host")]);
  assert.deepEqual(item.targetPlans[1].selected, [f.kernel.ref("enemy")]);
  passUntilEmpty(f.engine);

  assert.equal(f.requests.some(request => request.id.includes("detached-equipment")), true);
  assert.equal(f.kernel.getObject("enemy").damage, 4, "printed Might 3 plus the attached Equipment's Might Bonus 1");
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.deepEqual(f.engine.items, []);
});

test("RIFT-933 Resolve rejects a locked target after its Equipment actually detaches", () => {
  const f = strikeDownFixture();
  assert.equal(f.engine.commit({
    type: "attach",
    object: f.kernel.ref("sword"),
    host: f.kernel.ref("equipped-host"),
  }).status, "done");
  f.engine.advance();
  f.engine.execute(f.describe("strike-down"));
  const firstRequest = f.requests.find(request => request.id === "target:equipped-friendly-unit");
  assert.deepEqual(firstRequest.options.map(option => option.id), ["equipped-host"]);
  const [item] = f.engine.items;
  assert.deepEqual(item.targetPlans.map(plan => plan.selected), [
    [f.kernel.ref("equipped-host")],
    [f.kernel.ref("enemy")],
  ]);

  f.engine.pass(f.engine.priority);
  assert.deepEqual(f.engine.items[0].status, "finalized");
  assert.equal(f.engine.commit({ type: "detach", object: f.kernel.ref("sword") }).status, "done");
  f.engine.advance();
  const stateBeforeResolve = {
    enemy: structuredClone(f.kernel.getObject("enemy")),
    host: structuredClone(f.kernel.getObject("equipped-host")),
    sword: structuredClone(f.kernel.getObject("sword")),
    player: structuredClone(f.kernel.player("A")),
  };
  const requestsBeforeResolve = f.requests.length;

  passUntilEmpty(f.engine);

  assert.deepEqual({
    enemy: f.kernel.getObject("enemy"),
    host: f.kernel.getObject("equipped-host"),
    sword: f.kernel.getObject("sword"),
    player: f.kernel.player("A"),
  }, stateBeforeResolve, "the mistargeted spell changes no Unit, resource, or Equipment state");
  assert.equal(f.requests.length, requestsBeforeResolve, "Resolve does not widen to the unarmed Unit or prompt for a new pick");
  assert.equal(f.kernel.getObject("enemy").damage, 0);
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.deepEqual(f.engine.items, []);
});
