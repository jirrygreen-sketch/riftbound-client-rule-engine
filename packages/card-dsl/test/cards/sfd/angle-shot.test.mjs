import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/angle-shot.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core, so golden execution loads the
// built engine through its workspace layout. `resolveChainBody` is the production
// card-body entry point (chain/engine.ts resolves chain item bodies with it).
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import detach from "../../../../engine-core/dist/effects/instructions/effect.detach.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-0aa655446cb6202a49e06ffc288e4168bfbedf9b8c922547654f678c148c63d4";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a unit and an Equipment with the same controller. Attach that Equipment to that unit " +
  "or detach that Equipment from that unit. Draw 1.";

const [speed, play] = program.abilities;
const [modeChoice, draw] = play.body;
const [unitSpec, equipmentSpec] = modeChoice.targets;
const [attachMode, detachMode] = modeChoice.args.modes.value;
const [attachInstruction] = attachMode.body;
const [detachInstruction] = detachMode.body;

/** A world where B controls a unit with an Equipment attached to it. */
function angleWorld() {
  const kernel = world()
    .deck("a-top", { owner: "A" })
    .unit("host-unit", { owner: "B", controller: "B", might: 3 })
    .build();
  const hostRef = kernel.ref("host-unit");
  kernel.addObject(
    {
      ...kernel.getObject("host-unit"),
      ref: { id: "equipment", zoneEntryId: 1 },
      cardId: "card:sfd-009",
      name: "Serrated Dirk",
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      attachedTo: hostRef
    },
    "board"
  );
  return kernel;
}

test("sfd-011-221 Angle Shot: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-011-221 Angle Shot: judge-required for the unmerged 355.11 same-controller group", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.11/);
  assert.match(program.judgeReason, /group/);
  assert.match(program.judgeReason, /choice\.mode/);
});

test("sfd-011-221 Angle Shot structure: [Reaction], the two collected objects and the two modes", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  assert.deepEqual(play.body.map((instruction) => instruction.id), [
    "angle-shot.mode",
    "angle-shot.draw"
  ]);

  // Both chosen objects are Targets (355.5/355.7, 355.10.a.1) declared on the
  // choice node so they are locked with the spell (355.8); the 355.11 group
  // requirement and its descriptive same-controller relation are recorded.
  assert.equal(modeChoice.op, "choice.mode");
  assert.deepEqual(modeChoice.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(modeChoice.args.different, { kind: "constant", value: true });
  assert.equal(unitSpec.id, "angle-shot.unit");
  assert.deepEqual(unitSpec.filter, { type: "unit", zone: "board" });
  assert.equal(unitSpec.kind, "group");
  assert.equal(unitSpec.group, true);
  assert.equal(unitSpec.sameController, true);
  assert.equal(unitSpec.selection, "one");
  assert.equal(equipmentSpec.id, "angle-shot.equipment");
  assert.deepEqual(equipmentSpec.filter, { type: "gear", tags: "Equipment", zone: "board" });
  assert.equal(equipmentSpec.kind, "group");
  assert.equal(equipmentSpec.group, true);
  assert.equal(equipmentSpec.sameController, true);
  assert.equal(equipmentSpec.selection, "one");
  assert.equal(modeChoice.picks, undefined);

  // The two modes (355.3) each carry one merged primitive: attach (435.1/435.4)
  // and detach (436.1/436.3).
  assert.deepEqual(modeChoice.args.modes.value.map((mode) => mode.id), [
    "angle-shot.attach-mode",
    "angle-shot.detach-mode"
  ]);
  assert.equal(attachInstruction.op, "effect.attach");
  assert.deepEqual(attachInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "angle-shot.equipment" }
  });
  assert.deepEqual(attachInstruction.args.host, {
    kind: "constant",
    value: { kind: "target", id: "angle-shot.unit" }
  });
  assert.equal(attachInstruction.targets, undefined);

  assert.equal(detachInstruction.op, "effect.detach");
  assert.deepEqual(detachInstruction.args.pick, {
    kind: "constant",
    value: "angle-shot.chosen-equipment"
  });
  assert.equal(detachInstruction.picks.length, 1);
  assert.equal(detachInstruction.picks[0].id, "angle-shot.chosen-equipment");

  // "Draw 1." is a separate sentence: unlinked, so it still resolves when a
  // mode is ignored (359.3.e.11 / 359.3.e.14).
  assert.equal(draw.op, "effect.draw");
  assert.equal(draw.linkedTo, undefined);
  assert.deepEqual(draw.args, { amount: { kind: "constant", value: 1 } });
});

test("sfd-011-221 Angle Shot golden: the attach mode attaches the chosen Equipment to the chosen unit", () => {
  const kernel = angleWorld();
  // Start detached so the attach action has something to do (435.1.g/i: an
  // already-attached object would be a no-op).
  assert.equal(kernel.perform({ type: "detach", object: kernel.ref("equipment") }).status, "done");
  assert.equal(kernel.getObject("equipment").attachedTo, null);

  const run = runInstruction(
    attach,
    {
      objects: { kind: "constant", value: { kind: "target", id: equipmentSpec.id } },
      host: { kind: "constant", value: { kind: "target", id: "angle-shot.unit" } }
    },
    {
      world: kernel,
      targets: {
        // The card names the Equipment as `objects` and the unit as `host` in
        // its own args; this runs the same primitive shape with the same locked
        // selections.
        [equipmentSpec.id]: [kernel.ref("equipment")],
        [unitSpec.id]: [kernel.ref("host-unit")]
      }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.attached.count, 1);
  const attachedTo = kernel.getObject("equipment").attachedTo;
  assert.equal(attachedTo.id, "host-unit");
});

test("sfd-011-221 Angle Shot golden: the detach mode detaches the chosen Equipment from its host", () => {
  const kernel = angleWorld();
  const equipmentRef = kernel.ref("equipment");
  const run = runInstruction(
    detach,
    { pick: detachInstruction.args.pick.value },
    { world: kernel, picks: { "angle-shot.chosen-equipment": [equipmentRef] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.detached, 1);
  assert.deepEqual(run.linked.detachedObjects, [{ id: "equipment", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("equipment").attachedTo, null);
  assert.deepEqual(run.events.map((event) => event.action), ["detach"]);
});

test("sfd-011-221 Angle Shot golden: the attach mode attaches the Equipment when it is already on another host", () => {
  // 435.1.f: attaching to a new Top-Most card detaches it from the old one.
  const kernel = world()
    .unit("old-host", { owner: "B", controller: "B", might: 2 })
    .unit("new-host", { owner: "B", controller: "B", might: 3 })
    .build();
  const oldHost = kernel.ref("old-host");
  kernel.addObject(
    {
      ...kernel.getObject("old-host"),
      ref: { id: "equipment", zoneEntryId: 1 },
      cardId: "card:sfd-009",
      name: "Serrated Dirk",
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      attachedTo: oldHost
    },
    "board"
  );
  const run = runInstruction(
    attach,
    {
      objects: { kind: "constant", value: { kind: "target", id: equipmentSpec.id } },
      host: { kind: "constant", value: { kind: "target", id: "angle-shot.unit" } }
    },
    {
      world: kernel,
      targets: {
        [equipmentSpec.id]: [kernel.ref("equipment")],
        "angle-shot.unit": [kernel.ref("new-host")]
      }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.attached.count, 1);
  assert.equal(kernel.getObject("equipment").attachedTo.id, "new-host");
});

test("sfd-011-221 Angle Shot golden: the unlinked Draw 1 resolves even when the chosen mode does nothing", () => {
  // 359.3.e.11: the two sentences resolve independently, so a detach that has
  // nothing to detach (436.1.a.1: the Equipment is no longer Attached, so the
  // non-target selection is empty and effect.detach reports detached = 0, as its
  // own header documents) does not stop the draw.
  const kernel = angleWorld();
  const equipmentRef = kernel.ref("equipment");
  assert.equal(kernel.perform({ type: "detach", object: equipmentRef }).status, "done");
  kernel.setTargets(unitSpec.id, [kernel.ref("host-unit")]);
  kernel.setTargets(equipmentSpec.id, [equipmentRef]);
  // The Equipment left the Attached state in response, so the detach mode's
  // non-target selection has no candidate left.
  kernel.setPicks("angle-shot.chosen-equipment", []);
  kernel.setAnswers({ "angle-shot.mode/mode%3A0": "angle-shot.detach-mode" });

  const body = play.body.map(({ targets, ...rest }) => rest);
  const outcome = resolveChainBody(body, kernel);

  // Results are reported in completion order, so the mode's child precedes it.
  const byId = Object.fromEntries(outcome.results.map((entry) => [entry.id, entry.result]));
  assert.deepEqual(byId["angle-shot.detach"], { status: "executed", events: [], linkedValues: { detached: 0, detachedObjects: [] } });
  assert.equal(byId["angle-shot.mode"].status, "executed");
  assert.equal(byId["angle-shot.draw"].status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
});

test.todo(
  "sfd-011-221 Angle Shot: the 355.11 'same controller' group requirement and the 355.11.b resolution-time " +
    "legal-subset re-choice need group-level target evaluation: the merged target plan carries kind/group as data only."
);

test.todo(
  "sfd-011-221 Angle Shot: the printed [Reaction] Closed-State permission (813, 159.2.b) needs the " +
    "keyword expansion plus the chain's canAct timing query."
);

test.todo(
  "sfd-011-221 Angle Shot: the detach mode consumes the already-chosen Equipment as its non-target " +
    "selection; the chain must pass the first TargetSpec's locked reference into that pick's option set " +
    "(436.3)."
);
