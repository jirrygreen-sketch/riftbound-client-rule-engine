import type { CardProgram, CostSpec, Expr } from "@riftbound/card-dsl";
import { bindResolveContext } from "../../events/action-adapter.js";
import { CostPlanError, type CostDiscount, type CostPlan, type CostPlanInput } from "../../cost/plan-types.js";
import { buildCostPlan } from "../../cost/cost-plan.js";
import { prepareCostPayment } from "../../cost/payment.js";
import { freezeCost } from "../../cost/plan-values.js";
import { DUEL_DOMAINS } from "../../cost/resources.js";
import type {
  Domain,
  FinalizedCostPlan,
  ObjectRef,
  ObjectSnapshot,
  PlayerId,
  ResolveContext,
  Value
} from "../contract.js";
import { cardProgramFor, playCostFor } from "./catalog.js";

export interface BuildEffectPlayPlanRequest {
  readonly object: ObjectRef;
  readonly player: PlayerId;
  readonly cost?: Value;
  readonly ignoreCost?: Value;
  readonly ignoreCosts?: Value;
}
type AnyRecord = Record<string, unknown>;

const DOMAIN_SET = new Set<string>(DUEL_DOMAINS);
const PLAYABLE_TYPES = new Set(["unit", "gear", "spell"]);

function record(value: unknown): AnyRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as AnyRecord
    : null;
}

function isRef(value: unknown): value is ObjectRef {
  const item = record(value);
  return item !== null && typeof item.id === "string" && item.id.length > 0 &&
    Number.isSafeInteger(item.zoneEntryId) && Number(item.zoneEntryId) >= 0;
}

function copyRef(ref: ObjectRef): ObjectRef {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function literal(value: unknown): Expr {
  return { kind: "constant", value: value as Value };
}

function cardType(snapshot: ObjectSnapshot): string {
  const type = snapshot.types.find(value => PLAYABLE_TYPES.has(value.toLowerCase()));
  if (type === undefined) return snapshot.isToken ? "Token" : "Unknown";
  return `${type[0]!.toUpperCase()}${type.slice(1).toLowerCase()}`;
}

function domainsOf(snapshot: ObjectSnapshot): readonly Domain[] | undefined {
  if (snapshot.power === null) return undefined;
  return [...new Set(snapshot.power)];
}

/** ObjectSnapshot.power is a Domain set, while a numeric program cost uses
 * those Domains as its one allowed set. De-duplicate for the printed
 * projection while keeping an empty list domainless. */
function programDomains(snapshot: ObjectSnapshot, programCost: CostSpec | undefined): readonly Domain[] | undefined {
  const power = record(programCost?.power);
  if (power?.kind === "constant" && typeof power.value === "number") return domainsOf(snapshot);
  return undefined;
}

function exactProgramCost(programCost: CostSpec | undefined): CostPlanInput["cost"] | undefined {
  const kind = typeof programCost?.kind === "string" ? programCost.kind.replace(/^cost\./, "") : undefined;
  if (kind !== "printed" || programCost?.energy === undefined) return undefined;
  const energy = record(programCost.energy);
  if (energy?.kind !== "constant" || typeof energy.value !== "number") return undefined;
  if (programCost.power === undefined) {
    return {
      kind: "explicit",
      energy: literal(energy.value),
      power: literal([]),
      ...(Array.isArray(programCost.payments) ? { payments: programCost.payments } : {})
    };
  }
  const power = record(programCost.power);
  if (power?.kind !== "constant" || typeof power.value !== "number") return undefined;
  return {
    kind: "explicit",
    energy: literal(energy.value),
    power: literal(power.value === 0 ? [] : power.value),
    ...(Array.isArray(programCost.payments) ? { payments: programCost.payments } : {})
  };
}

function numericPower(snapshot: ObjectSnapshot, programCost: CostSpec | undefined): number | null {
  const explicit = programCost?.power;
  const constant = record(explicit);
  if (constant !== null && constant.kind === "constant" && typeof constant.value === "number") {
    return constant.value;
  }
  if (constant !== null && constant.kind === "constant" && Array.isArray(constant.value)) {
    return constant.value.length;
  }
  // ObjectSnapshot.power is a set of allowed Domains, not an occurrence count.
  // A null projection is therefore the only truthful value when the program
  // does not provide an exact numeric Power cost.
  return null;
}

function hasPrintedCostDirective(descriptor: AnyRecord): boolean {
  return descriptor.base === "printed";
}

function printedProjection(snapshot: ObjectSnapshot, programCost: CostSpec | undefined) {
  return {
    id: snapshot.cardId ?? snapshot.ref.id,
    cardType: cardType(snapshot),
    // Energy is a scalar and remains the source projection. The selected
    // program supplies an exact Power symbol count because ObjectSnapshot.power
    // is only the unique Domain set.
    energy: snapshot.energy,
    power: numericPower(snapshot, programCost),
    domains: domainsOf(snapshot) ?? []
  };
}

function normalizedProgramCost(cost: CostSpec | undefined): CostPlanInput["cost"] | undefined {
  if (cost === undefined) return undefined;
  const raw = { ...cost };
  const kind = typeof raw.kind === "string" ? raw.kind : undefined;
  const normalized = kind?.startsWith("cost.") ? kind.slice(5) : kind;
  if (normalized === "printed" && Object.keys(raw).some(key => key !== "kind")) {
    delete raw.kind;
    return { kind: "explicit", ...raw };
  }
  if (normalized === "additional" || normalized === "additional-cost") {
    throw new CostPlanError("judge-required", `A ${String(kind)} program entry is not a complete printed base cost`);
  }
  if (normalized !== undefined && normalized !== "printed" && normalized !== "explicit" && normalized !== "activated") {
    throw new CostPlanError("judge-required", `Unsupported play base cost kind ${String(kind)}`);
  }
  if (normalized === "printed") return undefined;
  if (normalized === undefined) {
    if (Object.keys(raw).length === 0) return undefined;
    return { kind: "explicit", ...raw };
  }
  return { ...raw, kind: normalized };
}

function planId(snapshot: ObjectSnapshot, player: PlayerId, suffix = "printed"): string {
  return `effect-play:${snapshot.ref.id}:${snapshot.ref.zoneEntryId}:${player}:${suffix}`;
}

function selectedContext(ctx: ResolveContext, snapshot: ObjectSnapshot, player: PlayerId): ResolveContext {
  return bindResolveContext(ctx, { source: snapshot, controller: player });
}

function zeroTokenPlan(ctx: ResolveContext, snapshot: ObjectSnapshot, player: PlayerId): CostPlan {
  return buildCostPlan(ctx, {
    id: planId(snapshot, player, "token"),
    cost: { kind: "explicit", energy: literal(0), power: literal([]) },
    printed: printedProjection(snapshot, undefined)
  });
}

function printedPlan(ctx: ResolveContext, snapshot: ObjectSnapshot, player: PlayerId, programCost: CostSpec | undefined): CostPlan {
  const domains = programDomains(snapshot, programCost) ?? domainsOf(snapshot);
  const cost = normalizedProgramCost(programCost) ?? { kind: "printed" as const };
  return buildCostPlan(ctx, {
    id: planId(snapshot, player),
    cost,
    printed: printedProjection(snapshot, programCost),
    ...(domains === undefined ? {} : { domains })
  });
}

function ignoreValues(value: unknown): readonly string[] {
  if (value === undefined || value === null || value === false) return [];
  if (value === true || value === "printed" || value === "all") return ["resources"];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  const item = record(value);
  if (item === null) return [];
  if (item.ignore !== undefined) return ignoreValues(item.ignore);
  return [];
}

function ignoreModifications(...values: readonly unknown[]): CostPlanInput["baseModifications"] {
  const requested = new Set(ignoreValues(values.find(value => value !== undefined && value !== null && value !== false)));
  const all = values.flatMap(value => ignoreValues(value));
  for (const value of all) requested.add(value);
  const energy = requested.has("energy");
  const power = requested.has("power");
  const resources = requested.has("resources") || requested.has("any") || requested.has("all") || energy && power;
  if (requested.size > 0 && [...requested].some(value => !["energy", "power", "resources", "any", "all"].includes(value))) {
    throw new CostPlanError("judge-required", `Unsupported ignored-cost selector: ${[...requested].join(",")}`);
  }
  if (resources) return [{ kind: "ignore-base", ignore: "resources" }];
  if (energy) return [{ kind: "ignore-base", ignore: "energy" }];
  if (power) return [{ kind: "ignore-base", ignore: "power" }];
  return [];
}

function evaluatedInteger(ctx: ResolveContext, value: unknown, label: string): number {
  const expression = record(value);
  const evaluated = expression !== null && typeof expression.kind === "string"
    ? ctx.evaluate(value as Expr)
    : value;
  // TestWorld and legacy adapters historically evaluate an unknown linked key
  // to null. Do not turn that placeholder into a zero-valued cost modifier.
  if (evaluated === null && (expression?.kind === "linked-value" || expression?.kind === "linked")) {
    throw new CostPlanError("judge-required", `${label} linked value is unavailable`);
  }
  if (typeof evaluated !== "number" || !Number.isSafeInteger(evaluated)) {
    throw new CostPlanError("judge-required", `${label} requires a constant integer`);
  }
  return evaluated;
}

function modifierDiscounts(ctx: ResolveContext, value: unknown): CostDiscount[] {
  if (value !== undefined && record(value) === null && !Array.isArray(value)) {
    throw new CostPlanError("judge-required", "Play cost modifiers must be an object or array");
  }
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const discounts: CostDiscount[] = [];
  for (const [index, raw] of list.entries()) {
    const modifier = record(raw);
    if (modifier === null || typeof modifier.kind !== "string") {
      throw new CostPlanError("judge-required", "Play cost modifier has no recognized kind");
    }
    if (modifier.kind !== "reduce") {
      throw new CostPlanError("judge-required", `Unsupported play cost modifier ${modifier.kind}`);
    }
    if (modifier.resource !== "energy" && modifier.resource !== "power") {
      throw new CostPlanError("invalid-cost-plan", "Play cost modifier resource must be energy or power");
    }
    const amount = evaluatedInteger(ctx, modifier.amount, "Play cost modifier amount");
    const minimum = modifier.minimum === undefined
      ? undefined
      : evaluatedInteger(ctx, modifier.minimum, "Play cost modifier minimum");
    if (minimum !== undefined && minimum < 0) {
      throw new CostPlanError("judge-required", "Play cost modifier minimum must be nonnegative");
    }
    discounts.push({
      id: typeof modifier.id === "string" && modifier.id.length > 0 ? modifier.id : `modifier:${index}`,
      resource: modifier.resource,
      amount: literal(Math.abs(amount)),
      ...(minimum === undefined ? {} : { minimum: literal(minimum) }),
      ...(typeof modifier.component === "string" ? { component: modifier.component } : {}),
      ...(Array.isArray(modifier.domains)
        ? { domains: modifier.domains.filter((domain): domain is Domain => typeof domain === "string" && DOMAIN_SET.has(domain)) }
        : {})
    });
  }
  return discounts;
}

function singleDiscount(ctx: ResolveContext, value: unknown): CostDiscount | null {
  const discount = record(value);
  if (discount === null) return null;
  if (discount.resource !== "energy" && discount.resource !== "power") {
    throw new CostPlanError("invalid-cost-plan", "Play cost discount resource must be energy or power");
  }
  const rawAmount = evaluatedInteger(ctx, discount.amount, "Play cost discount amount");
  const rawMinimum = discount.minimum === undefined
    ? undefined
    : evaluatedInteger(ctx, discount.minimum, "Play cost discount minimum");
  if (rawMinimum !== undefined && rawMinimum < 0) {
    throw new CostPlanError("judge-required", "Play cost discount minimum must be nonnegative");
  }
  return {
    id: typeof discount.id === "string" && discount.id.length > 0 ? discount.id : "descriptor-discount",
    resource: discount.resource,
    amount: literal(Math.abs(rawAmount)),
    ...(rawMinimum === undefined ? {} : { minimum: literal(rawMinimum) }),
    ...(typeof discount.component === "string" ? { component: discount.component } : {}),
    ...(Array.isArray(discount.domains)
      ? { domains: discount.domains.filter((domain): domain is Domain => typeof domain === "string" && DOMAIN_SET.has(domain)) }
      : {})
  };
}

function componentList(value: unknown): CostPlanInput["mandatoryAdditional"] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CostPlanError("invalid-cost-plan", "Additional cost components must be an array");
  return value.map((raw, index) => {
    const item = record(raw);
    if (item === null || typeof item.id !== "string" || record(item.cost) === null) {
      throw new CostPlanError("invalid-cost-plan", "Each additional cost requires an id and CostSpec");
    }
    return { id: item.id.length > 0 ? item.id : `additional:${index}`, cost: item.cost as CostSpec };
  });
}

const DESCRIPTOR_FIELDS = new Set([
  "kind", "id", "base", "resource", "amount", "minimum", "discount", "discounts",
  "modifier", "modifiers", "ignore", "ignoreCost", "ignoreCosts",
  "ignoreEnergyOnly", "ignoreEnergyOfSelectedCard", "ignoreAllCosts",
  "optionalAdditional", "mandatoryAdditional", "increases", "finalized",
  "cost", "energy", "power", "domains", "printed", "replace", "alternative"
]);

function descriptorBaseCost(descriptor: AnyRecord, programCost: CostSpec | undefined): CostPlanInput["cost"] | undefined {
  const kind = descriptor.kind?.toString().replace(/^cost\./, "");
  if (descriptor.base !== undefined && descriptor.base !== "printed") {
    throw new CostPlanError("judge-required", `Unsupported play cost base ${String(descriptor.base)}`);
  }
  if (record(descriptor.cost) !== null && !hasPrintedCostDirective(descriptor)) {
    return normalizedProgramCost(descriptor.cost as CostSpec);
  }
  if (kind === "printed" && Object.keys(descriptor).some(key => !["kind", "base", "finalized"].includes(key))) {
    return normalizedProgramCost(descriptor as CostSpec);
  }
  return exactProgramCost(programCost) ?? normalizedProgramCost(programCost);
}

function exactSelectedProgramCost(programCost: CostSpec | undefined): CostPlanInput["cost"] | undefined {
  if (programCost === undefined) return undefined;
  const kind = typeof programCost.kind === "string" ? programCost.kind.replace(/^cost\./, "") : undefined;
  if (kind !== "printed" && kind !== "explicit") return undefined;
  const energy = record(programCost.energy);
  if (energy?.kind !== "constant" || typeof energy.value !== "number") return undefined;
  if (programCost.power === undefined) {
    return { kind: "explicit", energy: literal(energy.value), power: literal([]) };
  }
  const power = record(programCost.power);
  if (power?.kind !== "constant") return undefined;
  if (typeof power.value === "number") {
    return { kind: "explicit", energy: literal(energy.value), power: literal(power.value === 0 ? [] : power.value) };
  }
  if (Array.isArray(power.value)) {
    return { kind: "explicit", energy: literal(energy.value), power: literal(power.value) };
  }
  return undefined;
}

function partialEnergyBaseCost(programCost: CostSpec | undefined, partial: CostPlanInput["cost"]): CostPlanInput["cost"] {
  // A card-effect descriptor may read Energy from the selected runtime card
  // while the exact Power component comes from its trusted CardProgram. This
  // keeps the partial expression target-aware and preserves the omitted Power
  // symbols without inventing a count from ObjectSnapshot.power's domain set.
  const complete = exactSelectedProgramCost(programCost);
  if (complete === undefined) {
    throw new CostPlanError(
      "judge-required",
      "A target Energy expression cannot replace a card Base Cost without exact numeric Power provenance"
    );
  }
  return {
    kind: "explicit",
    energy: partial.energy,
    power: complete.power,
    payments: [...(complete.payments ?? []), ...(partial.payments ?? [])]
  };
}

function evaluatedPrintedBase(
  descriptor: AnyRecord,
  programCost: CostSpec | undefined,
  snapshot: ObjectSnapshot
): CostPlanInput["cost"] {
  const complete = exactSelectedProgramCost(programCost);
  const declared = record(descriptor.cost) === null
    ? undefined
    : normalizedProgramCost(descriptor.cost as CostSpec);
  const declaredCost = record(descriptor.cost);
  if (complete === undefined && declaredCost?.power === undefined && snapshot.power !== null) {
    throw new CostPlanError(
      "judge-required",
      "A printed-base CostSpec requires the selected card's complete numeric Energy and Power programme"
    );
  }
  if (record(descriptor.cost) !== null && (declared === undefined || declared.kind !== "explicit")) {
    throw new CostPlanError("judge-required", "A printed-base modification must use an explicit partial CostSpec");
  }
  if (declaredCost?.energy !== undefined && declaredCost.power === undefined) {
    return partialEnergyBaseCost(programCost, declared!);
  }
  const energy = declaredCost?.energy !== undefined && declared?.energy !== undefined
    ? declared.energy
    : complete?.energy ?? literal(snapshot.energy);
  const power = declaredCost?.power !== undefined && declared?.power !== undefined
    ? declared.power
    : complete?.power ?? literal([]);
  if (record(energy)?.kind === "constant" && record(energy)?.value === null) {
    throw new CostPlanError("missing-printed-cost", `Selected card ${snapshot.ref.id} has no printed Energy cost`);
  }
  return {
    kind: "explicit",
    energy,
    power,
    payments: [
      ...(complete?.payments ?? []),
      ...(declared?.payments ?? [])
    ]
  };
}

function assertDescriptorFields(descriptor: AnyRecord): void {
  for (const key of Object.keys(descriptor)) {
    if (!DESCRIPTOR_FIELDS.has(key)) {
      throw new CostPlanError("judge-required", `Unsupported play cost descriptor field ${key}`);
    }
  }
}

function descriptorPlan(ctx: ResolveContext, snapshot: ObjectSnapshot, player: PlayerId, descriptor: AnyRecord): CostPlan {
  assertDescriptorFields(descriptor);
  if (descriptor.kind !== undefined && descriptor.kind !== "cost.modify" && descriptor.kind !== "cost.printed" && descriptor.kind !== "printed") {
    throw new CostPlanError("judge-required", `Unsupported play cost descriptor ${String(descriptor.kind)}`);
  }
  if (descriptor.replace !== undefined || descriptor.alternative !== undefined) {
    throw new CostPlanError("judge-required", "Alternate printed costs require an explicit CostSpec and domain provenance");
  }
  if (descriptor.base === "printed" && (
    descriptor.ignore !== undefined || descriptor.ignoreCost !== undefined || descriptor.ignoreCosts !== undefined ||
    descriptor.ignoreEnergyOnly === true || descriptor.ignoreEnergyOfSelectedCard === true ||
    descriptor.ignoreAllCosts === true
  )) {
    throw new CostPlanError("judge-required", "A printed-base descriptor cannot also ignore its base cost");
  }
  const program = cardProgramFor(snapshot.cardId);
  const programCost = playCostFor(program);
  const discounts = [...modifierDiscounts(ctx, descriptor.modifiers ?? descriptor.modifier)];
  const direct = singleDiscount(ctx, descriptor.discount);
  if (direct !== null) discounts.push(direct);
  for (const discount of Array.isArray(descriptor.discounts) ? descriptor.discounts : []) {
    const parsed = singleDiscount(ctx, discount);
    if (parsed !== null) discounts.push(parsed);
  }
  const rawIncreases = descriptor.increases;
  const increases: NonNullable<CostPlanInput["increases"]>[number][] = Array.isArray(rawIncreases)
    ? [...(componentList(rawIncreases) ?? [])]
    : [];
  const rawAmount = record(descriptor.amount)?.value ?? descriptor.amount;
  if (rawAmount !== undefined) {
    if (descriptor.resource !== "energy" && descriptor.resource !== "power") {
      throw new CostPlanError("invalid-cost-plan", "A cost descriptor amount requires an Energy or Power resource");
    }
    const amount = record(descriptor.amount) !== null && typeof (descriptor.amount as AnyRecord).kind === "string"
      ? ctx.evaluate(descriptor.amount as Expr)
      : rawAmount;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount)) {
      throw new CostPlanError("judge-required", "A cost descriptor amount must be a constant integer");
    }
    const id = typeof descriptor.id === "string" && descriptor.id.length > 0 ? descriptor.id : "descriptor-amount";
    if (amount >= 0) {
      increases.push({ id, cost: { [descriptor.resource]: literal(amount) } });
    } else {
      discounts.push({
        id,
        resource: descriptor.resource,
        amount: literal(-amount),
        ...(typeof descriptor.minimum === "number" ? { minimum: literal(descriptor.minimum) } : {})
      });
    }
  }
  const domains = domainsOf(snapshot);
  // A printed-base modification needs either an explicit target projection or
  // an exact selected-card program. Older descriptors with only a modifier
  // retain the legacy path and cannot silently infer Power from a Domain set.
  const trustPrintedEnergy = hasPrintedCostDirective(descriptor) &&
    (record(descriptor.cost) !== null || exactSelectedProgramCost(programCost) !== undefined);
  if (trustPrintedEnergy && snapshot.energy === null && exactSelectedProgramCost(programCost) === undefined) {
    throw new CostPlanError("missing-printed-cost", `Selected card ${snapshot.ref.id} has no printed Energy cost`);
  }
  const cost = trustPrintedEnergy
    ? evaluatedPrintedBase(descriptor, programCost, snapshot)
    : descriptorBaseCost(descriptor, programCost) ?? { kind: "printed" as const };
  const ignored = ignoreModifications(descriptor.ignore) ?? [];
  return buildCostPlan(ctx, {
    id: planId(snapshot, player, typeof descriptor.id === "string" ? descriptor.id : "descriptor"),
    cost,
    printed: printedProjection(snapshot, programCost),
    ...(domains === undefined ? {} : { domains }),
    ...(ignored.length > 0 ? { baseModifications: ignored } : {}),
    ...(discounts.length > 0 ? { discounts } : {}),
    ...(Array.isArray(descriptor.optionalAdditional)
      ? { optionalAdditional: descriptor.optionalAdditional as NonNullable<CostPlanInput["optionalAdditional"]> }
      : {}),
    ...(Array.isArray(descriptor.mandatoryAdditional)
      ? { mandatoryAdditional: componentList(descriptor.mandatoryAdditional) }
      : {}),
    ...(increases.length > 0 ? { increases } : {}),
    ...(descriptor.ignoreAllCosts === true ? { ignoreAllCosts: true } : {})
  });
}

function directiveFlags(descriptor: AnyRecord): AnyRecord {
  const ignore = [
    descriptor.ignore,
    descriptor.ignoreCost,
    descriptor.ignoreCosts,
    descriptor.ignoreEnergyOnly === true ? "energy" : undefined,
    descriptor.ignoreEnergyOfSelectedCard === true ? "energy" : undefined
  ];
  return ignore.some(value => ignoreValues(value).length > 0)
    ? { ...descriptor, ignore: ignore.filter(value => value !== undefined) }
    : descriptor;
}

function valueRecord(value: unknown): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

/** Flatten the complete cost model without silently dropping later fees. */
export function flattenEffectPlayCostPlan(ctx: ResolveContext, plan: CostPlan): FinalizedCostPlan {
  const exhaust: ObjectRef[] = [];
  const recycle: ObjectRef[] = [];
  for (const action of plan.total.actions) {
    if (action.action.type === "exhaust") exhaust.push(copyRef(action.action.object));
    else if (action.action.type === "recycle") recycle.push(copyRef(action.action.object));
    else throw new CostPlanError("judge-required", `Nested Play cannot flatten nonstandard payment ${action.action.type}`);
  }
  // Allocation is read-only and checks the actual player inventory. Never mint
  // a Domain merely because the plan permits it.
  const prepared = prepareCostPayment(ctx, plan);
  const standard = prepared.actions.find(action => action.action.type === "pay");
  const paidPower = standard?.action.type === "pay" ? standard.action.plan.power ?? [] : [];
  const flat: FinalizedCostPlan = {
    finalized: true,
    planId: plan.id,
    energy: plan.total.energy,
    power: [...paidPower],
    ...(plan.total.xp === 0 ? {} : { xp: plan.total.xp }),
    ...(exhaust.length === 0 ? {} : { exhaust }),
    ...(recycle.length === 0 ? {} : { recycle }),
    parameters: {
      costPlan: valueRecord(plan),
      selectedAdditional: valueRecord(plan.selectedAdditional),
      declinedAdditional: valueRecord(plan.declinedAdditional),
      modifications: valueRecord(plan.modifications),
      discounts: valueRecord(plan.discounts),
      preparedPayment: valueRecord(prepared)
    }
  };
  return freezeCost(flat);
}

function flatCost(ctx: ResolveContext, player: PlayerId, raw: AnyRecord): FinalizedCostPlan {
  if (raw.finalized !== true) throw new CostPlanError("judge-required", "Nested Play requires a finalized plan or recognized directive");
  if (record(raw.total) !== null) return flattenEffectPlayCostPlan(ctx, raw as unknown as CostPlan);
  const energy = raw.energy === undefined ? 0 : raw.energy;
  const power = raw.power === undefined ? [] : raw.power;
  const xp = raw.xp === undefined ? 0 : raw.xp;
  if (typeof energy !== "number" || !Number.isSafeInteger(energy) || energy < 0) {
    throw new CostPlanError("invalid-cost-plan", "Finalized Play Energy must be a non-negative safe integer");
  }
  if (!Array.isArray(power) || power.some(domain => typeof domain !== "string" || !DOMAIN_SET.has(domain))) {
    throw new CostPlanError("judge-required", "Finalized Play Power must name concrete Domains");
  }
  if (typeof xp !== "number" || !Number.isSafeInteger(xp) || xp < 0) {
    throw new CostPlanError("invalid-cost-plan", "Finalized Play XP must be a non-negative safe integer");
  }
  if (raw.universalPower !== undefined && raw.universalPower !== 0) {
    throw new CostPlanError("judge-required", "Universal Power cannot cross the current flat Play contract");
  }
  return freezeCost(structuredClone({
    ...raw,
    finalized: true as const,
    ...(typeof raw.planId === "string" ? { planId: raw.planId } : {}),
    energy,
    power,
    ...(xp === 0 ? {} : { xp })
  })) as FinalizedCostPlan;
}

/** Build the selected card's cost, or `undefined` for a legacy unknown directory entry. */
export function buildEffectPlayCostPlan(ctx: ResolveContext, request: BuildEffectPlayPlanRequest): FinalizedCostPlan | undefined {
  const snapshot = ctx.object(request.object);
  if (snapshot === null) return undefined;
  const bound = selectedContext(ctx, snapshot, request.player);
  if (request.cost === null) {
    throw new CostPlanError("invalid-cost-plan", "effect.play cost cannot evaluate to null");
  }
  const rawCost = record(request.cost);
  const argIgnore = request.ignoreCost ?? request.ignoreCosts;
  const ignore = ignoreModifications(argIgnore) ?? [];
  const program: CardProgram | undefined = cardProgramFor(snapshot.cardId);
  const programCost = playCostFor(program);
  if (rawCost !== null && rawCost.finalized !== true) assertDescriptorFields(rawCost);

  if (snapshot.isToken && programCost === undefined && rawCost === null) {
    return flattenEffectPlayCostPlan(bound, zeroTokenPlan(bound, snapshot, request.player));
  }

  if (rawCost === null) {
    // Only a legacy object with no trusted directory entry may use the old
    // "normal Play without an override" compatibility path. A known program
    // with no PlayAbility still has catalog/runtime characteristics that must
    // be checked instead of silently becoming free.
    if (program === undefined && ignore.length === 0) return undefined;
    // Legacy synthetic Play effects may carry their own complete finalized
    // cost. Such a plan is already the caller-provided replacement and does
    // not need a trusted target program to reconstruct Power.
    const normalized = exactProgramCost(programCost) ?? normalizedProgramCost(programCost);
    const powerIgnored = ignore.some(modification =>
      modification.kind === "ignore-base" && modification.ignore !== "energy");
    if (snapshot.energy === null && normalized === undefined && !powerIgnored) {
      throw new CostPlanError("missing-printed-cost", `Selected card ${snapshot.ref.id} has no printed Energy cost`);
    }
    if (snapshot.power !== null && normalized === undefined && !powerIgnored) {
      if (program !== undefined) {
        throw new CostPlanError(
          "judge-required",
          `Selected card ${snapshot.ref.id} has no exact numeric Power cost; its Domain list is not a count`
        );
      }
      return undefined;
    }
    const plan = printedPlan(bound, snapshot, request.player, programCost);
    return flattenEffectPlayCostPlan(bound, ignore.length === 0
      ? plan
      : buildCostPlan(bound, {
        id: plan.id,
        cost: normalized ?? { kind: "printed" },
        printed: printedProjection(snapshot, programCost),
        ...(programDomains(snapshot, programCost) ?? domainsOf(snapshot)) === undefined
          ? {}
          : { domains: programDomains(snapshot, programCost) ?? domainsOf(snapshot) },
        baseModifications: ignore
      }));
  }

  const directive = directiveFlags(rawCost);
  const hasDirective = (ignoreModifications(directive.ignore) ?? []).length > 0 ||
    directive.discount !== undefined || directive.modifier !== undefined || directive.modifiers !== undefined ||
    directive.discounts !== undefined || directive.amount !== undefined ||
    directive.mandatoryAdditional !== undefined || directive.increases !== undefined || directive.ignoreAllCosts === true;
  if (rawCost.finalized === true && !hasDirective) return flatCost(bound, request.player, directive);
  const descriptorKind = typeof directive.kind === "string" ? directive.kind.replace(/^cost\./, "") : undefined;
  // A printed-base descriptor is bound to the selected card's trusted
  // CardProgram. Synthetic/legacy targets without a directory entry cannot
  // provide that provenance, so the nested Play is negated before any action.
  if (hasPrintedCostDirective(directive) && program === undefined) return undefined;
  const explicitBase = record(directive.cost) !== null || descriptorKind === "printed" || descriptorKind === "explicit";
  if (!hasDirective && !explicitBase && descriptorKind !== "modify") {
    throw new CostPlanError("judge-required", "Unrecognized unfinalized play cost descriptor");
  }
  const ignoresPower = (ignoreModifications(directive.ignore) ?? []).some(modification =>
    modification.kind === "ignore-base" && modification.ignore !== "energy");
  if (hasPrintedCostDirective(directive) && snapshot.power !== null && !ignoresPower &&
      programCost !== undefined && record(directive.cost) === null &&
      exactSelectedProgramCost(programCost) === undefined) {
    throw new CostPlanError(
      "judge-required",
      `Selected card ${snapshot.ref.id} has no exact numeric Power cost; its Domain list is not a count`
    );
  }
  if (programCost === undefined && snapshot.power !== null && !ignoresPower &&
      record(directive.cost) === null && descriptorKind !== "explicit" && !hasPrintedCostDirective(directive)) {
    if (program !== undefined) {
      throw new CostPlanError(
        "judge-required",
        `Selected card ${snapshot.ref.id} has no exact numeric Power cost; its Domain list is not a count`
      );
    }
    return undefined;
  }
  if (snapshot.energy === null && descriptorBaseCost(directive, programCost) === undefined &&
      !(hasPrintedCostDirective(directive) && snapshot.isToken === false)) {
    throw new CostPlanError("missing-printed-cost", `Selected card ${snapshot.ref.id} has no printed Energy cost`);
  }
  const plan = descriptorPlan(bound, snapshot, request.player, directive);
  return flattenEffectPlayCostPlan(bound, plan);
}
