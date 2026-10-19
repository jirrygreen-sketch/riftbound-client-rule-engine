import type {
  Expr,
  Instruction,
  ObjectFilter,
  ObjectRef,
  ResolveContext,
  TriggerSpec,
  Value,
} from '../contract.js';
import { isTimingPointId, resolveTimingPointId, type TimingPointId } from '../../events/timing-points.js';
import { assertTriggerSpec, validateEventPattern, validateObjectFilter, TRIGGER_ONCE_SCOPES, type EventPattern } from '../../events/trigger-spec.js';
import { delayedDuration, delayedExpiresAt, DELAYED_EXPIRES_AT, type DelayedDuration } from '../../events/delayed/duration.js';
import type {
  DelayedRegistrationOptions,
  DelayedRegistrationSink,
  DelayedTriggerDeclaration,
  PreparedDelayedRegistration,
} from './types.js';
import { delayedRegistrationCapabilityOf } from './capability.js';

const ONCE_ALIASES = new Set([
  ...TRIGGER_ONCE_SCOPES,
  // Card IR uses this spelling for a one-shot qualifying event. It is
  // represented by a normal per-game frequency and an exact event filter.
  'next-qualifying-play',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isExprLike(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === 'string';
}

export function evaluated(ctx: ResolveContext, value: Expr | Value | undefined): Value | undefined {
  if (value === undefined) return undefined;
  return isExprLike(value) ? ctx.evaluate(value) : value;
}

function isObjectRef(value: unknown): value is ObjectRef {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    Number.isSafeInteger(value.zoneEntryId) && (value.zoneEntryId as number) >= 0;
}

function refKey(ref: ObjectRef): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

function uniqueRefs(values: readonly unknown[]): ObjectRef[] {
  const result: ObjectRef[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (isObjectRef(value)) {
      if (!seen.has(refKey(value))) {
        seen.add(refKey(value));
        result.push({ id: value.id, zoneEntryId: value.zoneEntryId });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (isRecord(value)) {
      for (const key of ['objects', 'object', 'ref']) if (key in value) visit(value[key]);
    }
  };
  values.forEach(visit);
  return result;
}

function refsFromPicks(ctx: ResolveContext, id: string): ObjectRef[] {
  return ctx.picks(id).flatMap(value => isObjectRef(value) ? [value] : []);
}

function resolveSelectorRefs(ctx: ResolveContext, selector: unknown): ObjectRef[] | null {
  if (selector === undefined) return [];
  if (typeof selector === 'string' && selector !== 'self' && selector !== 'source') return null;
  if (isObjectRef(selector)) return [selector];
  if (Array.isArray(selector)) return uniqueRefs(selector);
  if (isRecord(selector)) {
    if (typeof selector.target === 'string') return ctx.targets(selector.target);
    if (typeof selector.pick === 'string') return refsFromPicks(ctx, selector.pick);
    if (typeof selector.linked === 'string') return uniqueRefs([ctx.linked(selector.linked)]);
    if (typeof selector.event === 'string') {
      if (selector.event !== 'it' || typeof ctx.eventObject !== 'function') return null;
      const binding = ctx.eventObject('it');
      return binding === null ? null : [binding.ref];
    }
    if (selector.kind === 'query') {
      if (!isRecord(selector.filter)) return null;
      return ctx.query(selector.filter as ObjectFilter).map(object => object.ref);
    }
  }
  return null;
}

/** Resolve a locked object argument without selecting a new target. */
export function resolveLockedRefs(ctx: ResolveContext, value: Value | undefined): ObjectRef[] | null {
  if (value === undefined) return [];
  if (value === 'self' || value === 'source') return [ctx.source.ref];
  const refs = resolveSelectorRefs(ctx, value);
  return refs === null ? null : uniqueRefs(refs);
}

function numericCount(value: Value | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (Array.isArray(value)) return value.length;
  if (isRecord(value) && typeof value.count === 'number' && Number.isSafeInteger(value.count) && value.count >= 0) {
    return value.count;
  }
  if (isRecord(value) && Array.isArray(value.objects)) return value.objects.length;
  return null;
}

function normalizeFilter(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...value };
  // Several frozen card programs still use the legacy plural spelling.
  // Translate it into the closed ObjectFilter vocabulary at registration time;
  // the original card IR and public contract remain unchanged.
  if (output.type === undefined && output.types !== undefined) output.type = output.types;
  if (output.tags === undefined && output.tag !== undefined) output.tags = output.tag;
  delete output.types;
  delete output.tag;
  for (const key of ['controller', 'owner']) {
    if (output[key] === 'controller') output[key] = 'self';
  }
  const nested = isRecord(output.object) ? output.object : undefined;
  if (nested !== undefined) {
    const normalized: Record<string, unknown> = { ...nested };
    if (normalized.type === undefined && normalized.types !== undefined) normalized.type = normalized.types;
    if (normalized.tags === undefined && normalized.tag !== undefined) normalized.tags = normalized.tag;
    delete normalized.types;
    delete normalized.tag;
    for (const key of ['controller', 'owner']) {
      if (normalized[key] === 'controller') normalized[key] = 'self';
    }
    output.object = normalized;
  }
  return output;
}

function filterKind(value: Record<string, unknown>): string | undefined {
  const candidates = [value.event, value.kind, value.type];
  const kind = candidates.find(candidate => typeof candidate === 'string' &&
    (isTimingPointId(candidate) || candidate === 'card-played' || candidate === 'object-killed' || candidate === 'damage-dealt'));
  return typeof kind === 'string' ? kind : undefined;
}

function mergeLockedFilter(
  filter: Record<string, unknown>,
  ref: ObjectRef,
): Record<string, unknown> {
  const locked = { objectId: ref.id };
  if (filterKind(filter) !== undefined || isRecord(filter.object)) {
    return { ...filter, object: { ...(isRecord(filter.object) ? filter.object : {}), ...locked } };
  }
  // A bare object lock describes the event object role, which is an
  // ObjectFilter anchor rather than a scalar objectId.
  return { ...filter, object: locked };
}

function normalizeFilterValue(ctx: ResolveContext, value: Value): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const normalized = normalizeFilter(value);
  if (filterKind(normalized) !== undefined) {
    const validated = validateEventPattern(normalized);
    return validated.ok ? normalized : null;
  }
  if (Object.keys(normalized).length === 0) return normalized;
  const validated = validateObjectFilter(normalized);
  return validated.ok ? normalized : null;
}

function timingValue(value: Value): TimingPointId | null {
  if (typeof value !== 'string') return null;
  if (isTimingPointId(value)) return value;
  return resolveTimingPointId(value) ?? null;
}

function onceValue(value: Value | undefined): TriggerSpec['once'] | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ONCE_ALIASES.has(value)) return null;
  if (value === 'next-qualifying-play') return 'per-game';
  return value as TriggerSpec['once'];
}

function supportsOptions(ctx: ResolveContext): boolean {
  const candidate = ctx as DelayedRegistrationSink;
  return candidate.delayedRegistration?.version === 'riftbound.delayed-registration.v1' ||
    delayedRegistrationCapabilityOf(ctx) !== undefined;
}

function safeInstructionBody(value: Value): readonly Instruction[] | null {
  if (!Array.isArray(value) || !value.every(entry => isRecord(entry) &&
    typeof entry.id === 'string' && entry.id.length > 0 && typeof entry.op === 'string' && entry.op.length > 0 && isRecord(entry.args))) {
    return null;
  }
  return value as unknown as readonly Instruction[];
}

/** Materialize only the registration-owned output bindings used by its body. */
function bindRegistrationBody(
  body: readonly Instruction[],
  values: Readonly<Record<string, Value>>,
): readonly Instruction[] {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!isRecord(value)) return value;
    if (value.kind === 'linked' || value.kind === 'linked-value') {
      const key = typeof value.key === 'string' ? value.key : undefined;
      if (key !== undefined && Object.hasOwn(values, key)) return { kind: 'constant', value: values[key] };
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry)]));
  };
  return visit(body) as readonly Instruction[];
}

function durationValue(value: Value | undefined): DelayedDuration | undefined {
  return delayedDuration(value);
}

function relativeWindow(raw: Value | undefined): 'next-main-phase' | 'next-combat-phase' | undefined {
  return raw === 'next-main-phase' || raw === 'next-combat-phase' ? raw : undefined;
}

function eventPatternKind(value: Record<string, unknown>): TimingPointId | null {
  const kind = value.event ?? value.type ?? value.kind;
  return typeof kind === 'string' ? timingValue(kind) : null;
}

function bindRelativeWindowFilter(
  ctx: ResolveContext,
  at: TimingPointId,
  window: 'next-main-phase' | 'next-combat-phase',
  filter: Record<string, unknown>,
): Record<string, unknown> | null {
  const expectedAt: TimingPointId = window === 'next-main-phase' ? 'main-start' : 'combat-start';
  if (at !== expectedAt) return null;
  const kind = eventPatternKind(filter);
  if (kind !== null && kind !== expectedAt) return null;
  const hasPatternFields = ['event', 'type', 'kind', 'player', 'source', 'target', 'it', 'fromZone', 'toZone', 'amount', 'details']
    .some(key => Object.hasOwn(filter, key));
  if (hasPatternFields) {
    const player = filter.player;
    if (player !== undefined && player !== 'self') return null;
    return { event: expectedAt, ...filter, player: 'self' };
  }
  // `next-main-phase` names the controller's next Main Phase. The pipeline
  // expiry fires after the same wave's scan, so this filter both admits the
  // opening and prevents an opponent's Main Phase from consuming the window.
  return {
    event: expectedAt,
    player: 'self',
    ...(Object.keys(filter).length === 0 ? {} : { object: filter }),
  };
}

/**
 * Build and install one delayed trigger declaration. The card instruction
 * evaluates every value at registration, so a later source move/control
 * change cannot alter the trigger's host, controller, filter, or body.
 */
export function registerPreparedDelayedTrigger(
  ctx: ResolveContext,
  declaration: DelayedTriggerDeclaration,
): { readonly result: PreparedDelayedRegistration | null; readonly count?: number; readonly refs: readonly ObjectRef[] } {
  const atValue = evaluated(ctx, declaration.at);
  const bodyValue = evaluated(ctx, declaration.body);
  const at = timingValue(atValue ?? null);
  const body = bodyValue === undefined ? null : safeInstructionBody(bodyValue);
  if (at === null || body === null) return { result: null, refs: [] };

  let filterValue: Value = {};
  if (declaration.filter !== undefined) {
    const value = evaluated(ctx, declaration.filter);
    if (value === undefined || !normalizeFilterValue(ctx, value)) return { result: null, refs: [] };
    filterValue = normalizeFilterValue(ctx, value)! as unknown as Value;
  } else if (declaration.eventFilter !== undefined) {
    const value = evaluated(ctx, declaration.eventFilter);
    if (value === undefined) return { result: null, refs: [] };
    const event = validateEventPattern(value);
    if (!event.ok) return { result: null, refs: [] };
    filterValue = event.value as EventPattern as unknown as Value;
  }

  const rawDuration = evaluated(ctx, declaration.duration);
  const rawWindow = evaluated(ctx, declaration.window);
  if (rawDuration !== undefined && rawWindow !== undefined) return { result: null, refs: [] };
  const duration = durationValue(rawDuration ?? rawWindow);
  if ((rawDuration !== undefined || rawWindow !== undefined) && duration === undefined) {
    return { result: null, refs: [] };
  }
  const relative = relativeWindow(rawDuration ?? rawWindow);
  if (relative !== undefined) {
    const bound = bindRelativeWindowFilter(ctx, at, relative, normalizeFilter(filterValue as Record<string, unknown>));
    if (bound === null || normalizeFilterValue(ctx, bound as Value) === null) {
      return { result: null, refs: [] };
    }
    filterValue = bound as Value;
  }
  const rawOnce = evaluated(ctx, declaration.once);
  const once = onceValue(rawOnce);
  if (once === null) return { result: null, refs: [] };

  const rawUses = evaluated(ctx, declaration.uses);
  if (rawUses !== undefined && rawDuration === undefined && rawWindow === undefined) {
    throw new TypeError('trigger.delayed uses requires a duration or window');
  }
  const parsedUses = rawUses === undefined ? 1 : numericCount(rawUses);
  if (parsedUses === null || parsedUses === undefined || parsedUses < 1) return { result: null, refs: [] };
  const uses: number = parsedUses;
  if (uses > 1 && ctx.timingPoint !== 'chain-item-resolve') {
    // The sink's maxPerScope is consumed by the trigger scanner. Do not claim
    // a repeated-use window from a context that cannot provide the full chain
    // resolution lifecycle.
    return { result: null, refs: [] };
  }

  const objectValue = evaluated(ctx, declaration.objects);
  const targetValue = evaluated(ctx, declaration.target);
  if (objectValue !== undefined && targetValue !== undefined) return { result: null, refs: [] };
  const objectRequested = objectValue !== undefined || targetValue !== undefined;
  const locked = resolveLockedRefs(ctx, objectValue ?? targetValue);
  if (locked === null) {
    throw new TypeError('Unsupported trigger.delayed argument value: objects/target');
  }
  if (objectRequested && locked.length === 0) {
    return { result: null, refs: [] };
  }

  // `referent` is an object identity whose semantics are not supplied by the
  // frozen ResolveContext. Do not silently turn a printed reference into an
  // arbitrary objectId; the owning card task must provide a real binding.
  const referent = evaluated(ctx, declaration.referent);
  if (referent !== undefined) throw new TypeError('Unsupported trigger.delayed argument value: referent');

  const rawCount = evaluated(ctx, declaration.count);
  const count = rawCount === undefined ? undefined : numericCount(rawCount);
  if (count === null) throw new TypeError('Unsupported trigger.delayed argument value: count');

  const boundBody = bindRegistrationBody(body, {
    ...(count === undefined ? {} : { count }),
    ...(locked.length === 0 ? {} : { objects: locked as unknown as Value }),
  });

  const expiresAt = relative === undefined ? delayedExpiresAt(duration) : undefined;
  const needsExtendedOptions = duration !== undefined || uses > 1 || locked.length > 0;
  if (needsExtendedOptions && !supportsOptions(ctx)) {
    return { result: null, refs: locked };
  }

  if (duration?.kind === 'this-turn' && isTimingPointPassed(ctx.timingPoint, DELAYED_EXPIRES_AT)) {
    return { result: null, refs: locked };
  }

  const effectiveOnce = once ?? (duration !== undefined || uses > 1 || locked.length > 0 ? 'per-game' : undefined);
  if (uses > 1 && effectiveOnce === 'per-turn' && duration?.kind !== 'this-turn') {
    return { result: null, refs: locked };
  }
  if (uses > 1 && duration === undefined) {
    return { result: null, refs: locked };
  }
  if (effectiveOnce === undefined) return { result: null, refs: locked };

  const refsToRegister = locked.length === 0 ? [undefined] : locked;
  const prepared: PreparedDelayedRegistration[] = [];
  for (const ref of refsToRegister) {
    const filter = ref === undefined
      ? normalizeFilterValue(ctx, filterValue as Value)
      : normalizeFilterValue(ctx, mergeLockedFilter(normalizeFilter(filterValue as Record<string, unknown>), ref) as Value);
    if (filter === null) return { result: null, refs: locked };
    const spec: TriggerSpec = {
      at,
      filter: filter as ObjectFilter,
      ...(effectiveOnce === undefined ? {} : { once: effectiveOnce }),
    };
    try {
      assertTriggerSpec(spec);
    } catch {
      return { result: null, refs: locked };
    }
    const options: DelayedRegistrationOptions | undefined = needsExtendedOptions
      ? {
        ...(expiresAt === undefined ? {} : { expiresAt }),
        ...(relative === undefined ? {} : {
          expireOn: {
            timingPoint: relative === 'next-main-phase' ? 'main-start' : 'combat-start',
            player: ctx.controller,
          },
        }),
        ...(uses > 1 ? { maxPerScope: uses } : {}),
        ...(locked.length === 0 ? {} : { lockedRefs: locked }),
        filter: filter as Readonly<Record<string, unknown>>,
        source: structuredClone(ctx.source),
        controller: ctx.controller,
      }
      : undefined;
    const registration: PreparedDelayedRegistration = {
      spec,
      body: boundBody,
      ...(duration === undefined ? {} : { duration }),
      ...(options === undefined ? {} : { options }),
      ...(count === undefined ? {} : { count }),
      lockedRefs: ref === undefined ? [] : [ref],
      filter,
    };
    prepared.push(registration);
  }
  const extended = ctx as DelayedRegistrationSink;
  const capability = delayedRegistrationCapabilityOf(ctx) ?? extended.delayedRegistration;
  const checkpoint = capability?.checkpoint();
  for (const registration of prepared) {
    if (registration.options !== undefined && capability !== undefined) {
      try {
        capability.register(registration.spec, registration.body, {
          ...registration.options,
          source: structuredClone(ctx.source),
          controller: ctx.controller,
        });
      } catch (error) {
        capability.restore(checkpoint);
        throw error;
      }
    } else {
      ctx.registerDelayedTrigger(registration.spec, registration.body);
    }
  }

  const linked = {
    at,
    filter: prepared[0]?.filter ?? filterValue,
    ...(duration === undefined ? {} : { duration }),
    ...(effectiveOnce === undefined ? {} : { once: effectiveOnce }),
    ...(uses > 1 ? { uses } : {}),
    ...(count === undefined ? {} : { count }),
    ...(locked.length === 0 ? {} : { objects: locked }),
    registeredAt: ctx.timingPoint,
  } as unknown as Value;
  ctx.link('registered', linked);
  if (count !== undefined) ctx.link('count', count);
  if (locked.length > 0) ctx.link('objects', locked as unknown as Value);
  return { result: prepared[0] ?? null, ...(count === undefined ? {} : { count }), refs: locked };
}

const TIMING_ORDER = [
  'turn-start', 'awaken-start', 'awaken-end', 'beginning-start', 'beginning-end',
  'channel-start', 'channel-end', 'draw-start', 'draw-end', 'main-start', 'main-end',
  'turn-end', 'cleanup-start', 'cleanup-end',
] as const;

function isTimingPointPassed(current: TimingPointId, expiry: TimingPointId): boolean {
  return TIMING_ORDER.indexOf(current as never) >= TIMING_ORDER.indexOf(expiry as never);
}
