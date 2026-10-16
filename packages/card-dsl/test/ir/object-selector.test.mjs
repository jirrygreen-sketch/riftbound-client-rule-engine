import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../dist/index.js";

const constant = value => ({ kind: "constant", value });
const property = object => ({ kind: "object-property", object, property: "might" });
const instruction = (id, args = {}, extra = {}) => ({ id, op: "condition.value", args, ...extra });
const program = abilities => ({ canonicalCardId: "test.selectors", rulesetVersion: "core-1.5", status: "executable", sourceText: "synthetic", abilities });
const target = { id: "unit", filter: { type: "unit" } };
const pick = { id: "chosen", options: ["dynamic:units"] };
const check = body => validateCardProgram(program([{ kind: "play", body }]));
const rejected = (result, path, code) => {
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.path.endsWith(path) && (!code || issue.code === code)), JSON.stringify(result));
};

for (const selector of ["self", "source", { target: "unit" }, { pick: "chosen" }, { linked: "before" }]) {
  test(`validates ${JSON.stringify(selector)} in expressions, conditions, and filter anchors`, () => {
    const read = instruction("read", {
      value: { kind: "arithmetic", operator: "add", operands: [property(selector), constant(1)] },
      alias: { kind: "object-attribute", object: selector, attribute: "energy" },
      count: { kind: "count", subject: "objects", filter: { attachedTo: selector, exclude: "self" } }
    }, { targets: [target], picks: [pick], condition: { kind: "compare", left: property(selector), operator: "gte", right: constant(5) } });
    const result = check([instruction("before"), read]);
    assert.equal(result.ok, true, JSON.stringify(result));
  });
}

for (const selector of ["other", "", null, [], {}, { target: "" }, { pick: 1 }, { linked: "bad id" }, { target: "unit", pick: "chosen" }, { target: "unit", extra: true }, { id: "unit", zoneEntryId: 1 }]) {
  test(`rejects malformed selector ${JSON.stringify(selector)}`, () => {
    rejected(check([instruction("read", { value: property(selector) }, { targets: [target], picks: [pick] })]), selector && typeof selector === "object" && !Array.isArray(selector) && Object.keys(selector).length === 1 && ["target", "pick", "linked"].includes(Object.keys(selector)[0]) ? `.object.${Object.keys(selector)[0]}` : ".object");
  });
}

for (const [key, code] of [["target", "unresolved-target"], ["pick", "unresolved-pick"], ["linked", "linked-instruction-not-prior"]]) {
  test(`rejects nonexistent ${key} ids`, () => rejected(check([instruction("read", { value: property({ [key]: "missing" }) })]), `.object.${key}`, code));
}

test("target and pick selectors cannot borrow ids from another ability or the other selection kind", () => {
  const declaration = { kind: "play", body: [instruction("before", {}, { targets: [target], picks: [pick] })] };
  for (const selector of [{ target: "unit" }, { pick: "chosen" }, { linked: "before" }]) {
    rejected(validateCardProgram(program([declaration, { kind: "play", body: [instruction("read", { value: property(selector) })] }])), `.object.${Object.keys(selector)[0]}`);
  }
  rejected(check([instruction("read", { value: property({ target: "chosen" }) }, { picks: [pick] })]), ".object.target", "unresolved-target");
  rejected(check([instruction("read", { value: property({ pick: "unit" }) }, { targets: [target] })]), ".object.pick", "unresolved-pick");
});

test("ability-local declarations include later instructions and cost picks", () => {
  const result = validateCardProgram(program([{ kind: "play", cost: { discard: pick }, body: [
    instruction("read", { value: property({ target: "unit" }), picked: property({ pick: "chosen" }) }),
    instruction("declare", {}, { targets: [target] })
  ] }]));
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("linked selectors reject self and forward instruction references", () => {
  for (const id of ["read", "later"]) {
    rejected(check([instruction("read", { value: property({ linked: id }) }), instruction("later")]), ".object.linked", "linked-instruction-not-prior");
  }
});

test("linked selectors respect sequence visibility and repeat-local isolation", () => {
  const nested = op => ({ id: "container", op, args: { body: constant([instruction("inside")]), ...(op === "repeat" ? { count: constant(1) } : {}) } });
  assert.equal(check([nested("sequence"), instruction("read", { value: property({ linked: "inside" }) })]).ok, true);
  rejected(check([nested("repeat"), instruction("read", { value: property({ linked: "inside" }) })]), ".object.linked");
  const repeat = nested("repeat");
  repeat.args.body.value.push(instruction("read", { value: property({ linked: "inside" }) }));
  assert.equal(check([repeat]).ok, true);
});

test("nested optional and mode bodies validate selectors rather than treating them as arbitrary JSON", () => {
  const read = instruction("read", { value: property({ target: "missing" }) });
  rejected(check([{ id: "optional", op: "choice.optional", args: { body: constant([read]) } }]), ".object.target");
  rejected(check([{ id: "mode", op: "choice.mode", args: { modes: constant([{ id: "one", body: [read] }]) } }]), ".object.target");
});

test("known literal-encoded conditions, operands, and filters validate selectors", () => {
  const missing = property({ target: "missing" });
  rejected(check([{ id: "predicate", op: "condition.predicate", args: { condition: constant({ kind: "expression", value: missing }) } }]), ".value.object.target");
  rejected(check([instruction("arithmetic", { operands: constant([missing]), operator: constant("add") })]), ".object.target");
  rejected(check([instruction("query", { filter: constant({ attachedTo: { pick: "missing" } }) })]), ".attachedTo.pick");
});

test("trigger, replacement, static effects, requirements, costs, and pick filters validate selectors", () => {
  const invalid = property({ id: "unit", zoneEntryId: 1 });
  const condition = { kind: "expression", value: invalid };
  const cases = [
    [{ kind: "triggered", trigger: { at: "object-killed", filter: {}, condition }, optional: false, body: [] }, ".condition.value.object"],
    [{ kind: "replacement", replaces: { event: "damage", filter: { target: { target: "missing" } } }, with: [] }, ".filter.target.target"],
    [{ kind: "static", effect: { kind: "continuous.might", value: invalid } }, ".effect.value.object"],
    [{ kind: "play", requirements: [{ kind: "control", value: invalid }], body: [] }, ".value.object"],
    [{ kind: "play", cost: { energy: invalid }, body: [] }, ".energy.object"],
    [{ kind: "play", body: [instruction("choose", {}, { picks: [{ ...pick, filter: { attachedTo: { pick: "missing" } } }] })] }, ".filter.attachedTo.pick"]
  ];
  for (const [ability, path] of cases) rejected(validateCardProgram(program([ability])), path);
});

test("pre-resolution metadata cannot link to its own future body", () => {
  rejected(validateCardProgram(program([{ kind: "play", restriction: { kind: "control", value: property({ linked: "later" }) }, body: [instruction("later")] }])), ".object.linked");
});

test("runtime ObjectRefs cannot hide inside literal data, pick options, or filters", () => {
  const ref = { id: "unit", zoneEntryId: 1 };
  rejected(check([instruction("literal", { value: constant([ref]) })]), ".value[0]", "invalid-object-selector");
  rejected(check([instruction("pick", {}, { picks: [{ ...pick, options: [ref] }] })]), ".options[0]", "invalid-object-selector");
  rejected(check([instruction("count", { value: { kind: "count", subject: "objects", filter: { attachedTo: ref } } })]), ".attachedTo", "invalid-object-selector");
});

test("declarations hidden in an ordinary constant do not satisfy selector references", () => {
  rejected(check([instruction("read", { value: property({ target: "unit" }), data: constant({ targets: [target] }) })]), ".object.target", "unresolved-target");
});

test("pick option data and extension metadata cannot declare targets", () => {
  rejected(check([instruction("read", { value: property({ target: "unit" }) }, {
    picks: [{ ...pick, options: [{ targets: [target] }] }], metadata: { targets: [target] }
  })]), ".object.target", "unresolved-target");
});

test("cyclic filter metadata reports an issue without overflowing", () => {
  const filter = {};
  filter.filter = filter;
  rejected(check([instruction("count", { value: { kind: "count", subject: "objects", filter } })]), ".filter.filter", "cyclic-filter");
});
