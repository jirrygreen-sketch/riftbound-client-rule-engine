import type {
  Condition,
  Expr,
  Instruction,
  InstructionDef,
  InstructionResult,
  ObjectFilter,
  ObjectRef,
  ObjectSnapshot,
  ResolveContext,
  Schema,
  Value,
} from '../contract.js';
import { matchesObjectPredicates } from '../filters/predicates.js';
import { MissingInformation } from '../interpreter/values.js';
import { normalizeReflexiveBody, rewriteReflexiveLinks } from '../reflexive/body.js';
import { reflexivePendingRuntimeFor, reflexiveLinkValue } from '../reflexive/runtime.js';

export interface ParsedReflexiveArgs {
  readonly at?: Expr;
  readonly body: Expr;
  readonly condition?: Expr;
  readonly filter?: Expr;
  readonly objects?: Expr;
  readonly burned?: Expr;
  readonly count?: Expr;
  readonly link?: Expr;
  readonly linkKey?: Expr;
}

const ARGUMENTS = new Set([
  'at', 'body', 'condition', 'filter', 'objects', 'burned', 'count', 'link', 'linkKey',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isExpr = (value: unknown): value is Expr =>
  isRecord(value) && typeof value.kind === 'string' && value.kind.length > 0;

function parseArgs(value: unknown): ParsedReflexiveArgs {
  if (!isRecord(value)) throw new TypeError('trigger.reflexive args must be an object');
  for (const key of Object.keys(value)) {
    if (!ARGUMENTS.has(key)) throw new TypeError(`Invalid trigger.reflexive argument: ${key}`);
    if (!isExpr(value[key])) throw new TypeError(`trigger.reflexive ${key} must be an Expr`);
  }
  if (value.body === undefined) throw new TypeError('trigger.reflexive requires body');
  if (value.objects !== undefined && value.burned !== undefined) {
    throw new TypeError('trigger.reflexive accepts objects or burned, not both');
  }
  if (value.link !== undefined && value.linkKey !== undefined) {
    throw new TypeError('trigger.reflexive accepts link or linkKey, not both');
  }
  return value as unknown as ParsedReflexiveArgs;
}

const argsSchema: Schema<ParsedReflexiveArgs> = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try { return { success: true, data: parseArgs(value) }; }
    catch (error) { return { success: false, error }; }
  },
};

function negated(): InstructionResult {
  return { status: 'negated', reason: 'impossible', events: [] };
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function collectRefs(value: unknown, output: ObjectRef[], seen = new Set<string>()): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectRefs(entry, output, seen);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.id === 'string' && Number.isSafeInteger(value.zoneEntryId) &&
      (value.zoneEntryId as number) >= 0) {
    const ref = { id: value.id, zoneEntryId: value.zoneEntryId as number };
    const key = `${ref.id}:${ref.zoneEntryId}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(ref);
    }
    return;
  }
  for (const entry of Object.values(value)) collectRefs(entry, output, seen);
}

function currentIncarnation(ctx: ResolveContext, ref: ObjectRef): ObjectRef {
  const exact = ctx.object(ref);
  if (exact !== null) return exact.ref;
  const current = ctx.query({ objectId: ref.id });
  return current[0]?.ref ?? ref;
}

function candidateSnapshot(ctx: ResolveContext, ref: ObjectRef): ObjectSnapshot {
  return ctx.object(ref) ?? ctx.lastKnown(ref);
}

function objectFilter(value: unknown): ObjectFilter | undefined {
  if (!isRecord(value)) return undefined;
  const nested = isRecord(value.filter) ? value.filter : undefined;
  const merged = { ...(nested ?? {}), ...value };
  delete merged.event;
  delete merged.kind;
  delete merged.filter;
  return merged as ObjectFilter;
}

function conditionObject(value: unknown): Condition | undefined {
  return isRecord(value) && typeof value.kind === 'string' ? value as unknown as Condition : undefined;
}

function selectorSnapshots(ctx: ResolveContext, selector: unknown): ObjectSnapshot[] {
  if (selector === 'self' || selector === 'source') return [ctx.source];
  if (!isRecord(selector)) return [];
  if (typeof selector.target === 'string') return ctx.targets(selector.target).flatMap(ref => {
    const object = ctx.object(ref);
    return object === null ? [] : [object];
  });
  if (typeof selector.pick === 'string') return ctx.picks(selector.pick).flatMap(value => {
    if (!isRecord(value) || typeof value.id !== 'string' || !Number.isSafeInteger(value.zoneEntryId)) return [];
    const object = ctx.object({ id: value.id, zoneEntryId: value.zoneEntryId as number });
    return object === null ? [] : [object];
  });
  if (typeof selector.linked === 'string') {
    const refs: ObjectRef[] = [];
    collectRefs(ctx.linked(selector.linked), refs);
    return refs.flatMap(ref => {
      const object = ctx.object(ref);
      return object === null ? [] : [object];
    });
  }
  return [];
}

function matchesCandidate(ctx: ResolveContext, snapshot: ObjectSnapshot, filter: ObjectFilter | undefined): boolean {
  if (filter === undefined || Object.keys(filter).length === 0) return true;
  return matchesObjectPredicates(filter, snapshot, {
    controller: ctx.controller,
    anchor: ctx.source,
    references: selector => selectorSnapshots(ctx, selector),
  });
}

function evaluateCondition(ctx: ResolveContext, value: Value | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === 'boolean') return value;
  const condition = conditionObject(value);
  if (condition === undefined) throw new TypeError('trigger.reflexive condition must evaluate to boolean or Condition');
  return ctx.test(condition);
}

function evaluateCount(ctx: ResolveContext, expression: Expr | undefined): number {
  if (expression === undefined) return 1;
  const value = ctx.evaluate(expression);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('trigger.reflexive count must be a non-negative safe integer');
  }
  return value;
}

function evaluateBody(ctx: ResolveContext, expression: Expr): readonly Instruction[] {
  const value = ctx.evaluate(expression);
  const body = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.reflexiveInstructions)
      ? value.reflexiveInstructions
      : undefined;
  if (body === undefined) throw new TypeError('trigger.reflexive body must evaluate to an instruction array');
  for (const instruction of body) {
    if (!isRecord(instruction) || typeof instruction.id !== 'string' || instruction.id.length === 0 ||
        typeof instruction.op !== 'string' || instruction.op.length === 0 || !isRecord(instruction.args)) {
      throw new TypeError('trigger.reflexive body contains an invalid instruction');
    }
  }
  return body as unknown as readonly Instruction[];
}

function evaluateLinkKey(ctx: ResolveContext, args: ParsedReflexiveArgs): string | undefined {
  const expression = args.link ?? args.linkKey;
  if (expression === undefined) return undefined;
  const value = ctx.evaluate(expression);
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('trigger.reflexive link key must be a non-empty string');
  }
  return value;
}

function evaluateOptionalString(ctx: ResolveContext, expression: Expr | undefined, label: string): string | undefined {
  if (expression === undefined) return undefined;
  const value = ctx.evaluate(expression);
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`trigger.reflexive ${label} must be a non-empty string`);
  return value;
}

const triggerReflexive: InstructionDef<ParsedReflexiveArgs> = {
  op: 'trigger.reflexive',
  argsSchema,
  execute(ctx, args): InstructionResult {
    const runtime = reflexivePendingRuntimeFor(ctx.source);
    if (runtime === undefined) return negated();

    let body: readonly Instruction[];
    let objects: Value | undefined;
    let filter: ObjectFilter | undefined;
    let conditionResult: boolean;
    let count: number;
    let linkKey: string | undefined;
    let event: string | undefined;
    try {
      body = evaluateBody(ctx, args.body);
      objects = args.objects === undefined && args.burned === undefined
        ? undefined
        : ctx.evaluate((args.objects ?? args.burned)!);
      filter = args.filter === undefined ? undefined : objectFilter(ctx.evaluate(args.filter));
      conditionResult = evaluateCondition(ctx, args.condition === undefined ? undefined : ctx.evaluate(args.condition));
      count = evaluateCount(ctx, args.count);
      linkKey = evaluateLinkKey(ctx, args);
      event = evaluateOptionalString(ctx, args.at, 'at');
    } catch (error) {
      // Direct primitive harnesses receive an evaluated object while the
      // production interpreter passes Expr envelopes. Re-evaluate the same
      // fields without the envelope so both entry points exercise one schema.
      if (error instanceof MissingInformation) return negated();
      if (isRecord(args.body) && !('kind' in args.body)) {
        body = args.body as unknown as readonly Instruction[];
        objects = args.objects === undefined && args.burned === undefined
          ? undefined
          : (args.objects ?? args.burned) as unknown as Value;
        filter = isRecord(args.filter) ? objectFilter(args.filter) : undefined;
        conditionResult = evaluateCondition(ctx, args.condition as unknown as Value | undefined);
        count = args.count === undefined ? 1 : args.count as unknown as number;
        if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('trigger.reflexive count must be a non-negative safe integer');
        linkKey = (args.link ?? args.linkKey) as string | undefined;
        if (linkKey !== undefined && (typeof linkKey !== 'string' || linkKey.length === 0)) throw new TypeError('trigger.reflexive link key must be a non-empty string');
        event = args.at as string | undefined;
        if (event !== undefined && (typeof event !== 'string' || event.length === 0)) throw new TypeError('trigger.reflexive at must be a non-empty string');
      } else {
        throw error;
      }
    }
    if (!conditionResult || count === 0) {
      return { status: 'executed', events: [], linkedValues: { created: 0, reflexiveItemIds: [] } };
    }

    const candidateRefs: ObjectRef[] = [];
    collectRefs(objects, candidateRefs);
    const candidates = candidateRefs.map(ref => currentIncarnation(ctx, ref));
    const matched = candidates.filter(ref => matchesCandidate(ctx, candidateSnapshot(ctx, ref), filter));
    if (objects !== undefined && matched.length === 0) {
      return { status: 'executed', events: [], linkedValues: { created: 0, reflexiveItemIds: [] } };
    }
    if (matched.length > 0 && count > matched.length) {
      throw new TypeError('trigger.reflexive count exceeds matched objects');
    }
    const effectiveCount = matched.length > 0 ? matched.length : count;
    if (effectiveCount === 0) {
      return { status: 'executed', events: [], linkedValues: { created: 0, reflexiveItemIds: [] } };
    }

    const normalized = normalizeReflexiveBody(body);
    const requests = [];
    for (let index = 0; index < effectiveCount; index++) {
      const matchedRef = matched[index];
      const linkValue: Value | undefined = matchedRef === undefined
        ? undefined
        : { id: matchedRef.id, zoneEntryId: matchedRef.zoneEntryId };
      const ordinal = index + 1;
      const alias = linkKey === undefined
        ? undefined
        : `reflexive:${ctx.source.ref.id}:${ctx.source.ref.zoneEntryId}:${encodeURIComponent(linkKey)}:${ordinal}`;
      const linkedBody = alias === undefined
        ? structuredClone(normalized.body)
        : rewriteReflexiveLinks(structuredClone(normalized.body), linkKey!, alias) as readonly Instruction[];
      if (alias !== undefined) ctx.link(alias, reflexiveLinkValue(linkValue));
      const snapshot = {
        timingPoint: ctx.timingPoint,
        controller: ctx.controller,
        source: structuredClone(ctx.source),
        ...(event === undefined ? {} : { event }),
        ...(filter === undefined ? {} : { filter: structuredClone(filter) as Readonly<Record<string, Value>> }),
        matched: structuredClone(matched),
        conditionResult,
      };
      requests.push({
        source: ctx.source,
        controller: ctx.controller,
        body: linkedBody,
        mayAtFinalize: normalized.mayAtFinalize,
        snapshot,
        ...(linkKey === undefined ? {} : { linkKey }),
        ...(linkValue === undefined ? {} : { linkValue: structuredClone(linkValue) }),
        ...(alias === undefined ? {} : { linkedValues: { [alias]: reflexiveLinkValue(linkValue) } }),
        ordinal,
      });
    }
    const created = runtime.createAll(requests).map(creation => creation.id);
    return {
      status: 'executed',
      events: [],
      linkedValues: { created: created.length, reflexiveItemIds: created },
    };
  },
};

export default triggerReflexive;
