import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/peak-guardian.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { queryObjects } = await import(new URL("effects/interpreter/selectors.js", engineCore));
const { queryTargetCandidates } = await import(new URL("target/target-plan.js", engineCore));
const { translateTriggerFilter, translateObjectFilter } = await import(
  new URL("programs/filters.js", engineCore)
);

const SELF_ID = "peak-guardian.buff-me";
const OTHERS_ID = "peak-guardian.buff-others-here";

// These existing goldens isolate Buff counter placement using supplied targets.
// Removing TargetSpecs here does not prove the printed non-target set lifecycle.
const bodyForExecution = () =>
  program.abilities[0].body.map(({ targets, ...rest }) => rest);

test("ogn-223-298 Peak Guardian: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-9280855113d398f4a348f702083fe564e2c7ef030983070eb28dcb3f83835e8d"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /battlefield/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /object: self/);
  assert.match(program.judgeReason, /目标适配器/);
  assert.match(program.judgeReason, /effect\.buff.*非目标/);
  assert.match(program.judgeReason, /355\.10\.d\/355\.10\.d\.1/);
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /became-target/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.equal(
    program.sourceText,
    "When you play me, buff me. Then, if I am at a battlefield, buff all other friendly units there. " +
      "(To buff a unit, give it a +1 :rb_might: buff if it doesn't already have one.)"
  );
});

test("ogn-223-298 Peak Guardian: card-played self trigger, buff-me, then the same-location peer buff", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);

  assert.equal(ability.body.length, 2);
  const [buffMe, buffOthers] = ability.body;
  assert.equal(buffMe.id, SELF_ID);
  assert.equal(buffMe.op, "effect.buff");
  assert.deepEqual(buffMe.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffMe.args.target, { kind: "constant", value: "self-unit" });
  assert.deepEqual(buffMe.targets[0].filter, {
    object: "self",
    type: "unit",
    zone: "board"
  });
  assert.equal(buffMe.linkedTo, undefined);

  // "buff all other friendly units there" is a programmatic selection over
  // characteristics (CR 355.10.d), not a target choice: all + other + friendly +
  // same location as the source (359.3.f.1 "there").
  assert.equal(buffOthers.id, OTHERS_ID);
  assert.equal(buffOthers.op, "effect.buff");
  assert.deepEqual(buffOthers.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffOthers.args.target, { kind: "constant", value: "other-friendlies-here" });
  assert.deepEqual(buffOthers.targets[0].filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    exclude: "self",
    sameLocationAs: "self"
  });
  assert.deepEqual(buffOthers.targets[0].location, { type: "battlefield" });
  assert.equal(buffOthers.targets[0].selection, "all");
  assert.equal(buffOthers.targets[0].min, 0);
  assert.equal(buffOthers.targets[0].max, null);
  // "Then, if I am at a battlefield" is a mandatory conditional clause: it is
  // NOT a player choice, so it must not be wrapped in choice.optional. The
  // merged TargetSpec.location gate rejects the whole peer set when the source
  // is at a base. Both production filter translation and the non-target Buff
  // set lifecycle remain blocked; TargetSpec "all" still targets its members.
  assert.equal(buffOthers.condition, undefined);
});

test("ogn-223-298 Peak Guardian: TargetSpec.location gates the peer set to battlefields", () => {
  const battlefield = world()
    .unit("peak-guardian", { owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-here", { owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-elsewhere", { owner: "A", location: { type: "battlefield", id: "bf-2" } })
    .unit("ally-base", { owner: "A", location: { type: "base", player: "A" } })
    .build();
  const battlefieldContext = battlefield.clone({
    source: battlefield.ref("peak-guardian"),
    sourceSnapshot: battlefield.getObject("peak-guardian"),
    controller: "A"
  });
  const runtimeContext = new Proxy(battlefieldContext, {
    get(target, key) {
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  assert.deepEqual(
    queryObjects(program.abilities[0].body[1].targets[0].filter, {
      context: runtimeContext,
      host: runtimeContext.source.ref,
      linked: id => runtimeContext.linked(id),
      canLookBack: () => true,
      isIgnored: () => false
    }).map(object => object.ref.id),
    ["ally-here"]
  );

  const atBase = world()
    .unit("peak-guardian", { owner: "A", location: { type: "base", player: "A" } })
    .unit("ally-base", { owner: "A", location: { type: "base", player: "A" } })
    .unit("ally-battlefield", { owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const baseContext = atBase.clone({
    source: atBase.ref("peak-guardian"),
    sourceSnapshot: atBase.getObject("peak-guardian"),
    controller: "A"
  });
  assert.equal(baseContext.getObject("peak-guardian").location.type, "base");
  assert.deepEqual(
    queryTargetCandidates(baseContext, program.abilities[0].body[1].targets[0]),
    []
  );
});

test("ogn-223-298 Peak Guardian: trigger-side and instruction-target binding preserve the relative anchors", () => {
  const [ability] = program.abilities;
  // The merged translateTriggerFilter accepts the "When you play me" pattern and
  // binds the event object to this source ref (383/420.4.a trigger side).
  assert.deepEqual(
    translateTriggerFilter(ability.trigger.filter, "peak-guardian-source", "card-played"),
    { event: "card-played", object: { objectId: "peak-guardian-source" } }
  );
  assert.deepEqual(translateObjectFilter(ability.body[0].targets[0].filter), {
    object: "self",
    type: "unit",
    zone: "board"
  });
  assert.deepEqual(translateObjectFilter(ability.body[1].targets[0].filter), {
    type: "unit",
    zone: "board",
    controller: "self",
    exclude: "self",
    sameLocationAs: "self"
  });
});

test("ogn-223-298 Peak Guardian: the Buff primitive rejects a non-target query instead of a TargetSpec id", () => {
  const [, buffOthers] = program.abilities[0].body;
  assert.throws(
    () => buff.argsSchema.parse({
      mode: buffOthers.args.mode.value,
      target: { kind: "query", filter: buffOthers.targets[0].filter }
    }),
    /target must be a non-empty TargetSpec id/
  );
});

test("ogn-223-298 Peak Guardian: the peer Buff set must emit no became-target events (CR 355.10.d/355.10.d.1)", {
  todo: "effect.buff needs a resolution-time non-target set; TargetSpec selection:all currently locks and targets peers at Finalize"
}, () => {
  const f = fixture({ cards: [
    { id: "peak-guardian", cardId: program.canonicalCardId, types: ["unit"], might: 5 },
    { id: "ally-here", types: ["unit"], might: 2 }
  ] });
  for (const id of ["peak-guardian", "ally-here"]) {
    f.engine.commit({
      type: "move-zone", object: f.kernel.ref(id), to: "battlefield",
      location: { type: "battlefield", id: "battlefield-1" }
    });
  }
  f.engine.advance();
  const [, buffOthers] = program.abilities[0].body;
  // Isolate the TargetSpec lifecycle from the independently reproduced symbolic
  // filter translation gap. Resolve this one peer by its live identity; keep the
  // card's original instruction body and the declared all/min/max/location.
  f.engine.execute(f.draft("peak-guardian-peer-set", {
    source: f.kernel.getObject("peak-guardian"),
    body: [buffOthers],
    targets: [{ requirement: {
      ...buffOthers.targets[0],
      filter: { type: "unit", zone: "board", objectId: "ally-here", controller: "A" }
    } }]
  }));
  const [plan] = f.engine.items[0].targetPlans;
  assert.equal(plan.requirement.selection, "all");
  assert.equal(plan.lockedAt, "finalize");
  assert.deepEqual(plan.selected, [f.kernel.ref("ally-here")]);
  assert.equal(f.kernel.getObject("ally-here").buffs, 0, "the effect has not resolved yet");
  // Assert the printed rule, not the engine's currently incorrect card behavior.
  assert.deepEqual(
    f.engine.pipeline.events.filter(event => event.timingPoint === "became-target"),
    [],
    "355.10.d: a programmatically selected peer must never become a target"
  );
});

test("ogn-223-298 Peak Guardian golden: 'buff me' places one Buff, and a second Buff is not placed (CR 702.3.a)", () => {
  const fresh = world()
    .unit("peak-guardian", { might: 5, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  Object.defineProperty(fresh, "source", { value: fresh.getObject("peak-guardian") });
  fresh.setTargets("self-unit", [fresh.ref("peak-guardian")]);
  const freshOutcome = runAbilityBody(bodyForExecution().slice(0, 1), fresh);
  assert.equal(freshOutcome.results[0].result.status, "executed");
  assert.equal(fresh.getObject("peak-guardian").buffs, 1);

  const alreadyBuffed = world()
    .unit("peak-guardian", {
      might: 5,
      buffs: 1,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  Object.defineProperty(alreadyBuffed, "source", { value: alreadyBuffed.getObject("peak-guardian") });
  alreadyBuffed.setTargets("self-unit", [alreadyBuffed.ref("peak-guardian")]);
  const repeatOutcome = runAbilityBody(bodyForExecution().slice(0, 1), alreadyBuffed);
  // 427.1.c / 702.3.a: a unit that already has a Buff is chosen but not Buffed.
  assert.equal(repeatOutcome.results[0].result.status, "negated");
  assert.equal(repeatOutcome.results[0].result.reason, "skipped");
  assert.equal(alreadyBuffed.getObject("peak-guardian").buffs, 1);
});

test("ogn-223-298 Peak Guardian golden: the peer buff hits every locked friendly unit at the same location", () => {
  const kernel = world()
    .unit("peak-guardian", { might: 5, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("ally-here", { might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("ally-buffed", {
      might: 2,
      buffs: 1,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .unit("ally-elsewhere", { might: 2, location: { type: "base", player: "A" } })
    .unit("enemy-here", { owner: "B", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("peak-guardian") });
  kernel.setTargets(OTHERS_ID, []);
  kernel.setTargets("other-friendlies-here", [
    kernel.ref("ally-here"),
    kernel.ref("ally-buffed")
  ]);

  const [, buffOthers] = bodyForExecution();
  const outcome = runAbilityBody([buffOthers], kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  // 702.3.a: only the un-Buffed peer gains the counter; the already-Buffed peer
  // is a legal choice that simply is not Buffed again.
  assert.equal(outcome.results[0].result.linkedValues.buffedCount, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.buffed, [
    { id: "ally-here", zoneEntryId: 1 }
  ]);
  assert.equal(kernel.getObject("ally-here").buffs, 1);
  assert.equal(kernel.getObject("ally-buffed").buffs, 1);
  assert.equal(kernel.getObject("ally-elsewhere").buffs, 0);
  assert.equal(kernel.getObject("enemy-here").buffs, 0);
});

test("ogn-223-298 Peak Guardian: peers that left the same location before resolution are ignored (CR 359.3.e.7)", () => {
  const kernel = world()
    .unit("peak-guardian", { might: 5, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("ally-here", { might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("peak-guardian") });
  const stale = kernel.ref("ally-here");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("other-friendlies-here", [stale]);

  const [, buffOthers] = bodyForExecution();
  const outcome = runAbilityBody([buffOthers], kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
});

test.todo(
  "ogn-223-298 Peak Guardian: production target translation must consume the merged " +
    "object: self plus the sameLocationAs/exclude anchors together with " +
    "TargetSpec.location: battlefield so the peer set is empty when the source is at a base"
);
