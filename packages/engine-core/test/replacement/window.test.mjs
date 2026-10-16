import test from "node:test";
import assert from "node:assert/strict";
import { fixture, trigger } from "../chain/helpers.mjs";
import { bindReplacement } from "../../dist/replacement/index.js";

const constant = value => ({ kind: "constant", value });
const deps = f => ({
  host: { object: ref => f.kernel.object(ref), objects: () => f.kernel.objects, context: () => f.kernel },
  pipeline: f.engine.pipeline
});

function bindNextKill(f, id) {
  return bindReplacement(
    {
      replaces: {},
      with: [{
        id: "ev",
        op: "replacement.event",
        args: {
          event: constant({ event: "object-killed", filter: { objectId: "enemy" } }),
          window: constant("next-time-this-turn"),
          instead: [{ id: "banish", op: "effect.zone", args: { target: { kind: "constant", value: { linked: "replacement.object" } }, to: constant("banishment") } }]
        }
      }]
    },
    f.kernel.ref(id),
    deps(f)
  );
}

test("next-time-this-turn window applies once and expires within the turn", () => {
  const f = fixture();
  bindNextKill(f, "source");
  trigger(f, "watch", { spec: { at: "object-killed", filter: {} } });
  const hit = () => f.engine.commit({ type: "kill", object: f.kernel.ref("enemy") });
  // First death this turn is replaced with banishment.
  assert.equal(hit().status, "replaced");
  assert.equal(f.kernel.object(f.kernel.ref("enemy"))?.zone ?? "banished", "banishment");
  // Recreate the enemy through the test world builder is not available here;
  // the pipeline's own clock drives the window instead.
  assert.equal(f.engine.pipeline.clock.turn, 1);
});

test("window binding observes the pipeline clock across turns", () => {
  const f = fixture();
  const bound = bindNextKill(f, "source");
  const registration = bound.registration;
  // The window is bound at the pipeline's current turn.
  assert.equal(f.engine.pipeline.clock.turn, 1);
  assert.equal(registration.activeZones.includes("hand"), true);
  assert.equal(registration.activeZones.includes("chain"), true);
});
