// RIFT-687 template-level golden for the `triggered|object-moved|continuous.might`
// group (packages/card-dsl/src/cards/README.md 4.1).
//
// The three cards below share one IR signature — one `triggered` ability on the
// `object-moved` timing point whose body is a `continuous.might` instruction —
// but differ in the move's origin/destination clause and in who receives the
// Might. Each card gets its own parameter row: canonical identity, the card's own
// board, its own Move operation and its own printed expectation.
//
//   Back-Alley Bar  ogn-277-298  "When a unit moves from here, give it +1 [M] this turn."
//   Harpoon Squad   sfd-137-221  "When I move from a battlefield, give me +2 [M] this turn."
//   Ribbon Dancer   sfd-038-221  "When I move to a battlefield, give another friendly unit +1 [M] this turn."
//
// Method:
// - `rows` runs each card's whole-card scenario through the real runCardScenario
//   path (ProgramBinding -> ChainEngine -> EventPipeline -> layers). The printed
//   outcome cannot happen today, so each row is a node:test TODO whose reason is
//   the measured gap; the row also binds the card's trigger through the real
//   ProgramBinding first, pinning the exact production rejection, and runs its
//   supported half through merged production code (`resolveChainBody` on the
//   card's own body).
// - The scenario harness refuses judge-required programs by design, so the
//   scenario rows use a metadata-only `executable` view. Every ability, target,
//   filter and sourceText stays intact; nothing here promotes a program.
import assert from "node:assert/strict";
import test from "node:test";

import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createProgramBinding, translateTriggerFilter } from "../../../../engine-core/dist/programs/index.js";
import backAlleyBar from "../../../dist/cards/ogn/back-alley-bar.js";
import harpoonSquad from "../../../dist/cards/sfd/harpoon-squad.js";
import ribbonDancer from "../../../dist/cards/sfd/ribbon-dancer.js";

const here = { type: "battlefield", id: "bf-1" };
const baseA = { type: "base", player: "A" };

/** The scenario harness refuses judge-required programs by design. */
const executableView = program => ({ ...program, status: "executable", judgeReason: undefined });

const barView = executableView(backAlleyBar);
const harpoonView = executableView(harpoonSquad);
const dancerView = executableView(ribbonDancer);

const barId = backAlleyBar.canonicalCardId;
const harpoonId = harpoonSquad.canonicalCardId;
const dancerId = ribbonDancer.canonicalCardId;

/** A complete Move emission as events/action-adapter.ts publishes it. */
function moveEmission(id, { types = ["unit"], details, fromZone, toZone } = {}) {
  return {
    timingPoint: "object-moved",
    kind: "object-moved",
    player: "A",
    ...(fromZone === undefined ? {} : { fromZone }),
    ...(toZone === undefined ? {} : { toZone }),
    ...(details === undefined ? {} : { details }),
    object: {
      ref: { id, zoneEntryId: 1 },
      cardId: "card:" + id,
      name: id,
      types,
      tags: [],
      keywords: [],
      owner: "A",
      controller: "A",
      zone: "board",
      location: here,
      might: 4,
      energy: 0,
      power: [],
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: false,
    },
  };
}

const registrations = kernel => kernel.continuousEffects.map((entry, index) => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: index + 1,
}));

/**
 * The reference kernel compares player selectors literally, while the merged
 * binding normalizes the card's relative `controller` spelling to the ability
 * controller before the chain sees it (programs/filters.ts translateObjectFilter
 * -> normalizePlayer, chain/engine.ts query wrapper). This proxy reproduces
 * exactly that one normalization for the card's own body query and nothing else.
 */
function relativeControllerContext(kernel, controller) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return filter => target.query(
          filter.controller === "controller" || filter.controller === "self"
            ? { ...filter, controller }
            : filter,
        );
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Bind one card's ability through the real CardProgram binding. The published
 * program must fail closed and register no trigger at all.
 */
function bindProductionTrigger(program) {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world().player("A").player("B").unit("host", { owner: "A", controller: "A", might: 4 }).build();
  const pipeline = new EventPipeline({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    execute: action => ({ outcome: kernel.perform(action), emissions: [] }),
    context: () => kernel,
    choose: () => { throw new Error("unexpected choice during trigger registration"); },
  }, ["A", "B"], "A");
  const source = { ...kernel.getObject("host"), cardId: program.canonicalCardId };
  let error;
  try {
    binding.registerProgramTriggers({ pipeline }, source);
  } catch (caught) {
    error = caught;
  }
  return { error, pipeline };
}

function expectProductionRejection(cardName, program) {
  const { error, pipeline } = bindProductionTrigger(program);
  assert.ok(error, `${cardName} trigger registration must fail closed`);
  assert.equal(pipeline.triggers.size, 0, `${cardName} must register no trigger`);
  return error;
}

// ---------------------------------------------------------------------------
// One row per card: that card's own board, its own Move operation, its own
// printed expectation, and its own supported-part execution.
// ---------------------------------------------------------------------------
const rows = [
  {
    name: "Back-Alley Bar · a unit moving from here gains +1 Might this turn",
    canonicalCardId: barId,
    program: barView,
    // 355.10.c: the printed text names the moved unit only inside the trigger
    // condition, so it is not a target choice. The answer below covers only the
    // program's structural stand-in target.
    scenario: {
      objects: [
        { id: "bar", cardId: barId, program: barView, types: ["battlefield"], zone: "board", location: here, might: null, energy: null, power: null },
        { id: "mover", owner: "A", types: ["unit"], zone: "board", location: here, might: 3 },
      ],
      answers: { "target:back-alley-bar.moved-unit": ["mover"] },
      operations: [
        { type: "trigger", timingPoint: "object-moved", object: "mover", player: "A" },
      ],
      expect: {
        objects: {
          // A Battlefield prints no energy/power; those stay null, never 0.
          bar: { zone: "board", energy: null, power: null },
          // The printed outcome: "give it +1 :rb_might: this turn".
          mover: { zone: "board", location: here, might: 4, buffs: 0 },
        },
        events: { includes: [{ timingPoint: "object-moved", object: { ref: "mover" } }] },
      },
    },
    todo:
      "RIFT-687 Back-Alley Bar stays judge-required (the RIFT-687 template layer is its execution evidence): " +
      "the closed EVENT_PATTERN_TYPES vocabulary has no object-moved, so registerProgramTriggers throws " +
      "TriggerSpecValidationError (trigger.filter.event invalid-event-type) and the pipeline registers 0 triggers; " +
      "the real move-location emission also carries no fromKind/fromLocationId (nor fromZone), so \"a unit moves " +
      "from here\" (449.1) cannot be compared with the host Battlefield; and the frozen ObjectSelector has no " +
      "trigger-payload form for \"it\" (355.10.c). Needs the object-moved trigger wiring, the movement origin " +
      "payload and a payload object selector.",
    supported: {
      makeWorld: () => world()
        .unit("mover", { owner: "A", controller: "A", might: 3 })
        .unit("bystander", { owner: "A", controller: "A", might: 5 })
        .build(),
      recipient: "mover",
      bind: (kernel, bound) => bound.setTargets("back-alley-bar.moved-unit", [kernel.ref("mover")]),
      affected: "mover",
      affectedMight: 4,
      others: { bystander: 5 },
      expired: { mover: 3, bystander: 5 },
      makeBare: () => world().unit("mover", { owner: "A", controller: "A", might: 3 }).build(),
    },
  },
  {
    name: "Harpoon Squad · moving from a battlefield gives me +2 Might this turn",
    canonicalCardId: harpoonId,
    program: harpoonView,
    scenario: {
      objects: [
        { id: "harpoon", cardId: harpoonId, program: harpoonView, types: ["unit"], zone: "board", location: here, might: 4 },
        { id: "other", owner: "A", types: ["unit"], zone: "board", location: here, might: 4 },
      ],
      operations: [
        { type: "trigger", timingPoint: "object-moved", object: "harpoon", player: "A" },
      ],
      expect: {
        objects: {
          harpoon: { zone: "board", might: 6, buffs: 0 },
          other: { zone: "board", might: 4 },
        },
        events: { includes: [{ timingPoint: "object-moved", object: { ref: "harpoon" } }] },
      },
    },
    todo:
      "RIFT-687 Harpoon Squad stays judge-required (the RIFT-687 template layer is its execution evidence): " +
      "object-moved is missing from the closed EVENT_PATTERN_TYPES vocabulary (registerProgramTriggers throws " +
      "TriggerSpecValidationError, trigger.filter.event invalid-event-type) and the real move-location emission " +
      "never fills fromZone/toZone (those fields are written only on the zone-enters/leaves branch of the action " +
      "adapter), so \"from a battlefield\" (449.1/449.2) and the 458.1 Recall exclusion cannot be decided by the " +
      "emitted event. The +2 Might body itself already executes.",
    supported: {
      makeWorld: () => world()
        .unit("harpoon", { owner: "A", controller: "A", might: 4 })
        .unit("other", { owner: "A", controller: "A", might: 4 })
        .build(),
      recipient: "harpoon",
      affected: "harpoon",
      affectedMight: 6,
      others: { other: 4 },
      expired: { harpoon: 4, other: 4 },
      makeBare: () => {
        const kernel = world().unit("harpoon", { owner: "A", controller: "A", might: 4 }).build();
        const ref = kernel.ref("harpoon");
        const snapshot = kernel.getObject("harpoon");
        assert.equal(kernel.perform({ type: "kill", object: ref }).status, "done");
        return kernel.clone({ source: ref, sourceSnapshot: snapshot });
      },
      bareCloned: true,
    },
  },
  {
    name: "Ribbon Dancer · moving to a battlefield gives another friendly unit +1 Might this turn",
    canonicalCardId: dancerId,
    program: dancerView,
    scenario: {
      objects: [
        { id: "dancer", cardId: dancerId, program: dancerView, types: ["unit"], zone: "board", location: baseA, might: 3 },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: here, might: 2 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: here, might: 5 },
      ],
      answers: { "target:ribbon-dancer.other-friendly-unit": ["ally"] },
      operations: [
        { type: "trigger", timingPoint: "object-moved", object: "dancer", player: "A" },
      ],
      expect: {
        objects: {
          // "another" never includes the source itself.
          dancer: { zone: "board", might: 3 },
          ally: { zone: "board", might: 3, buffs: 0 },
          enemy: { zone: "board", might: 5 },
        },
        events: { includes: [{ timingPoint: "object-moved", object: { ref: "dancer" } }] },
      },
    },
    todo:
      "RIFT-687 Ribbon Dancer stays judge-required (the RIFT-687 template layer is its execution evidence): " +
      "programs/filters.ts rejects the body target's exclude:source anchor (\"another friendly unit\", " +
      "355.9.b/359.3.e.5) with ProgramBindingError (Unsupported filter field exclude) before the trigger filter is " +
      "even translated, object-moved is missing from the closed EVENT_PATTERN_TYPES vocabulary, and the real " +
      "move-location emission carries no toZone/toKind for \"to a battlefield\" (449.1/449.2, 458.1). The " +
      "temporary +1 Might body itself already executes on an explicitly bound target.",
    supported: {
      makeWorld: () => world()
        .unit("dancer", { owner: "A", controller: "A", might: 3 })
        .unit("ally", { owner: "A", controller: "A", might: 2 })
        .unit("enemy", { owner: "B", controller: "B", might: 5 })
        .build(),
      recipient: "dancer",
      bind: (kernel, bound) => bound.setTargets("ribbon-dancer.other-friendly-unit", [kernel.ref("ally")]),
      relativeController: "A",
      affected: "ally",
      affectedMight: 3,
      others: { dancer: 3, enemy: 5 },
      expired: { dancer: 3, ally: 2, enemy: 5 },
      makeBare: () => world()
        .unit("dancer", { owner: "A", controller: "A", might: 3 })
        .unit("enemy", { owner: "B", controller: "B", might: 5 })
        .build(),
    },
  },
];

// ---------------------------------------------------------------------------
// Boundary group: printed cases that must NOT fire. Each row passes with the
// rule-correct "no change" outcome and pins the declared filter's behaviour.
// ---------------------------------------------------------------------------
const boundaryRows = [
  {
    name: "boundary (not a unit) · Back-Alley Bar ignores a gear that moves from here",
    canonicalCardId: barId,
    program: barView,
    scenario: {
      objects: [
        { id: "bar", cardId: barId, program: barView, types: ["battlefield"], zone: "board", location: here, might: null, energy: null, power: null },
        { id: "gear", owner: "A", types: ["gear"], zone: "board", location: here, might: 2 },
      ],
      operations: [
        { type: "trigger", timingPoint: "object-moved", object: "gear", player: "A" },
      ],
      expect: {
        objects: { gear: { zone: "board", might: 2 } },
        events: { includes: [{ timingPoint: "object-moved", object: { ref: "gear" } }] },
      },
    },
    verify: () => {
      // "a unit moves from here": the declared filter is a unit plus a literal
      // origin comparison. fromLocationId "self" is the only static spelling
      // available, so a real emission (no payload at all) and a literal
      // battlefield id both fail closed - the measured gap, not a widened rule.
      const declared = translateTriggerFilter(backAlleyBar.abilities[0].trigger.filter, "bar", "object-moved");
      assert.deepEqual(declared, {
        event: "object-moved",
        object: { type: "unit" },
        details: { fromKind: "battlefield", fromLocationId: "self" },
      });
      assert.equal(matchesTriggerEvent(declared, moveEmission("gear", { types: ["gear"] }), "A"), false);
      assert.equal(matchesTriggerEvent(declared, moveEmission("mover"), "A"), false);
      assert.equal(
        matchesTriggerEvent(declared, moveEmission("mover", { details: { fromKind: "battlefield", fromLocationId: "bf-1" } }), "A"),
        false,
      );
      assert.equal(
        matchesTriggerEvent(declared, moveEmission("mover", { details: { fromKind: "battlefield", fromLocationId: "self" } }), "A"),
        true,
        "the declared origin is a literal, so only a literal self payload matches",
      );
    },
  },
  {
    name: "boundary (origin is not a battlefield) · Harpoon Squad ignores a Move starting at Base",
    canonicalCardId: harpoonId,
    program: harpoonView,
    scenario: {
      objects: [
        { id: "harpoon", cardId: harpoonId, program: harpoonView, types: ["unit"], zone: "board", location: baseA, might: 4 },
      ],
      operations: [
        { type: "trigger", timingPoint: "object-moved", object: "harpoon", player: "A" },
      ],
      expect: {
        objects: { harpoon: { zone: "board", might: 4, buffs: 0 } },
        events: { includes: [{ timingPoint: "object-moved", object: { ref: "harpoon" } }] },
      },
    },
    verify: () => {
      const declared = translateTriggerFilter(harpoonSquad.abilities[0].trigger.filter, "harpoon-1", "object-moved");
      assert.deepEqual(declared, { event: "object-moved", object: { objectId: "harpoon-1" }, fromZone: "battlefield" });
      // 449.1/449.2: only a Battlefield origin satisfies "from a battlefield".
      assert.equal(matchesTriggerEvent(declared, moveEmission("harpoon-1", { fromZone: "battlefield" }), "A"), true);
      assert.equal(matchesTriggerEvent(declared, moveEmission("harpoon-1", { fromZone: "base" }), "A"), false);
      // 458/458.1 plus the source anchor: another unit's Move never fires this card.
      assert.equal(matchesTriggerEvent(declared, moveEmission("other", { fromZone: "battlefield" }), "A"), false);
      // Today's production emission carries no fromZone at all, so even a genuine
      // Battlefield Move cannot satisfy the declared filter yet.
      assert.equal(matchesTriggerEvent(declared, moveEmission("harpoon-1"), "A"), false);
    },
  },
  {
    name: "boundary (the host did not move) · Ribbon Dancer ignores another unit's Move",
    canonicalCardId: dancerId,
    program: dancerView,
    scenario: {
      objects: [
        { id: "dancer", cardId: dancerId, program: dancerView, types: ["unit"], zone: "board", location: baseA, might: 3 },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: here, might: 2 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: here, might: 5 },
      ],
      operations: [
        { type: "trigger", timingPoint: "object-moved", object: "enemy", player: "B" },
      ],
      expect: {
        objects: {
          dancer: { zone: "board", might: 3 },
          ally: { zone: "board", might: 2 },
          enemy: { zone: "board", might: 5 },
        },
        events: { includes: [{ timingPoint: "object-moved", object: { ref: "enemy" } }] },
      },
    },
    verify: () => {
      const declared = translateTriggerFilter(ribbonDancer.abilities[0].trigger.filter, "dancer-1", "object-moved");
      assert.deepEqual(declared, { event: "object-moved", object: { objectId: "dancer-1" }, toZone: "battlefield" });
      // 449.2: the destination is what "to a battlefield" tests; the source
      // anchor keeps another unit's Move from firing this card (458/458.1).
      assert.equal(matchesTriggerEvent(declared, moveEmission("dancer-1", { toZone: "battlefield" }), "A"), true);
      assert.equal(matchesTriggerEvent(declared, moveEmission("dancer-1", { toZone: "base" }), "A"), false);
      assert.equal(matchesTriggerEvent(declared, moveEmission("enemy", { toZone: "battlefield" }), "A"), false);
      // The production emission carries no toZone, so the declared filter cannot
      // match a genuine Move onto a battlefield either.
      assert.equal(matchesTriggerEvent(declared, moveEmission("dancer-1"), "A"), false);
    },
  },
];

/**
 * Register each row as its own test. Every row first proves the published program
 * is still judge-required with an explicit reason and the template signature,
 * then binds the trigger through the real CardProgram binding to pin the exact
 * production gap, then runs the row's scenario through the real pipeline.
 * `todo` rows carry the printed rule outcome and are reported pending.
 */
function runSuite(templateName, suiteRows) {
  const cases = defineTemplateSuite(templateName, suiteRows);
  for (const [index, golden] of cases.entries()) {
    const row = suiteRows[index];
    const gap = row.todo
      ?? 'trigger.filter.event: 值必须属于现有 EVENT_PATTERN_TYPES；missing object-moved trigger vocabulary, movement origin/destination payload, and payload-object selector';
    test.todo(`${golden.name} — ${gap}`);
  }
}

runSuite("RIFT-687 triggered|object-moved|continuous.might", rows);
runSuite("RIFT-687 triggered|object-moved|continuous.might boundary", boundaryRows);

// ---------------------------------------------------------------------------
// Supported half of each parameter row: the part that really executes through
// merged production code today, plus that card's own no-legal-recipient
// boundary.
// ---------------------------------------------------------------------------
for (const row of rows) {
  const [ability] = row.program.abilities;
  test(`RIFT-687 ${row.name} [${row.canonicalCardId}]: the merged continuous.might body executes on an eligible recipient and expires at turn-end`, () => {
    const kernel = row.supported.makeWorld();
    const bound = kernel.clone({ source: kernel.ref(row.supported.recipient), sourceSnapshot: kernel.getObject(row.supported.recipient) });
    row.supported.bind?.(kernel, bound);
    const context = row.supported.relativeController === undefined
      ? bound
      : relativeControllerContext(bound, row.supported.relativeController);
    const outcome = resolveChainBody(ability.body, context);

    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.results.map(entry => entry.result.status), ["executed"]);
    // 143.2.a / 478: an arithmetic-layer registration carrying the end-of-turn
    // duration. Never a Buff counter (702-704).
    assert.equal(bound.continuousEffects.length, 1);
    assert.deepEqual(bound.continuousEffects.map(entry => entry.effect.filter.objectId), [row.supported.affected]);
    assert.deepEqual(bound.continuousEffects[0].duration, { type: "end-of-turn" });
    assert.equal(bound.continuousEffects[0].effect.layer, "arithmetic");
    assert.equal(bound.continuousEffects[0].effect.effect.kind, "continuous.might");

    const layers = createLayerEngine(bound.objects, registrations(bound));
    assert.equal(layers.evaluate(kernel.ref(row.supported.affected)).might, row.supported.affectedMight, "affected Might");
    assert.equal(layers.evaluate(kernel.ref(row.supported.affected)).buffs, 0, "affected Buff counters");
    for (const [id, might] of Object.entries(row.supported.others)) {
      assert.equal(layers.evaluate(kernel.ref(id)).might, might, `${id}: unaffected Might`);
      assert.equal(layers.evaluate(kernel.ref(id)).buffs, 0, `${id}: unaffected Buff counters`);
    }
    // 317.1.a / 468.7.c: the Might modification expires at end of turn.
    assert.equal(layers.expireAt("turn-end").length, 1);
    for (const [id, might] of Object.entries(row.supported.expired)) {
      assert.equal(layers.evaluate(kernel.ref(id)).might, might, `${id}: after turn-end`);
    }
  });

  test(`RIFT-687 ${row.name} [${row.canonicalCardId}]: no eligible recipient negates the body`, () => {
    const bare = row.supported.makeBare();
    const bound = row.supported.bareCloned
      ? bare
      : bare.clone({ source: bare.ref(row.supported.recipient), sourceSnapshot: bare.getObject(row.supported.recipient) });
    const context = row.supported.relativeController === undefined
      ? bound
      : relativeControllerContext(bound, row.supported.relativeController);
    const outcome = resolveChainBody(ability.body, context);
    assert.equal(outcome.status, "partial");
    assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
    assert.deepEqual(bound.continuousEffects, []);
  });
}

// ---------------------------------------------------------------------------
// Card-specific boundaries that do not fit the shared parameter row.
// ---------------------------------------------------------------------------
test(`RIFT-687 Back-Alley Bar [${barId}]: production registration fails closed on the missing object-moved vocabulary`, () => {
  const error = expectProductionRejection("Back-Alley Bar", barView);
  assert.equal(error.name, "TriggerSpecValidationError");
  assert.deepEqual(
    error.issues.map(issue => [issue.path, issue.code]),
    [["trigger.filter.event", "invalid-event-type"]],
  );
});

test.todo(`RIFT-687 Back-Alley Bar [${barId}]: the Battlefield keeps its unprinted energy/power as null through the scenario harness — trigger.filter.event: object-moved is outside EVENT_PATTERN_TYPES; missing object-moved registration before scenario construction`);

test(`RIFT-687 Back-Alley Bar [${barId}]: a stand-in recipient that already left the Board is ignored (359.3.e.6)`, () => {
  const kernel = world().unit("mover", { owner: "A", controller: "A", might: 3 }).build();
  const staleRef = kernel.ref("mover");
  const staleSnapshot = kernel.getObject("mover");
  assert.equal(kernel.perform({ type: "kill", object: staleRef }).status, "done");
  const bound = kernel.clone({ source: staleRef, sourceSnapshot: staleSnapshot });
  bound.setTargets("back-alley-bar.moved-unit", [staleRef]);
  const outcome = resolveChainBody(backAlleyBar.abilities[0].body, bound);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(bound.continuousEffects, []);
});

test(`RIFT-687 Harpoon Squad [${harpoonId}]: production registration fails closed on the missing object-moved vocabulary`, () => {
  const error = expectProductionRejection("Harpoon Squad", harpoonView);
  assert.equal(error.name, "TriggerSpecValidationError");
  assert.deepEqual(
    error.issues.map(issue => [issue.path, issue.code]),
    [["trigger.filter.event", "invalid-event-type"]],
  );
});

test(`RIFT-687 Ribbon Dancer [${dancerId}]: production registration is rejected at the body target's exclude anchor`, () => {
  const error = expectProductionRejection("Ribbon Dancer", dancerView);
  assert.ok(error instanceof ProgramBindingError, String(error));
  assert.equal(error.code, "judge-required");
  assert.match(error.message, /Unsupported filter field exclude/);
});

test(`RIFT-687 Ribbon Dancer [${dancerId}]: the source itself is never a legal "another friendly unit" (355.9.b/359.3.e.5)`, () => {
  // The declaration already excludes the source: on a board whose only friendly
  // unit IS the source, the stand-in target has no legal member and the body
  // grants nothing. This is the target-pipeline half of the print; the missing
  // production translation of exclude:"source" is pinned above.
  const kernel = world()
    .unit("dancer", { owner: "A", controller: "A", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 5 })
    .build();
  const bound = kernel.clone({ source: kernel.ref("dancer"), sourceSnapshot: kernel.getObject("dancer") });
  bound.setTargets("ribbon-dancer.other-friendly-unit", [kernel.ref("dancer")]);
  const outcome = resolveChainBody(ribbonDancer.abilities[0].body, relativeControllerContext(bound, "A"));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(bound.continuousEffects, []);
  assert.equal(createLayerEngine(bound.objects, []).evaluate(kernel.ref("dancer")).might, 3);
});
