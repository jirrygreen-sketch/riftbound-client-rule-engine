// Golden test for Ziggs, Explosive (rad-112-167).
// The activated cost shape, the Bomb token boundary, the defense trigger and the
// optional kill-a-gear cost are all encoded; the Bomb definition, the battlefield
// choice, the Deploy/Deathknell expansions and temporary Might are the judged gaps.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ziggs-explosive.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-a4dcf84569e39376034bcb5b5816e3361ee7d9b6fd2439ec78f018cb3c3ec4d5";
const SOURCE_TEXT =
  ":rb_energy_1:, :rb_exhaust:: Play a Bomb gear token to a battlefield. (It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)\n" +
  "When I defend, you may kill a friendly gear to give me +2 :rb_might: this turn.";

const [activated, defendTrigger] = program.abilities;
const [playBomb] = activated.body;
const [mayKillGear] = defendTrigger.body;
const [killGear, grantMight] = mayKillGear.args.body.value;

test("rad-112-167 Ziggs, Explosive: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-112-167 Ziggs, Explosive: judgeReason names the Bomb definition, location choice, Deploy/Deathknell and temporary Might", () => {
  assert.match(program.judgeReason, /Bomb/);
  assert.match(program.judgeReason, /187\.12/);
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /Deathknell/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-62/);
});

test("rad-112-167 Ziggs, Explosive: the activated ability costs 1 energy plus exhausting this unit (145.1/377)", () => {
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(activated.cost.payments, [{ kind: "exhaust" }]);
  assert.equal(activated.restriction, undefined);
});

test("rad-112-167 Ziggs, Explosive: the body plays a Bomb gear token to a battlefield (187.12, 440.2.c)", () => {
  assert.equal(activated.body.length, 1);
  assert.equal(playBomb.id, "ziggs.play-bomb-token");
  assert.equal(playBomb.op, "effect.token");
  assert.deepEqual(playBomb.args.token, { kind: "constant", value: "bomb" });
  assert.deepEqual(playBomb.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playBomb.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playBomb.args.locations.value, [
    { type: "battlefield", id: "any-battlefield" }
  ]);
  assert.equal(playBomb.args.choiceId.value, "bomb-token-battlefield");
  assert.equal(playBomb.linkedTo, undefined);
});

test("rad-112-167 Ziggs, Explosive: the Bomb definition stays blocked in the frozen token table", () => {
  const kernel = world().build();
  const run = runInstruction(
    token,
    {
      token: playBomb.args.token,
      amount: playBomb.args.amount,
      mode: playBomb.args.mode,
      location: {
        kind: "constant",
        value: { type: "battlefield", id: "battlefield-1" }
      },
      linkKey: { kind: "constant", value: "bombToken" }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.bombToken.amount, 0);
  assert.equal(
    run.linked.bombToken.blockedReason,
    "token-definition-or-abilities-judge-required"
  );
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
});

test("rad-112-167 Ziggs, Explosive: 'When I defend' is the defense-declared self trigger (383.4.f)", () => {
  assert.equal(defendTrigger.kind, "triggered");
  assert.equal(defendTrigger.trigger.at, "defense-declared");
  assert.deepEqual(defendTrigger.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self" }
  });
  assert.equal(defendTrigger.optional, false);
});

test("rad-112-167 Ziggs, Explosive: 'you may kill a friendly gear to give me +2 Might' is one optional holding the paid instruction (355.10.c.1)", () => {
  assert.equal(defendTrigger.body.length, 1);
  assert.equal(mayKillGear.id, "ziggs.may-kill-gear");
  assert.equal(mayKillGear.op, "choice.optional");
  assert.equal(mayKillGear.linkedTo, undefined);
  assert.deepEqual(
    mayKillGear.args.body.value.map(entry => entry.id),
    ["ziggs.kill-gear", "ziggs.grant-plus-two"]
  );

  assert.equal(killGear.op, "effect.kill");
  assert.deepEqual(killGear.targets, [
    {
      id: "ziggs.friendly-gear",
      filter: { type: "gear", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // The +2 Might instruction depends on the paid kill: no kill, no +2.
  assert.equal(grantMight.op, "continuous.might");
  assert.equal(grantMight.linkedTo, killGear.id);
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
});

test("rad-112-167 Ziggs, Explosive: the friendly gear is killed through the merged effect.kill", () => {
  const kernel = world()
    .unit("ziggs", { might: 4, location: { type: "battlefield", id: "bf-1" } })
    .object("gear", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: null,
      power: null
    })
    .build();
  // The pre-kill reference is what the instruction resolves (the kill then moves
  // the gear to Trash, so its current reference gains a new zone entry).
  const gearRef = kernel.ref("gear");
  const run = runInstruction(
    kill,
    { target: "ziggs.friendly-gear" },
    { world: kernel, targets: { "ziggs.friendly-gear": [gearRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [gearRef]);
  // loadObject refetches the current reference after the kill changed its zone.
  assert.equal(kernel.getObject("gear").zone, "trash");
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
});

test("rad-112-167 Ziggs, Explosive: declining skips the kill and the +2 Might", () => {
  const kernel = world()
    .unit("ziggs", { might: 4, location: { type: "battlefield", id: "bf-1" } })
    .object("gear", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: null,
      power: null
    })
    .build();
  kernel.setTargets("ziggs.friendly-gear", [kernel.ref("gear")]);
  kernel.setAnswers({ "ziggs.may-kill-gear/optional": false });
  const outcome = runAbilityBody(defendTrigger.body, kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("gear").zone, "board");
});

test.todo(
  "rad-112-167 Ziggs, Explosive: Bomb gear token definition carrying [Deploy] and its Deathknell " +
    "\"Deal 2 to an enemy there and kill your other Bombs there\" (CR 187.12) — absent from the frozen " +
    "effect.token table (RIFT-62/RIFT-63)"
);
test.todo(
  "rad-112-167 Ziggs, Explosive: 'to a battlefield' as a dynamic play-location choice for the token " +
    "(CR 355.2.a/355.2.b, 830.1.b) — target.location family not merged"
);
test.todo(
  "rad-112-167 Ziggs, Explosive: giving me +2 Might this turn (Arithmetic layer, CR 143.2.a.1/475) — " +
    "continuous.might is not merged (RIFT-91)"
);

