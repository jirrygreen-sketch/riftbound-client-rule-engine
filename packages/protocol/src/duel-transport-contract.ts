/** Explicit transport union. Each individual historical guard remains exact. */
import { isDuelCommandMessage, isDuelProjectionAny, isDuelProjectionMessageAny,
  type DuelCommandMessage, type DuelProjectionAny, type DuelProjectionMessageAny } from './duel-contract.js';
import { isDuelCommandMessageV3Actions1, isDuelProjectionV3Actions1,
  isDuelProjectionMessageV3Actions1, type DuelCommandMessageV3Actions1,
  type DuelProjectionV3Actions1, type DuelProjectionMessageV3Actions1 } from './duel-actions-contract-v3.js';

export type DuelCommandTransport = DuelCommandMessage | DuelCommandMessageV3Actions1;
export type DuelProjectionTransport = DuelProjectionAny | DuelProjectionV3Actions1;
export type DuelProjectionMessageTransport = DuelProjectionMessageAny | DuelProjectionMessageV3Actions1;

export function isDuelCommandTransport(value: unknown): value is DuelCommandTransport {
  return isDuelCommandMessage(value) || isDuelCommandMessageV3Actions1(value);
}
export function isDuelProjectionTransport(value: unknown): value is DuelProjectionTransport {
  return isDuelProjectionAny(value) || isDuelProjectionV3Actions1(value);
}
export function isDuelProjectionMessageTransport(value: unknown): value is DuelProjectionMessageTransport {
  return isDuelProjectionMessageAny(value) || isDuelProjectionMessageV3Actions1(value);
}
