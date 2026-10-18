// Golden test for Ziggs, Explosive (rad-112-167).
// The activated cost shape, the token declaration, the Defense Trigger and the
// "you may kill a friendly gear" cost-within-instruction are all encoded. The
// The kill plus the +2 Might half execute through the merged primitives. The
// Bomb token definition, its Deploy/Deathknell consumers and the defense-declared
// producer remain judged gaps.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ziggs-explosive.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveLocationSelector } from "../../../../engine-core/dist/target/location/ref.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { registryById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL = "card.hash-a4dcf84569e39376034bcb5b5816e3361ee7d9b6fd2439ec78f018cb3c3ec4d5";
const SOURCE_TEXT =
  ":rb_energy_1:, :rb_exhaust:: Play a Bomb gear token to a battlefield. (It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)\n" +
  "When I defend, you may kill a friendly gear to give me +2 :rb_might: this turn.";

const [activated, defendTrigger] = program.abilities;
const [playBomb] = activated.body;
const [mayKillGear] = defendTrigger.body;
const [killGear, grantMight] = mayKillGear.args.body.value;

/** Build a board with Ziggs and one friendly gear, bound as the ability host. */
function board() {
  const kernel = world()
    .unit("ziggs", {
      name: "Ziggs, Explosive",
      might: 4,
      location: { type: "battlefield", id: "bf-1" }
    })
    .object("gear", {
      name: "Hextech Battery",
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: null,
      power: null
    })
    .build();
  kernel.setPicks("ziggs.friendly-gear", [kernel.ref("gear")]);
  return kernel.clone({ sourceSnapshot: kernel.getObject("ziggs") });
}

test("rad-112-167 Ziggs, Explosive: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-112-167 Ziggs, Explosive: judgeReason names the current gaps only", () => {
  assert.match(program.judgeReason, /187\.12/);
  assert.match(program.judgeReason, /Bomb/);
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /Deathknell/);
  assert.match(program.judgeReason, /defense-declared/);
  assert.match(program.judgeReason, /LocationExpr/);
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /continuous\.location/);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  // 2026-10-18: the static-binder, hold-filter and token-argument rejections are
  // observed, so each must be named rather than only described.
  assert.match(program.judgeReason, /Invalid effect\.token argument: location/);
  assert.match(program.judgeReason, /has no layer mapping/);
  assert.match(program.judgeReason, /Unsupported filter field here/);
  // The merged 830.1.b.3 cleanup exemption is recorded as already merged.
  assert.match(program.judgeReason, /recall-action/);
  assert.match(program.judgeReason, /不再是缺口/);
  assert.doesNotMatch(program.judgeReason, /RIFT-357|RIFT-82|RIFT-257|RIFT-33|RIFT-124/);
  assert.doesNotMatch(program.judgeReason, /cleanup 的非单位 Deploy 免召回/);
});

test("rad-112-167 Ziggs, Explosive: the activated ability costs 1 energy plus exhausting this unit (145.1/377)", () => {
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(activated.cost.payments, [{ kind: "exhaust" }]);
  assert.equal(activated.restriction, undefined);
});

test("rad-112-167 Ziggs, Explosive: the body declares a played Bomb token to a Finalize-chosen battlefield (187.12, 440.2.c)", () => {
  assert.equal(activated.body.length, 1);
  assert.equal(playBomb.id, "ziggs.play-bomb-token");
  assert.equal(playBomb.op, "effect.token");
  assert.deepEqual(playBomb.args.token, { kind: "constant", value: "bomb" });
  assert.deepEqual(playBomb.args.amount, { kind: "constant", value: 1 });
  // 185.2.a / 440.2.c: a played token is created on the Chain and handed to play.
  assert.deepEqual(playBomb.args.mode, { kind: "constant", value: "play" });
  // 355.10.b: the battlefield is a play permission, not a target.
  assert.equal(playBomb.targets, undefined);
  assert.equal(playBomb.picks, undefined);
  // 355.2.a / merged location selectors: Finalize chooses one current Battlefield.
  assert.deepEqual(playBomb.args.location, {
    kind: "location",
    value: {
      kind: "choose",
      id: "bomb-token-battlefield",
      filter: { type: "battlefield" }
    }
  });
  assert.equal(playBomb.args.locations, undefined);
  assert.equal(playBomb.args.choiceId, undefined);
  assert.equal(playBomb.args.linkKey.value, "bombToken");
});

test("rad-112-167 Ziggs, Explosive: the merged chain-create + play handoff runs with a concrete battlefield", () => {
  // The Bomb definition is the judged gap (see the todos). The instruction's
  // own shape - mode "play" through a resolved Battlefield destination - is run
  // for real with the frozen Mech definition (187.4) so the declared structure
  // is proven executable rather than only validated.
  const kernel = world()
    .unit("ziggs", { might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "mech" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "battlefield", id: "bf-1" } },
      linkKey: { kind: "constant", value: "bombToken" }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.bombToken.amount, 1);
  assert.equal(run.linked.bombToken.createdAmount, 1);
  assert.equal(run.linked.bombToken.objectsComplete, true);
  const [created] = kernel.objects.filter(object => object.isToken);
  assert.equal(created.name, "Mech");
  assert.deepEqual(created.location, { type: "battlefield", id: "bf-1" });
  // The declaration itself still names Bomb and the location selector.
  assert.equal(playBomb.args.token.value, "bomb");
  assert.equal(playBomb.args.location.value.kind, "choose");
});

test("rad-112-167 Ziggs, Explosive: the merged location selector resolves a Battlefield before token play", () => {
  const first = { type: "battlefield", id: "bf-1" };
  const second = { type: "battlefield", id: "bf-2" };
  const kernel = world()
    .unit("ziggs", { might: 4, location: first })
    .unit("other", { might: 2, location: second })
    .build();
  kernel.setAnswers({ "bomb-token-battlefield": second });
  const selected = resolveLocationSelector(playBomb.args.location.value, {
    context: kernel,
    players: ["A", "B"],
    opponent: "B"
  });
  assert.deepEqual(selected, second);
  const run = runInstruction(
    token,
    { ...playBomb.args, token: { kind: "constant", value: "mech" }, location: { kind: "constant", value: selected } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const [created] = kernel.objects.filter(object => object.isToken);
  assert.equal(created.name, "Mech");
  assert.deepEqual(created.location, second);
});

test("rad-112-167 Ziggs, Explosive: the interpreted location expression cannot cross effect.token's frozen argsSchema", () => {
  // The card's declared argument is { kind: "location", value: { kind: "choose", ... } }.
  // effect.token only accepts Expr values, and its location slot must be a
  // concrete LocationRef supplied by evaluation; the authored form is therefore
  // rejected at the boundary (the interpreter has no adapter for it).
  assert.deepEqual(playBomb.args.location, {
    kind: "location",
    value: { kind: "choose", id: "bomb-token-battlefield", filter: { type: "battlefield" } }
  });
  assert.throws(
    () => token.argsSchema.parse(playBomb.args),
    /Invalid effect\.token argument: location/
  );
  // A concrete LocationRef constant is accepted, which is what the golden tests
  // above use to exercise the create/play handoff with a merged token definition.
  const accepted = token.argsSchema.parse({
    ...playBomb.args,
    token: { kind: "constant", value: "mech" },
    location: { kind: "constant", value: { type: "battlefield", id: "bf-1" } }
  });
  assert.deepEqual(accepted.location, { kind: "constant", value: { type: "battlefield", id: "bf-1" } });
});

test("rad-112-167 Ziggs, Explosive: the Bomb definition and the trigger.leave op are both unregistered (187.12 / 808)", () => {
  // The frozen table has no Bomb entry, so executing the card's own token id is
  // negated with the blocked reason instead of inventing a definition.
  const kernel = world().unit("ziggs", { might: 4, location: { type: "battlefield", id: "bf-1" } }).build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "bomb" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "battlefield", id: "bf-1" } },
      linkKey: { kind: "constant", value: "bombToken" }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.bombToken.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
  // 808 Deathknell declares the leave op but nothing registers it.
  assert.equal(registryById.has("trigger.leave"), false);
  const [deathknellAbility] = keywordDefinitionsById.get("Deathknell").expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(deathknellAbility.body[0].op, "trigger.leave");
});

test("rad-112-167 Ziggs, Explosive: Deploy's static layer and hold trigger are both rejected by the production binder", () => {
  // 830.1.b / 830.1.c: the merged Deploy expansion declares a continuous.location
  // static and a hold trigger. layerFor has no mapping for the first, and the
  // second's "here" anchor is outside the trigger filter vocabulary.
  const [deployStatic, deployTrigger] = keywordDefinitionsById.get("Deploy").expand({ value: undefined, host: { canonicalCardId: CANONICAL } });
  const engine = {
    layers: { registry: { list: () => [] }, addContinuous: () => {}, removeContinuous: () => {}, currentTimingPoint: "main-start" },
    pipeline: { host: {} }
  };
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(deployStatic, {
      ref: { id: "bomb", zoneEntryId: 1 },
      controller: "A",
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      types: ["gear"],
      tags: [],
      keywords: [],
      owner: "A",
      cardId: null,
      name: "Bomb",
      might: null,
      energy: null,
      power: null,
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: true
    }),
    error => error.code === "judge-required" &&
      /Static ability kind continuous\.location has no layer mapping/.test(error.message)
  );
  assert.throws(
    () => translateTriggerFilter(deployTrigger.trigger.filter, "bomb", deployTrigger.trigger.at),
    error => error.code === "judge-required" && /Unsupported filter field here/.test(error.message)
  );
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

test("rad-112-167 Ziggs, Explosive: 'you may kill a friendly gear to give me +2 Might' is one optional holding the cost and effect (355.10.c.1)", () => {
  assert.equal(defendTrigger.body.length, 1);
  assert.equal(mayKillGear.id, "ziggs.may-kill-gear");
  assert.equal(mayKillGear.op, "choice.optional");
  assert.equal(mayKillGear.linkedTo, undefined);
  assert.deepEqual(
    mayKillGear.args.body.value.map(entry => entry.id),
    ["ziggs.kill-gear", "ziggs.grant-plus-two"]
  );

  // CR 355.10.c's own example: the "[do X] to [do Y]" cost "does not target
  // anything", so the killed gear is a non-target pick, never a TargetSpec.
  assert.equal(killGear.op, "effect.kill");
  assert.equal(killGear.targets, undefined);
  assert.deepEqual(killGear.args.picks, { kind: "constant", value: "ziggs.friendly-gear" });
  assert.deepEqual(killGear.picks, [
    {
      id: "ziggs.friendly-gear",
      options: ["friendly-gear-you-control"],
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
  // "me" is the ability host; appliesTo self binds it at resolution.
  assert.deepEqual(grantMight.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(grantMight.args.target, undefined);
});

test("rad-112-167 Ziggs, Explosive: accepting kills the picked gear and registers the end-of-turn +2 Might", () => {
  const kernel = board();
  kernel.setAnswers({ "ziggs.may-kill-gear/optional": true });

  const outcome = runAbilityBody(defendTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  const byId = new Map(outcome.results.map(entry => [entry.id, entry.result]));
  assert.equal(byId.get("ziggs.kill-gear").status, "executed");
  assert.equal(byId.get("ziggs.grant-plus-two").status, "executed");
  assert.equal(byId.get("ziggs.may-kill-gear").status, "executed");

  // The instruction-internal cost really killed the picked gear (429.1).
  assert.equal(kernel.getObject("gear").zone, "trash");
  assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);

  // "+2 [M] this turn" is an arithmetic-layer effect that lasts until end of
  // turn (143.2.a.1/478.1.a, 317.2.c), registered through continuous.might.
  assert.equal(kernel.continuousEffects.length, 1);
  const registration = kernel.continuousEffects[0];
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  assert.equal(registration.effect.filter.objectId, "ziggs");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  // The layers engine really applies the grant: 4 Might becomes 6.
  const engine = createLayerEngine([kernel.getObject("ziggs")], kernel.continuousEffects);
  assert.equal(engine.evaluate(kernel.ref("ziggs")).might, 6);
});

test("rad-112-167 Ziggs, Explosive: declining skips the kill and the +2 Might", () => {
  const kernel = board();
  kernel.setAnswers({ "ziggs.may-kill-gear/optional": false });

  const outcome = runAbilityBody(defendTrigger.body, kernel);

  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("gear").zone, "board");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("rad-112-167 Ziggs, Explosive: a stale gear pick is dropped instead of granting +2 Might", () => {
  const kernel = board();
  const stale = kernel.ref("gear");
  // The gear leaves the board after the pick was locked (359.3.e.8).
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setAnswers({ "ziggs.may-kill-gear/optional": true });

  const outcome = runAbilityBody(defendTrigger.body, kernel);

  const byId = new Map(outcome.results.map(entry => [entry.id, entry.result]));
  assert.equal(byId.get("ziggs.kill-gear").status, "ignored");
  assert.equal(byId.get("ziggs.kill-gear").reason, "mistargeted");
  // The linked +2 fails closed with its cost instead of granting for free.
  assert.equal(byId.get("ziggs.grant-plus-two").status, "ignored");
  assert.equal(byId.get("ziggs.grant-plus-two").reason, "linked-ignored");
  assert.equal(kernel.continuousEffects.length, 0);
});

test.todo(
  "rad-112-167 Ziggs, Explosive: the CR 187.12 Bomb gear token definition (domainless gear with " +
    "[Deploy] and its own Deathknell text) is absent from the frozen effect.token definition table; " +
    "TokenSpec carries no ability field, so the table and token action must be extended before Bomb " +
    "can be created"
);

test.todo(
  "rad-112-167 Ziggs, Explosive: effect.token still needs an interpreter adapter that accepts " +
    "the evaluated LocationExpr selector at its frozen argsSchema boundary"
);

test.todo(
  "rad-112-167 Ziggs, Explosive: Deploy still needs the continuous.location Finalize destination " +
    "validator and hold-trigger location filtering; the Bomb Deathknell body still needs a registered " +
    "trigger.leave primitive plus the 'here' location and mass-kill expansion"
);

test.todo(
  "rad-112-167 Ziggs, Explosive: the defense-declared timing point has no producer because " +
    "combat/flow.ts still throws TurnCombatBlockedError('combat-start-transaction') before the " +
    "Defend Trigger can enter the chain"
);

