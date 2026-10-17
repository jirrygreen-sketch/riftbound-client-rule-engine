import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/viktor-leader.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { translateTriggerFilter } = await import(new URL("programs/filters.js", engineCore));
const { registerProgramTriggers } = await import(new URL("programs/triggers.js", engineCore));
const { ProgramRegistry } = await import(new URL("programs/registry.js", engineCore));
const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
const { matchesTriggerObject } = await import(new URL("events/pipeline-match.js", engineCore));
const { matchesObjectFilter } = await import(new URL("layers/filter.js", engineCore));

const CANONICAL = "card.hash-7e53dfef149527260e304de53fa08d40d73dd789893fd093fd83cf275d95b2ac";
const SOURCE_TEXT =
  "When another non-Recruit unit you control dies, play a 1 :rb_might: Recruit unit token into your base.";

const [trigger] = program.abilities;
const [controllerBase, playRecruit] = trigger.body;
const BASE_A = { type: "base", player: "A" };

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /non-Recruit/);
  assert.match(program.judgeReason, /excludeTags/);
  assert.match(program.judgeReason, /383\.2\.c\.2/);
  assert.match(program.judgeReason, /translateObjectFilter/);
  // Re-probed 2026-10-17: the reason names the refusing translator plus the
  // still-unverified simultaneous-death lifetime rather than a task number.
  assert.match(program.judgeReason, /other/);
  assert.equal(/RIFT-359/.test(program.judgeReason), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: a mandatory death trigger for another owned non-Recruit unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(trigger.kind, "triggered");
  // CR 429.1: dying = a Permanent going to the trash from the board; the
  // closed object-killed timing point carries that event (ruleRefs 429.1/808.1.d).
  assert.equal(trigger.trigger.at, "object-killed");
  assert.equal(trigger.optional, false);
  assert.equal(trigger.trigger.once, undefined);
  assert.deepEqual(trigger.trigger.filter, {
    event: "object-killed",
    filter: {
      type: "unit",
      controller: "controller",
      other: true,
      excludeTags: ["Recruit"]
    }
  });
});

test("structure: the body plays one CR 187.1 Recruit token into the controller's base", () => {
  assert.equal(trigger.body.length, 2);
  assert.equal(controllerBase.id, "viktor.controller-base");
  assert.equal(controllerBase.op, "condition.value");
  assert.deepEqual(controllerBase.args.value, {
    kind: "location", value: { type: "base", player: "controller" }
  });
  assert.deepEqual(controllerBase.args.key, { kind: "constant", value: "base" });
  assert.equal(playRecruit.id, "viktor.play-recruit");
  assert.equal(playRecruit.op, "effect.token");
  assert.deepEqual(playRecruit.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(playRecruit.args.amount, { kind: "constant", value: 1 });
  // CR 440.2.c / 185.2.a: a token that is played is created on the Chain and
  // handed to the play action — not created on the board first.
  assert.deepEqual(playRecruit.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playRecruit.args.location, {
    kind: "linked-value",
    instructionId: controllerBase.id,
    key: "base"
  });
  assert.deepEqual(playRecruit.args.linkKey, { kind: "constant", value: "recruitToken" });
  assert.equal(playRecruit.targets, undefined);
  assert.equal(playRecruit.picks, undefined);
  assert.equal(playRecruit.linkedTo, undefined);
  assert.equal(playRecruit.condition, undefined);
});

test("golden execution: the authored body creates one 1-Might Recruit token on the Chain and plays it (CR 187.1, 440.2.c)", () => {
  const kernel = world().build();
  const run = resolveChainBody(trigger.body, kernel);

  assert.equal(run.status, "executed");
  assert.equal(run.results[1].result.status, "executed");
  // The actual game actions: create on the Chain, then play it to the base.
  assert.deepEqual(run.events.map(event => event.action), ["create-token", "play"]);
  assert.equal(kernel.pendingItems.length, 0);

  const tokens = kernel.objects.filter(object => object.isToken);
  assert.equal(tokens.length, 1);
  const [recruit] = tokens;
  assert.equal(recruit.name, "Recruit");
  assert.equal(recruit.might, 1);
  assert.deepEqual(recruit.tags, ["Recruit"]);
  assert.deepEqual(recruit.types, ["unit"]);
  // Tokens are not cards (185.1) and have no printed cost or domain (185.3).
  assert.equal(recruit.cardId, null);
  assert.equal(recruit.energy, null);
  assert.equal(recruit.power, null);
  assert.deepEqual(recruit.location, BASE_A);
  assert.equal(recruit.zone, "board");
  assert.equal(recruit.controller, "A");
  assert.equal(recruit.owner, "A");
  // Link receipt: the created reference became stale when play changed zones;
  // the current reference after the play handoff is the live one.
  assert.deepEqual(run.linkedValues["viktor.play-recruit.recruitToken.objects"], [recruit.ref]);
  assert.equal(run.linkedValues["viktor.play-recruit.recruitToken.createdAmount"], 1);
  assert.notDeepEqual(run.linkedValues["viktor.play-recruit.recruitToken.createdObjects"], [recruit.ref]);
});

test("golden execution: a second player's world puts its Recruit token into that player's base", () => {
  // The same body evaluated with the controller set to B: the token follows
  // the ability controller (185.2.d/440.4), not the physical player A.
  const kernel = world().build().clone({ controller: "B" });
  const run = resolveChainBody(trigger.body, kernel);

  assert.equal(run.status, "executed");
  assert.equal(run.results[1].result.status, "executed");
  const [recruit] = kernel.objects.filter(object => object.isToken);
  assert.deepEqual(recruit.location, { type: "base", player: "B" });
  assert.equal(recruit.controller, "B");
});

test("Viktor, Leader: the authored body executes through the merged token Expr adapter", () => {
  const kernel = world().build().clone({ controller: "B" });
  const outcome = resolveChainBody(trigger.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map(event => event.action), ["create-token", "play"]);
  const [recruit] = kernel.objects;
  assert.equal(recruit.name, "Recruit");
  assert.equal(recruit.controller, "B");
  assert.equal(recruit.might, 1);
  assert.equal(recruit.energy, null);
  assert.equal(recruit.power, null);
  assert.deepEqual(recruit.location, { type: "base", player: "B" });
  assert.deepEqual(outcome.linkedValues["viktor.play-recruit.recruitToken.objects"], [recruit.ref]);
});

test("Viktor, Leader boundary: the production filter translator refuses other/excludeTags, so the death trigger cannot register (CR 133.8)", () => {
  // Re-probed 2026-10-17: both authored filter dimensions are outside the
  // translator's whitelist. The refusal happens at registration time, so the
  // dependent ability never even reaches the pipeline.
  for (const [field, message] of [["other", /Unsupported filter field other/], ["excludeTags", /Unsupported filter field excludeTags/]]) {
    assert.throws(
      () => translateTriggerFilter({ event: "object-killed", filter: { type: "unit", controller: "controller", [field]: field === "other" ? true : ["Recruit"] } }, "viktor", "object-killed"),
      (error) => error.code === "judge-required" && message.test(error.message)
    );
  }

  const f = fixture({ cards: [{ id: "viktor", cardId: program.canonicalCardId, types: ["unit"], energy: 5, power: ["Mind"], might: 5 }] });
  assert.throws(
    () => registerProgramTriggers(new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]), f.engine, f.kernel.getObject("viktor")),
    (error) => error.code === "judge-required" && /Unsupported filter field other/.test(error.message)
  );
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
});

test("Viktor, Leader boundary: no merged filter path consumes excludeTags, so Recruit and the source cannot be excluded (CR 133.8)", () => {
  // Re-probed 2026-10-17: even outside the program translator, the layer filter
  // and the trigger matcher only accumulate positive tags. Without a negative
  // dimension a death watcher could not distinguish Recruit tokens or itself.
  const recruit = { ref: { id: "recruit", zoneEntryId: 3 }, cardId: null, name: "Recruit", types: ["unit"], tags: ["Recruit"], keywords: [], owner: "A", controller: "A", zone: "board", location: { type: "base", player: "A" }, might: 1, energy: null, power: null, exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: true };
  assert.equal(matchesTriggerObject({ type: "unit", tags: [] }, recruit, "A"), true);
  assert.equal(matchesTriggerObject({ type: "unit", excludeTags: ["Recruit"] }, recruit, "A"), true, "excludeTags is silently ignored by the trigger matcher");
  assert.equal(matchesObjectFilter({ type: "unit", excludeTags: ["Recruit"] }, recruit), true, "excludeTags is silently ignored by the layer filter");
  assert.deepEqual(program.abilities[0].trigger.filter.filter.excludeTags, ["Recruit"]);
});
for (const controller of ["A", "B"]) {
  for (const sourceLocation of [{ type: "base", player: controller }, { type: "battlefield", id: "bf-1" }]) {
    test(`Viktor, Leader: authored body plays one Recruit into ${controller}'s base from ${sourceLocation.type}`, () => {
      const base = world().unit("viktor", {
        cardId: program.canonicalCardId, owner: controller, controller, location: sourceLocation
      }).build();
      const kernel = base.clone({ controller, sourceSnapshot: base.getObject("viktor") });
      const outcome = resolveChainBody(trigger.body, kernel);
      assert.equal(outcome.status, "executed");
      assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
        ["viktor.controller-base", "executed"], ["viktor.play-recruit", "executed"]
      ]);
      assert.deepEqual(outcome.events.map(event => event.action), ["create-token", "play"]);
      assert.equal(kernel.pendingItems.length, 0);
      assert.equal(kernel.objects.length, 2);
      const recruits = kernel.objects.filter(object => object.isToken);
      assert.equal(recruits.length, 1);
      const [recruit] = recruits;
      assert.equal(recruit.name, "Recruit");
      assert.equal(recruit.might, 1);
      assert.equal(recruit.zone, "board");
      assert.equal(recruit.owner, controller);
      assert.equal(recruit.controller, controller);
      assert.equal(recruit.energy, null);
      assert.equal(recruit.power, null);
      assert.deepEqual(recruit.location, { type: "base", player: controller });
      assert.deepEqual(outcome.linkedValues["viktor.controller-base.base"], recruit.location);
      assert.deepEqual(outcome.linkedValues["viktor.play-recruit.recruitToken.objects"], [recruit.ref]);
      assert.deepEqual(kernel.getObject("viktor").location, sourceLocation);
    });
  }
}
