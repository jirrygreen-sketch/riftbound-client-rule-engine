import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/star-spring.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-947f958ba5d9376078dbb3ffcb143e3e833bc4d2ed24f6d6bb472e1c5d8f256b";
const SOURCE_TEXT =
  "The first time a player plays a non-token unit here each turn, they may move another unit they control here to its base.";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const [ability] = program.abilities;
const [choice] = ability.body;
const [move] = choice.args.body.value;
const targetSpec = choice.targets[0];

const OPTIONAL_ID = "star-spring.opt-in/optional";
const TARGET_ID = "star-spring.unit-here";

test("unl-215-219 Star Spring: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-215-219 Star Spring: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-215-219 Star Spring: judgeReason names the event-player and per-player frequency gaps", () => {
  assert.match(program.judgeReason, /event-player/);
  assert.match(program.judgeReason, /per-player/);
  assert.match(program.judgeReason, /TriggerSpec\.once/);
  assert.match(program.judgeReason, /载荷|card-played/);
});

test("unl-215-219 Star Spring: first-play-per-turn trigger for a non-token unit played here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a.4: an ability that triggers when another object is played is not a
  // Play Effect; the event object is the unit that was played.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: { type: "unit" },
    here: true,
    nonToken: true
  });
  // 383.1.b's printed frequency is recorded, but the merged once scopes are
  // keyed to one registration + source, not per event player (judgeReason).
  assert.equal(ability.trigger.once, "per-turn");
  assert.equal(ability.trigger.condition, undefined);
  // 383.3.a: "they may" is the first part of the effect, so the decision is
  // recorded on the ability (as the sibling battlefield ruined-monastery
  // does) and realised by the §3.9 wrapper below.
  assert.equal(ability.optional, true);
});

test("unl-215-219 Star Spring: contract 3.9 optional wrapper holds the printed Move to the unit's base", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["star-spring.opt-in"]);
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.prompt, {
    kind: "constant",
    value: "Move another unit you control here to its base?"
  });
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), [
    "star-spring.move-to-base"
  ]);

  // 448.1 / 449.2 / 451: this is an effect Move to the moved unit's own Base
  // ("its base"), not a Recall (457), so the merged move primitive's
  // controller-base destination is used.
  assert.equal(move.op, "effect.move");
  assert.deepEqual(move.args.objects, {
    kind: "constant",
    value: { target: "star-spring.unit-here" }
  });
  assert.deepEqual(move.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(move.args.linkKey, { kind: "constant", value: "movedUnit" });
  assert.equal(move.linkedTo, undefined);

  // 355.9.a.1 / 355.10 / 355.12: "another unit they control here" is one
  // chosen unit locked with the may action — "here" (053.3), the "another"
  // exclusion and the event player's ownership are recorded on the filter; the
  // last one uses a documented placeholder for the missing event-player
  // selector (never the Battlefield's controller). The TargetSpec sits on the
  // optional wrapper (the merged salvage / guardian-of-the-passage spelling).
  assert.equal(move.targets, undefined);
  assert.equal(choice.targets.length, 1);
  assert.equal(targetSpec.id, "star-spring.unit-here");
  assert.deepEqual(targetSpec.filter, {
    type: "unit",
    location: "battlefield",
    sameLocationAs: "self",
    other: true,
    controller: "event-player"
  });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
  assert.equal(move.picks, undefined);
});

/** A world with the Battlefield as the ability source plus the units around it. */
function starSpringWorld() {
  const base = world()
    .battlefield("star-spring", { types: ["battlefield"], location: BATTLEFIELD })
    .unit("just-played", { owner: "B", controller: "B", location: BATTLEFIELD })
    .unit("other-unit", { owner: "A", controller: "A", location: BATTLEFIELD })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("star-spring") });
}

test("unl-215-219 Star Spring: the printed filter cannot bind 'they' (no event player is invented)", () => {
  const kernel = starSpringWorld();
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  const outcome = resolveChainBody(ability.body, kernel);

  // The "they control" placeholder matches no object, so the 355.12 may-action
  // target cannot be locked (min 1) and the whole optional node is ignored
  // (359.3.e.5/359.3.e.12) rather than silently moving a unit that belongs to
  // the wrong player. No inner instruction runs and no event is committed.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["star-spring.opt-in", "ignored"]
  ]);
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.deepEqual(kernel.getObject("other-unit").location, BATTLEFIELD);
  assert.deepEqual(kernel.getObject("just-played").location, BATTLEFIELD);
  assert.deepEqual(outcome.events, []);
});

/**
 * Bind only what the judgeReason names as missing (the event player) and what
 * the reference kernel's matcher can evaluate. The declared filter keeps the
 * printed scope (location/sameLocationAs/other, asserted above); the kernel's
 * matchesFilter does not implement those anchors or a "battlefield" spelling
 * for `location`, so the executed scenario states the substituted subset
 * instead of pretending the anchors ran.
 */
function bodyForEventPlayer(player) {
  const { location, sameLocationAs, other, ...evaluable } = targetSpec.filter;
  return [
    {
      ...choice,
      args: {
        ...choice.args,
        body: {
          kind: "constant",
          value: [{ ...move }]
        }
      },
      // 355.12 keeps the may-action's choice on the ability (the TargetSpec of
      // a choice.optional node), not inside the nested Move instruction.
      targets: [
        {
          ...targetSpec,
          filter: { ...evaluable, controller: player }
        }
      ]
    }
  ];
}

test("unl-215-219 Star Spring: accepting moves the chosen unit to its own base (449.2/451)", () => {
  const kernel = starSpringWorld();
  // Finalize locks the chosen unit before the ability resolves (355.9); the
  // reference kernel is handed that locked target directly.
  kernel.setTargets(TARGET_ID, [kernel.ref("other-unit")]);
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  const outcome = resolveChainBody(bodyForEventPlayer("A"), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["star-spring.move-to-base", "executed"],
    ["star-spring.opt-in", "executed"]
  ]);
  // "to its base": the moved unit's own Base (not the Battlefield
  // controller's, and not a Recall).
  assert.deepEqual(kernel.getObject("other-unit").location, { type: "base", player: "A" });
  assert.deepEqual(kernel.getObject("just-played").location, BATTLEFIELD);
  assert.deepEqual(outcome.events.map(event => event.action), ["move-location"]);
  // The interpreter scopes every linked value by its execution path.
  assert.deepEqual(
    outcome.linkedValues["star-spring.opt-in/star-spring.move-to-base.movedUnit"],
    {
    count: 1,
    objects: [kernel.ref("other-unit")],
    movements: [
      {
        object: kernel.ref("other-unit"),
        from: BATTLEFIELD,
        to: { type: "base", player: "A" }
      }
    ]
    }
  );
});

test("unl-215-219 Star Spring: declining the optional moves nothing (403.1)", () => {
  const kernel = starSpringWorld();
  // 355.12: the may-action's target is chosen independently of the decision,
  // so a legal unit is locked (355.8) and the question is still asked.
  kernel.setTargets(TARGET_ID, [kernel.ref("other-unit")]);
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = resolveChainBody(bodyForEventPlayer("A"), kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["star-spring.opt-in", "negated"]
  ]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.getObject("other-unit").location, BATTLEFIELD);
  assert.deepEqual(outcome.events, []);
});

test("unl-215-219 Star Spring: a chosen unit that already left the battlefield is ignored (359.3.e.5)", () => {
  const kernel = starSpringWorld();
  kernel.setAnswers({ [OPTIONAL_ID]: true });
  // The only legal unit left the battlefield before the optional resolved, so
  // the 355.12 target can no longer be locked and the node is ignored.
  kernel.perform({ type: "kill", object: kernel.ref("other-unit") });

  const outcome = resolveChainBody(bodyForEventPlayer("A"), kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["star-spring.opt-in", "ignored"]
  ]);
  assert.equal(kernel.getObject("other-unit").zone, "trash");
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "unl-215-219 Star Spring: bind 'they' to the player who played the unit so the chooser and the " +
    "'unit they control here' restriction come from the event (CR 190.6.c) — no ObjectSelector/Expr " +
    "reads the triggering event's player (contract change request)"
);

test.todo(
  "unl-215-219 Star Spring: gate the trigger to each player's first non-token unit played at this " +
    "Battlefield each turn (383.1.b, 053.3) — TriggerSpec.once scopes are keyed to one registration " +
    "+ source and the card-played payload names no Battlefield (per-player once + play-location " +
    "payload contract change request)"
);

test.todo(
  "unl-215-219 Star Spring: register the program's triggered ability as a TriggerRegistration and " +
    "resolve the optional Move through the production chain (190.6.c choice ownership, 355.12) after the " +
    "event-player and play-location/non-token payload contract is available"
);
