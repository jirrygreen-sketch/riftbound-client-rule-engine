import type { CostSpec } from "@riftbound/card-dsl";
import type { HistoryQuery, ObjectSelector, ObjectSnapshot } from "../../src/effects/contract.js";
import type { KeywordDef } from "../../src/effects/keyword-contract.js";

// Older adapters can still construct a snapshot without the v1.1 field.
const legacy: ObjectSnapshot = {
  ref: { id: "card", zoneEntryId: 1 }, cardId: null, name: "card",
  types: [], tags: [], keywords: [], owner: "A", controller: "A",
  zone: "hand", location: null, might: null, energy: null, power: null,
  exhausted: false, damage: 0, stunned: false, buffs: 0,
  attachedTo: null, faceDown: false, isToken: false
};
const combatants: readonly ObjectSnapshot[] = [legacy, { ...legacy, combatRole: "attacker" }, { ...legacy, combatRole: "defender" }, { ...legacy, combatRole: null }];
const selectors: readonly ObjectSelector[] = ["self", "source", { target: "target" }, { pick: "pick" }, { linked: "linked" }];
const queries: readonly HistoryQuery[] = selectors.map(exclude => ({ action: "play", exclude, objectFilter: { type: "unit" } }));
const cost: CostSpec = { energy: { kind: "constant", value: 2 } };
const keyword: KeywordDef = {
  keyword: "Equip", valued: false, stacking: "separate", ruleRefs: ["818.1"],
  expand({ params }) {
    const printedCost: CostSpec | undefined = params?.cost;
    void printedCost;
    return [];
  }
};
keyword.expand({ host: { canonicalCardId: "card" } });
keyword.expand({ host: { canonicalCardId: "card" }, params: { cost, label: "equipment", count: 2, enabled: true, missing: undefined } });
const legacyKeyword: KeywordDef = {
  ...keyword,
  expand({ host, value }: { host: { canonicalCardId: string }; value?: number }) {
    void host;
    void value;
    return [];
  }
};
// @ts-expect-error Combat designations remain a closed vocabulary.
const invalidRole: ObjectSnapshot = { ...legacy, combatRole: "blocking" };
// @ts-expect-error History exclusions use symbolic selectors, not runtime refs.
const invalidSelector: HistoryQuery = { exclude: legacy.ref };
// @ts-expect-error The printed keyword cost must be a CostSpec.
keyword.expand({ host: { canonicalCardId: "card" }, params: { cost: 2 } });
void [combatants, queries, legacyKeyword, invalidRole, invalidSelector];
