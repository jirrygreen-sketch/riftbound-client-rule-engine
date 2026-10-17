import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/lillia-protector-of-dreams.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import tank from "../../../../engine-core/dist/effects/keywords/Tank.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-6e0aa33991db4d3499a6f694e8bef73ea18c9f5a92c1cff628ee2afc84a34321";
const SOURCE_TEXT =
  "When you play a token unit, give me +1 :rb_might: this turn.\n" +
  "Your token units have [Tank]. (They must be assigned combat damage first.)";

const [tokenPlayed, tokenTank] = program.abilities;
const [grantMight] = tokenPlayed.body;

test("unl-058-219 Lillia, Protector of Dreams: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-058-219 Lillia, Protector of Dreams: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /815\.1\.c|Tank/);
  // Re-checked against the merged sources: the granted Tank's rule behaviour
  // needs a continuous.combat consumer that does not exist yet.
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /damage-assignment/);
  assert.match(program.judgeReason, /proven-none|layer/);
});

test("unl-058-219 Lillia, Protector of Dreams: 'When you play a token unit' is not a Play Effect (383.4.a.4)", () => {
  assert.equal(tokenPlayed.kind, "triggered");
  assert.equal(tokenPlayed.trigger.at, "card-played");
  assert.equal(isTimingPointId("card-played"), true);
  // 383.4.a.4: the ability triggers on ANOTHER object being played, so it is not
  // a Play Effect; the owned token unit is the event object.
  assert.deepEqual(tokenPlayed.trigger.filter, {
    event: "card-played",
    object: { type: "token", controller: "self" }
  });
  assert.equal(tokenPlayed.trigger.condition, undefined);
  assert.equal(tokenPlayed.trigger.once, undefined);
  assert.equal(tokenPlayed.optional, false);
});

test("unl-058-219 Lillia, Protector of Dreams: 'give me +1 Might this turn' uses the merged self-applied layers shape", () => {
  assert.equal(grantMight.id, "lillia-protector-of-dreams.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  // 053.1 / 355.9.c: "me" is the ability host itself.
  assert.deepEqual(grantMight.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(grantMight.targets, undefined);
  assert.notEqual(grantMight.op, "effect.buff");
  assert.equal(grantMight.linkedTo, undefined);
  assert.equal(grantMight.condition, undefined);
});

test("unl-058-219 Lillia, Protector of Dreams: 'Your token units have [Tank]' is a static grant scoped to your token units (801.3.a)", () => {
  assert.equal(tokenTank.kind, "static");
  assert.equal(tokenTank.effect.kind, "continuous.grant-keyword");
  assert.equal(tokenTank.effect.keyword, "Tank");
  assert.deepEqual(tokenTank.effect.filter, {
    // 185.1/185.2 + 355.9.a.1: token units are objects on the board whose token
    // category the merged filter vocabulary matches.
    type: "token",
    controller: "controller",
    zone: "board"
  });
  assert.equal(tokenTank.condition, undefined);
  // The reminder in parentheses is Tank's rule text (135.2.d.1/d.3).
  assert.equal(program.abilities.length, 2);
});

test("unl-058-219 Lillia, Protector of Dreams golden: the Might body registers and expires at end of turn", () => {
  const kernel = world().unit("lillia", {
    owner: "A",
    controller: "A",
    might: 4,
    location: { type: "battlefield", id: "bf-1" }
  }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lillia"), controller: "A" });
  const outcome = resolveChainBody(tokenPlayed.body, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  assert.deepEqual(scoped.continuousEffects[0].duration, { type: "end-of-turn" });
  const layers = createLayerEngine(
    scoped.objects,
    scoped.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }))
  );
  assert.equal(layers.evaluate(scoped.ref("lillia")).might, 5);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(scoped.ref("lillia")).might, 4);
});

test("unl-058-219 Lillia, Protector of Dreams golden: the static binder grants Tank to friendly token units", () => {
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [
      { id: "lillia", cardId: CANONICAL_ID, types: ["unit"], energy: 5, power: [], might: 4 },
      { id: "ally-token", types: ["unit"], isToken: true, might: 3, owner: "A", controller: "A" },
      { id: "enemy-token", types: ["unit"], isToken: true, might: 3, owner: "B", controller: "B" }
    ]
  });
  const board = id => f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref(id),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  board("ally-token");
  board("enemy-token");
  board("lillia");
  const source = f.kernel.getObject("lillia");
  const staticAbility = binding.inspect(source).abilities.find(ability => ability.kind === "static");
  const handle = createEngineStaticBinder(f.engine).bindStatic(staticAbility, source);
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("ally-token")).keywords, [{ id: "Tank", value: undefined }]);
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("enemy-token")).keywords, []);
  handle.unbind();
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("ally-token")).keywords, []);
});

test("unl-058-219 Lillia, Protector of Dreams golden: card-played trigger registration is available", () => {
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [{ id: "lillia", cardId: CANONICAL_ID, types: ["unit"], energy: 5, power: [], might: 4 }]
  });
  const source = { ...f.kernel.getObject("lillia"), cardId: CANONICAL_ID, zone: "board" };
  const ids = binding.registerProgramTriggers(f.engine, source);
  assert.equal(ids.length, 1);
  assert.match(ids[0], /^program:lillia:1:/);
});

test.todo(
  "unl-058-219 Lillia, Protector of Dreams: Tank's continuous.combat requirement must be consumed by combat " +
    "damage assignment (CR 815.1.c) before the card can become executable"
);

test("unl-058-219 Lillia, Protector of Dreams: the granted Tank is a continuous.combat registration no layer or combat kernel reads (CR 815.1.c)", () => {
  // The card's own static grant is real: the layers engine records Tank on the
  // controlled token units. What is missing is the consumer of Tank's own
  // expansion shape, so the granted keyword cannot yet order damage assignment.
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [
      { id: "lillia", cardId: CANONICAL_ID, types: ["unit"], energy: 5, power: [], might: 4 },
      { id: "ally-token", types: ["unit"], isToken: true, might: 3, owner: "A", controller: "A" }
    ]
  });
  for (const id of ["ally-token", "lillia"]) {
    f.engine.commit({
      type: "move-zone",
      object: f.kernel.ref(id),
      to: "board",
      location: { type: "battlefield", id: "bf-1" }
    });
  }
  const source = f.kernel.getObject("lillia");
  const staticAbility = binding.inspect(source).abilities.find((ability) => ability.kind === "static");
  // One binder instance: it owns the per-incarnation ordinal that keeps
  // continuous-effect identities unique.
  const binder = createEngineStaticBinder(f.engine);
  const handle = binder.bindStatic(staticAbility, source);
  assert.deepEqual(
    f.engine.layers.evaluate(f.kernel.ref("ally-token")).keywords,
    [{ id: "Tank", value: undefined }]
  );
  // Tank's own expansion is the unread declarative shape: no layer branch and
  // no combat consumer.
  const [tankExpansion] = tank.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(tankExpansion.effect.kind, "continuous.combat");
  assert.equal(tankExpansion.effect.mode, "damage-assignment");
  assert.equal(tankExpansion.effect.priority, "first");
  const tankHandle = binder.bindStatic(tankExpansion, source);
  const registrations = f.engine.layers.registry.list();
  assert.equal(registrations.length, 2);
  assert.deepEqual(registrations.map((entry) => entry.effect.effect.kind), [
    "continuous.grant-keyword",
    "continuous.combat"
  ]);
  // The layer engine evaluates Might/keyword/trait views only; the combat
  // registration contributes nothing to the evaluated snapshot.
  const evaluated = f.engine.layers.evaluate(f.kernel.ref("ally-token"));
  assert.equal(evaluated.might, 3);
  assert.deepEqual(evaluated.keywords, [{ id: "Tank", value: undefined }]);
  tankHandle.unbind();
  handle.unbind();
});
