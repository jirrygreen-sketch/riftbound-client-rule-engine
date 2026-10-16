import test from "node:test";
import assert from "node:assert/strict";
import { fixture, trigger } from "../chain/helpers.mjs";
import { bindReplacement } from "../../dist/replacement/index.js";

const constant = value => ({ kind: "constant", value });
const deps = f => ({
  host: { object: ref => f.kernel.object(ref), objects: () => f.kernel.objects, context: () => f.kernel },
  pipeline: f.engine.pipeline
});
const killEnemy = f => f.engine.commit({ type: "kill", object: f.kernel.ref("enemy") });

function bindBanishDeath(f, id = "source") {
  return bindReplacement(
    {
      replaces: { event: "object-killed", filter: { objectId: "enemy" } },
      with: [{ id: "banish", op: "effect.zone", args: { target: { kind: "constant", value: { linked: "replacement.object" } }, to: constant("banishment") } }]
    },
    f.kernel.ref(id),
    deps(f)
  );
}

test("multiple bound replacements order by the affected controller", () => {
  const choices = [];
  const f = fixture({ choose: request => { if (request.type === "mode") { choices.push(request.chooser); return request.options[0]; } } });
  bindBanishDeath(f);
  // A second bound ability that would return the enemy to hand instead.
  bindReplacement(
    {
      replaces: { event: "object-killed", filter: { objectId: "enemy" } },
      with: [{ id: "bounce", op: "effect.zone", args: { target: { kind: "constant", value: { linked: "replacement.object" } }, to: constant("hand") } }]
    },
    f.kernel.ref("enemy"),
    deps(f)
  );
  const outcome = killEnemy(f);
  assert.equal(outcome.status, "replaced");
  assert.deepEqual(choices, ["B"]);
  assert.equal(f.kernel.getObject("enemy").zone, "banishment");
});

test("a replaced death triggers no object-killed timing, an unreplaced one still does", () => {
  const f = fixture();
  trigger(f, "death-watch", { spec: { at: "object-killed", filter: {} } });
  bindBanishDeath(f);
  killEnemy(f);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-killed"), false);
  // Without the replacement, the death timing still fires.
  bindReplacement(
    {
      replaces: { event: "object-killed", filter: { objectId: "nobody" } },
      with: [{ id: "noop", op: "effect.zone", args: { target: { kind: "constant", value: { linked: "replacement.object" } }, to: constant("banishment") } }]
    },
    f.kernel.ref("enemy"),
    deps(f)
  );
  f.engine.commit({ type: "kill", object: f.kernel.ref("source") });
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-killed"), true);
});

test("the ability condition gates matching", () => {
  const f = fixture();
  bindReplacement(
    {
      replaces: { event: "object-killed", filter: { objectId: "enemy" } },
      with: [{ id: "banish", op: "effect.zone", args: { target: { kind: "constant", value: { linked: "replacement.object" } }, to: constant("banishment") } }],
      condition: { kind: "compare", operator: "eq", left: constant(1), right: constant(2) }
    },
    f.kernel.ref("source"),
    deps(f)
  );
  assert.equal(killEnemy(f).status, "done");
  assert.equal(f.kernel.getObject("enemy").zone, "trash");
});

test("a cancelled binding stops replacing immediately", () => {
  const f = fixture();
  const bound = bindBanishDeath(f);
  bound.cancel();
  assert.equal(killEnemy(f).status, "done");
  assert.equal(f.kernel.getObject("enemy").zone, "trash");
});

test("entry replacement terminates without re-applying to its rewritten state", () => {
  const f = fixture({ cards: [{ id: "ballista", types: ["unit"] }] });
  // The probe only counts applications; mode choices default to the sole option.
  f.answers.set("replacement:11:0", "replacement:ballista:1:probe");
  let applications = 0;
  const bound = bindReplacement(
    {
      replaces: { event: "object-enters-board", filter: { self: true } },
      with: [{ id: "enter", op: "replacement.enter", args: { state: constant("exhausted") } }]
    },
    f.kernel.ref("ballista"),
    deps(f)
  );
  const inner = bound.registration;
  const wrapped = { ...inner, apply: (action, original) => { applications++; return inner.apply(action, original); } };
  f.engine.pipeline.registerReplacement({ ...wrapped, id: wrapped.id + ":probe" });
  f.engine.execute(f.card("ballista", { kind: "unit", body: [] }));
  assert.equal(f.kernel.getObject("ballista").zone, "board");
  assert.equal(f.kernel.getObject("ballista").exhausted, true);
  assert.equal(applications, 1);
});
