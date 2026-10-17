import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/hidden-blade.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-3dda301e097b7f95aea9fe9c82ccf2b5b310023e40847896aaedb9aff1c0bce1";
const [hidden, action, play] = program.abilities;
const [kill, draw] = play.body;
const killSpec = kill.targets[0];

/** Build a board where the kill target sits at a battlefield and B owns two cards. */
function bladeWorld() {
  return world()
    .deck(["b-top", "b-second"], { owner: "B" })
    .unit("blade-victim", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
}

/** Execute the original body, retaining target filters and location rechecks. */
function runBody(kernel) {
  kernel.setTargets(killSpec.id, [kernel.ref("blade-victim")]);
  return resolveChainBody(play.body, kernel);
}

test("Hidden Blade program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Hidden Blade identity and judge-required status match the printing", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("811.1.d.2"), true);
  assert.equal(program.judgeReason.includes("cost.hidden"), true);
  assert.equal(
    program.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "[Action] (Play on your turn or in showdowns.)\n" +
      "Kill a unit at a battlefield. Its controller draws 2."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Hidden Blade structure: Hidden + Action keywords, printed cost, kill then linked draw", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });

  // "Kill a unit at a battlefield": one target, one unit whose location is a
  // battlefield (355.9.b; 355.10.b keeps the battlefield out of targeting).
  assert.equal(kill.op, "effect.kill");
  assert.equal(kill.linkedTo, undefined);
  assert.equal(kill.targets.length, 1);
  assert.equal(killSpec.id, "hidden-blade.unit");
  assert.deepEqual(killSpec.filter, { type: "unit" });
  assert.deepEqual(killSpec.location, { type: "battlefield" });
  assert.equal(killSpec.min, 1);
  assert.equal(killSpec.max, 1);
  assert.equal(killSpec.selection, "one");

  // "Its controller draws 2": linked to the kill (359.3.e.14), the drawer read
  // from the killed unit's controller, exactly two cards.
  assert.equal(draw.op, "effect.draw");
  assert.equal(draw.linkedTo, "hidden-blade.kill");
  assert.deepEqual(draw.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(draw.args.player, {
    kind: "object-property",
    object: { target: "hidden-blade.unit" },
    property: "controller"
  });
  assert.equal(draw.targets, undefined);
});

test("Hidden Blade golden: the killed unit's controller draws 2", () => {
  const kernel = bladeWorld();
  const outcome = runBody(kernel);

  assert.equal(kernel.getObject("blade-victim").zone, "trash");
  assert.equal(kernel.player("B").handSize, 2);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["hidden-blade.kill", "executed"],
    ["hidden-blade.controller-draws", "executed"]
  ]);
  assert.deepEqual(outcome.events.map(event => event.action), ["kill", "draw"]);
});

test("Hidden Blade golden: a replaced kill still lets the linked draw resolve (359.3.e.14.b)", () => {
  const kernel = bladeWorld();
  kernel.addReplacement(action => (action.type === "kill" ? "replaced" : null));
  const outcome = runBody(kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason ?? ""]), [
    ["hidden-blade.kill", "negated", "replaced"],
    ["hidden-blade.controller-draws", "executed", ""]
  ]);
  assert.equal(kernel.getObject("blade-victim").zone, "board");
  assert.equal(kernel.player("B").handSize, 2);
  assert.equal(kernel.player("A").handSize, 0);
});

test("Hidden Blade golden: a lost target ignores both instructions (359.3.e.14.a)", () => {
  const kernel = bladeWorld();
  const stale = kernel.ref("blade-victim");
  kernel.setTargets(killSpec.id, [stale]);
  // The victim leaves its zone in response: the kill is mistargeted and the
  // linked draw must not execute.
  kernel.perform({ type: "return-to-hand", object: stale });
  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason ?? ""]), [
    ["hidden-blade.kill", "ignored", "mistargeted"],
    ["hidden-blade.controller-draws", "ignored", "linked-ignored"]
  ]);
  assert.equal(kernel.getObject("blade-victim").zone, "hand");
  // Only the victim's own card returned to hand; nobody drew.
  assert.equal(kernel.player("B").handSize, 1);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "Hidden Blade: Hide for :rb_rune_rainbow: and the facedown reaction play (for " +
    ":rb_energy_0:) need a consumer for Hidden's cost.hidden expansion plus the facedown zone, " +
    "Hide action and next-turn timing; Hidden cost plans are already available."
);
test.todo(
  "Hidden Blade: the 811.1.d.2 restriction that a facedown play must target the battlefield " +
    "the card was hidden at is enforced by Hidden's expansion consumer and the target system."
);

test("Hidden Blade golden: moving to Base keeps the reference but mistargets both instructions", () => {
  const kernel = bladeWorld();
  const locked = kernel.ref("blade-victim");
  kernel.setTargets(killSpec.id, [locked]);
  kernel.perform({ type: "move-location", object: locked, to: { type: "base", player: "B" } });
  assert.deepEqual(kernel.ref("blade-victim"), locked);
  const outcome = resolveChainBody(play.body, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["hidden-blade.kill", "ignored", "mistargeted"],
    ["hidden-blade.controller-draws", "ignored", "linked-ignored"]
  ]);
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("blade-victim").zone, "board");
  assert.equal(kernel.player("B").handSize, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test("Hidden Blade golden: a controlled opposing card draws for its controller after the kill", () => {
  const kernel = world().deck(["one", "two"], { owner: "B" })
    .unit("blade-victim", { owner: "A", controller: "B" }).build();
  const outcome = runBody(kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["blade-victim"]);
  assert.equal(kernel.player("B").handSize, 2);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["kill", "draw"]);
});
