/** Public room selection; release schedule and provenance remain server-owned. */
export interface ConstructedRegionSelection {
  readonly regionCode: string;
  /** Event-local calendar date; never inferred from a client timezone. */
  readonly eventDate: string;
}
export interface ConstructedRegionContext extends ConstructedRegionSelection {
  readonly policyVersion: string;
  readonly scheduleVersion: string;
  readonly scheduleDigest: string;
}
function data(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)) &&
    keys.every(key => { const d = Object.getOwnPropertyDescriptor(value, key); return d && 'value' in d; });
}
export function isConstructedEventDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d || m > 12) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= lengths[m - 1]!;
}
export function isConstructedRegionSelection(value: unknown): value is ConstructedRegionSelection {
  return data(value, ['regionCode', 'eventDate']) && typeof value.regionCode === 'string' &&
    /^[A-Z][A-Z0-9-]{1,15}$/.test(value.regionCode) && isConstructedEventDate(value.eventDate);
}
export function isConstructedRegionContext(value: unknown): value is ConstructedRegionContext {
  if (!data(value, ['regionCode', 'eventDate', 'policyVersion', 'scheduleVersion', 'scheduleDigest'])) return false;
  return isConstructedRegionSelection({regionCode: value.regionCode, eventDate: value.eventDate}) &&
    ['policyVersion', 'scheduleVersion'].every(key => typeof value[key] === 'string' &&
      (value[key] as string).length > 0 && (value[key] as string).length <= 128) &&
    typeof value.scheduleDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.scheduleDigest);
}
