import type { EmpoweredCount, ObjectSnapshot } from "../../src/effects/contract.js";

const legacy: ObjectSnapshot = {
  ref: { id: "legacy", zoneEntryId: 1 },
  cardId: null,
  name: "legacy",
  types: [],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "hand",
  location: null,
  might: null,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
};

const count: EmpoweredCount = 2;
const canonical: ObjectSnapshot = { ...legacy, empowered: count };
const compatible: ObjectSnapshot = { ...legacy, empoweredCount: count };
const both: ObjectSnapshot = { ...legacy, empowered: count, empoweredCount: count };

// @ts-expect-error Empowered is a numeric count, never a boolean status flag.
const booleanEmpowered: ObjectSnapshot = { ...legacy, empowered: true };
// @ts-expect-error Empowered counts are typed numbers and runtime-validated as nonnegative integers.
const stringEmpoweredCount: ObjectSnapshot = { ...legacy, empoweredCount: "2" };

void [legacy, canonical, compatible, both, booleanEmpowered, stringEmpoweredCount];
