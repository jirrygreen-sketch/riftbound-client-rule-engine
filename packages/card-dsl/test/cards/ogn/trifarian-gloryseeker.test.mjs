import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/trifarian-gloryseeker.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));

const BUFF_ID = "trifarian-gloryseeker.buff-me";

const bodyForExecution = () => program.abilities[1].body;

test("ogn-217-298 Trifarian Gloryseeker: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-0e5542d49264324b5497b244de3b3ad36381c763af055108066e1b17f7fb2aa7"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Legion/);
  assert.match(program.judgeReason, /effect\.buff/);
  assert.match(program.judgeReason, /condition\.history/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.equal(
    program.sourceText,
    "[Legion] — When you play me, buff me. (If I don't have a buff, I get a +1 :rb_might: buff. " +
      "Get the effect if you've played another card this turn.)"
  );
});

test("ogn-217-298 Trifarian Gloryseeker: Legion keyword plus the gated card-played buff", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "legion");
  assert.equal(keyword.value, undefined);

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { event: "card-played", filter: { source: "self" } });
  // CR 812.1.b.1 / 812.1.c: the dependent ability is active only when another,
  // different card has been finalized by you this turn.
  assert.equal(triggered.trigger.condition.kind, "compare");
  assert.equal(triggered.trigger.condition.operator, "gte");
  assert.deepEqual(triggered.trigger.condition.right, { kind: "constant", value: 1 });
  assert.equal(triggered.trigger.condition.left.kind, "count");
  assert.equal(triggered.trigger.condition.left.subject, "cards-finalized-this-turn");
  assert.deepEqual(triggered.trigger.condition.left.filter, {
    player: "controller",
    exclude: "self"
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);

  assert.equal(triggered.body.length, 1);
  const [buff] = triggered.body;
  assert.equal(buff.id, BUFF_ID);
  assert.equal(buff.op, "effect.buff");
  assert.deepEqual(buff.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buff.args.target, { kind: "constant", value: "self-unit" });
  assert.deepEqual(buff.targets[0].filter, {
    object: "self",
    type: "unit",
    zone: "board"
  });
  assert.equal(buff.targets[0].min, 1);
  assert.equal(buff.targets[0].max, 1);
  assert.equal(buff.targets[0].selection, "one");
  assert.equal(buff.linkedTo, undefined);
  assert.equal(buff.condition, undefined);
});

test("ogn-217-298 Trifarian Gloryseeker golden: 'buff me' places one Buff on the source", () => {
  const base = world()
    .unit("gloryseeker", { might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("gloryseeker") });
  kernel.setTargets("self-unit", [kernel.ref("gloryseeker")]);

  const outcome = runAbilityBody(bodyForExecution(), kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // 702.2.a / 703: the Buff contributes +1 Might while it remains on the unit.
  assert.equal(kernel.getObject("gloryseeker").buffs, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.buffed, [
    { id: "gloryseeker", zoneEntryId: 1 }
  ]);
});

test("ogn-217-298 Trifarian Gloryseeker: a unit that already has a Buff is not Buffed again (CR 702.3.a)", () => {
  const base = world()
    .unit("gloryseeker", {
      might: 2,
      buffs: 1,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("gloryseeker") });
  kernel.setTargets("self-unit", [kernel.ref("gloryseeker")]);

  const outcome = runAbilityBody(bodyForExecution(), kernel);
  // 427.1.c: the unit is still a legal choice for a Buff action; it simply does
  // not receive a second counter.
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("gloryseeker").buffs, 1);
});

test("Trifarian Gloryseeker: the merged keyword expansion declares the Legion history predicate", async () => {
  const { expandProgram, translateTriggerFilter } = await import("../../../../engine-core/dist/programs/index.js");
  const kernel = world().unit("gloryseeker", { cardId: program.canonicalCardId }).build();
  const expanded = expandProgram(program, kernel.getObject("gloryseeker"));
  assert.equal(expanded.expanded.length, 1);
  assert.equal(expanded.expanded[0].effect.kind, "condition.predicate");
  assert.equal(expanded.expanded[0].effect.history.scope, "turn");
  assert.equal(expanded.expanded[0].effect.history.action, "play");
  assert.deepEqual(translateTriggerFilter(program.abilities[1].trigger.filter, "gloryseeker", "card-played"), {
    event: "card-played", object: { objectId: "gloryseeker" }
  });
});

test("Trifarian Gloryseeker: contract history excludes this object but counts another copy of the same card", () => {
  const base = world()
    .hand("gloryseeker", { cardId: program.canonicalCardId, types: ["unit"], energy: null, power: null })
    .hand("another-gloryseeker", { cardId: program.canonicalCardId, types: ["unit"], energy: null, power: null })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("gloryseeker") });
  // Exercise the supported history instruction, not the still-unbound Legion
  // static predicate. "Another card" distinguishes objects, not card identities.
  const history = [{
    id: "legion-history",
    op: "condition.history",
    args: { query: { kind: "constant", value: {
      scope: "turn", action: "play", player: kernel.controller, exclude: "self"
    } } }
  }];
  assert.equal(kernel.perform({ type: "play", object: kernel.ref("gloryseeker"), player: kernel.controller }).status, "done");
  assert.equal(runAbilityBody(history, kernel).linkedValues["legion-history.count"], 0);

  assert.equal(kernel.perform({ type: "play", object: kernel.ref("another-gloryseeker"), player: kernel.controller }).status, "done");
  const outcome = runAbilityBody(history, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["legion-history.count"], 1);
  assert.equal(kernel.getObject("gloryseeker").cardId, kernel.getObject("another-gloryseeker").cardId);

  assert.equal(kernel.perform({ type: "return-to-hand", object: kernel.ref("gloryseeker") }).status, "done");
  assert.equal(kernel.perform({ type: "play", object: kernel.ref("gloryseeker"), player: kernel.controller }).status, "done");
  assert.equal(runAbilityBody(history, kernel).linkedValues["legion-history.count"], 1);
});

test.todo("Trifarian Gloryseeker: evaluate Legion's another-card-Finalized-this-turn history at trigger time and consume condition.predicate (CR 812.1.b.1 / 812.1.c; RIFT-359)");
test.todo("Trifarian Gloryseeker: bind non-target Buff-self without a TargetSpec or became-target event (CR 355.10.d.1 / 702.2.a; effect.buff selector contract)");
