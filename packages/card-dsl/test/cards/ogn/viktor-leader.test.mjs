import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/viktor-leader.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const token = (await import(new URL("effects/instructions/effect.token.js", engineCore))).default;

const CANONICAL = "card.hash-7e53dfef149527260e304de53fa08d40d73dd789893fd093fd83cf275d95b2ac";
const SOURCE_TEXT =
  "When another non-Recruit unit you control dies, play a 1 :rb_might: Recruit unit token into your base.";

const [trigger] = program.abilities;
const [playRecruit] = trigger.body;
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
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /383\.2\.c\.2/);
  assert.match(program.judgeReason, /RIFT-357/);
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
  assert.equal(trigger.body.length, 1);
  assert.equal(playRecruit.id, "viktor.play-recruit");
  assert.equal(playRecruit.op, "effect.token");
  assert.deepEqual(playRecruit.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(playRecruit.args.amount, { kind: "constant", value: 1 });
  // CR 440.2.c / 185.2.a: a token that is played is created on the Chain and
  // handed to the play action — not created on the board first.
  assert.deepEqual(playRecruit.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playRecruit.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(playRecruit.args.linkKey, { kind: "constant", value: "recruitToken" });
  assert.equal(playRecruit.targets, undefined);
  assert.equal(playRecruit.picks, undefined);
  assert.equal(playRecruit.linkedTo, undefined);
  assert.equal(playRecruit.condition, undefined);
});

test("golden execution: with the base bound, one 1-Might Recruit token is created on the Chain and played (CR 187.1, 440.2.c)", () => {
  const kernel = world().build();
  const concrete = {
    ...playRecruit.args,
    location: { kind: "constant", value: BASE_A }
  };
  const run = runInstruction(token, concrete, { world: kernel });

  assert.equal(run.result.status, "executed");
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
  assert.deepEqual(run.linked["recruitToken.objects"], [recruit.ref]);
  assert.equal(run.linked["recruitToken.createdAmount"], 1);
  assert.notDeepEqual(run.linked["recruitToken.createdObjects"], [recruit.ref]);
});

test("golden execution: a second player's world puts its Recruit token into that player's base", () => {
  // The same body evaluated with the controller set to B: the token follows
  // the ability controller (185.2.d/440.4), not the physical player A.
  const kernel = world().build().clone({ controller: "B" });
  const concrete = {
    ...playRecruit.args,
    location: { kind: "constant", value: { type: "base", player: "B" } }
  };
  const run = runInstruction(token, concrete, { world: kernel });

  assert.equal(run.result.status, "executed");
  const [recruit] = kernel.objects.filter(object => object.isToken);
  assert.deepEqual(recruit.location, { type: "base", player: "B" });
  assert.equal(recruit.controller, "B");
});

test("Viktor, Leader: the runtime-bound body executes through the merged token Expr adapter", async () => {
  const { resolveChainBody } = await import("../../../../engine-core/dist/chain/interpreter-adapter.js");
  const kernel = world().build().clone({ controller: "B" });
  const body = trigger.body.map(instruction => ({ ...instruction, args: {
    ...instruction.args, location: { kind: "constant", value: { type: "base", player: "B" } }
  } }));
  const outcome = resolveChainBody(body, kernel);
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

test.todo("Viktor, Leader: bind other/non-Recruit death filters and exclude the same simultaneous death wave as Viktor (CR 133.8 / 383.2.c.2; RIFT-359)");
test.todo("Viktor, Leader: bind the authored controller-base LocationRef and finish token Play through the chain (CR 187.1 / 440.2.c; RIFT-357)");
