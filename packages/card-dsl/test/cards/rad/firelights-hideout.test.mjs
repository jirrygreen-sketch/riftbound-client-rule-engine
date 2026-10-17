
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/firelights-hideout.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import grant from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL =
  "card.hash-b0fa1aa611f78286913c3002834a073dcdd58ad0678ff45714b3accf84b68c72";
const SOURCE_TEXT =
  "When you conquer here, the next unit you play this turn has [Accelerate]. " +
  "(You may pay :rb_energy_1: and a Power of its Domain as an additional cost to have it enter ready.)";

const [ability] = program.abilities;
const [grantInstruction] = ability.body;

function unit(id, values = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: "card:" + id,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...values
  };
}

test("rad-162-167 Firelights' Hideout: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("rad-162-167 Firelights' Hideout: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /one-shot/);
  assert.match(program.judgeReason, /RIFT-257/);
  // The merged grant op must not be described as unregistered.
  assert.doesNotMatch(program.judgeReason, /effects\/instructions\/ 没有该 op 的文件/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-162-167 Firelights' Hideout: conquer trigger at the 'here' battlefield for its controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "conquer");
  // 053.3 "here" + 190.6.d "you": the sibling battlefield programs keep the
  // same placeholder spelling while the card-program trigger registration is
  // unmerged. The engine's own trigger-spec validator rejects it today.
  assert.deepEqual(ability.trigger.filter, {
    event: "conquer",
    here: true,
    player: "controller"
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);
  assert.throws(
    () => assertTriggerSpec(ability.trigger),
    /here/,
    "the engine trigger validator does not accept the placeholder spelling yet"
  );
});

test("rad-162-167 Firelights' Hideout: the grant names Accelerate, this turn and the next unit", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "firelights-hideout.grant-accelerate"
  ]);
  assert.equal(grantInstruction.op, "continuous.grant-keyword");
  assert.deepEqual(grantInstruction.args.keyword, { kind: "constant", value: "Accelerate" });
  // The printed grant lasts for this turn (Duration end-of-turn vocabulary);
  // the one-shot "next unit" window itself has no IR shape (judgeReason).
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantInstruction.args.appliesTo, {
    kind: "constant",
    value: { target: "firelights-hideout.next-unit" }
  });

  assert.equal(grantInstruction.targets.length, 1);
  const [target] = grantInstruction.targets;
  assert.equal(target.id, "firelights-hideout.next-unit");
  // 805.1.a: Accelerate is present on Units; "you" is the controller. The
  // "next" quantifier is not expressible, so min stays 0 — the shape must not
  // invent a target that does not exist when the ability finalizes.
  assert.deepEqual(target.filter, { type: "unit", controller: "controller" });
  assert.equal(target.min, 0);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "up-to");
});

test("rad-162-167 Firelights' Hideout: the card never declares Accelerate on the Battlefield", () => {
  // 805.1.a: Accelerate is a Unit keyword. The Battlefield grants it to a later
  // unit; declaring it as its own keyword ability would change what the card
  // says (and would make the battlefield itself look like a unit).
  assert.equal(
    program.abilities.some(value => value.kind === "keyword"),
    false
  );
  assert.equal(grantInstruction.args.keyword.value, "Accelerate");
});

test("rad-162-167 Firelights' Hideout golden: the declared grant really installs [Accelerate] through the merged layers", () => {
  // The granted unit is the one the ability's target lock supplies (a unit the
  // controller plays later this turn); the card's own instruction is executed.
  const kernel = world().unit("later-unit", { might: 3 }).build();
  const scoped = kernel.clone({
    source: kernel.ref("later-unit"),
    sourceSnapshot: kernel.getObject("later-unit")
  });
  const run = runInstruction(
    grant,
    {
      keyword: grantInstruction.args.keyword,
      duration: grantInstruction.args.duration,
      appliesTo: { kind: "constant", value: "self" }
    },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");

  const engine = createLayerEngine(
    scoped.query({}),
    scoped.snapshot().continuous.map(entry => ({ effect: entry.effect, duration: entry.duration }))
  );
  const granted = engine.evaluate(kernel.ref("later-unit")).keywords;
  assert.equal(granted.length, 1);
  assert.equal(granted[0].id, "Accelerate");
  // CR 317.2.c: "this turn" is carried as the end-of-turn duration.
  assert.deepEqual(scoped.snapshot().continuous.map(entry => entry.duration), [
    { type: "end-of-turn" }
  ]);
});

test("rad-162-167 Firelights' Hideout golden: the granted Accelerate cost is the +1 power optional additional cost", () => {
  // 805.1.b / 805.2: paying the granted Accelerate cost is what makes the unit
  // enter ready. The merged Accelerate keyword definition is the single source
  // of that cost (effects/keywords/Accelerate.ts), so the golden test asserts
  // that the merged definition still declares exactly the printed optional
  // cost instead of re-implementing it here.
  const single = { canonicalCardId: "unittest-accelerate" };
  return import("../../../../engine-core/dist/effects/keywords/Accelerate.js").then(({ default: accelerate }) => {
    assert.equal(accelerate.keyword, "Accelerate");
    assert.equal(accelerate.valued, false);
    assert.equal(accelerate.stacking, "single");
    const expanded = accelerate.expand({ host: single });
    const cost = expanded[0].effect.cost;
    assert.equal(cost.kind, "additional-cost");
    assert.equal(cost.optional, true);
    assert.equal(cost.payments[0].kind, "energy");
    assert.deepEqual(cost.payments[0].amount, { kind: "constant", value: 1 });
    assert.equal(cost.payments[1].kind, "power");
    assert.deepEqual(cost.payments[1].amount, { kind: "constant", value: 1 });
  });
});

test("rad-162-167 Firelights' Hideout golden: the conquer timing point really exists in the merged pipeline", () => {
  // The scoring task emits conquer (383.4.c); the card side simply has no
  // registration path yet. Proving the timing point exists keeps the recorded
  // gap precise.
  const kernel = world().unit("here", { types: ["battlefield"], location: { type: "battlefield", id: "bf-1" } }).build();
  const decide = () => {
    throw new Error("unexpected choice");
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  pipeline.emit({ timingPoint: "conquer", player: "A", object: kernel.getObject("here") });
  assert.equal(pipeline.events.some(event => event.timingPoint === "conquer"), true);
});

test.todo(
  "rad-162-167 Firelights' Hideout: install the granted [Accelerate] on the next unit the " +
    "controller plays this turn, assert the 1-energy-plus-Domain-power optional cost is offered " +
    "at that play and that entering ready follows payment (805.1.b/805.2/805.2.b) — needs the " +
    "CardProgram continuous-effect registration and the one-shot next-unit window (RIFT-257)"
);
test.todo(
  "rad-162-167 Firelights' Hideout: subscribe the conquer trigger and resolve it for the " +
    "Battlefield's controller (383.4.c.2.b, 190.6.d) — needs the CardProgram TriggerRegistration and " +
    "the accepted 053.3 here-referent spelling (RIFT-257)"
);

