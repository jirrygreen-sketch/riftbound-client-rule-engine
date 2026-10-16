import type { Value } from "../contract.js";

export class MissingInformation extends Error {}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

export function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function asValue(value: unknown): Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(asValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asValue(item)]));
  }
  throw new Error("Expected a finite JSON value");
}

export function equalValues(left: Value, right: Value): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equalValues(value, right[index]!));
  }
  if (left !== null && right !== null && typeof left === "object" && typeof right === "object"
    && !Array.isArray(left) && !Array.isArray(right)) {
    const leftRecord = left as Readonly<Record<string, Value>>;
    const rightRecord = right as Readonly<Record<string, Value>>;
    const keys = Object.keys(leftRecord);
    return keys.length === Object.keys(rightRecord).length
      && keys.every(key => Object.hasOwn(rightRecord, key) && equalValues(leftRecord[key]!, rightRecord[key]!));
  }
  return false;
}

export function compareValues(left: Value, operator: unknown, right: Value): boolean {
  switch (operator) {
    case "eq": return equalValues(left, right);
    case "ne": return !equalValues(left, right);
    case "in": return Array.isArray(right) && right.some(value => equalValues(left, value));
    case "lt": case "lte": case "gt": case "gte": {
      if (left === null || right === null) throw new MissingInformation("Cannot order null values");
      if (typeof left !== "number" || typeof right !== "number") throw new Error("Ordered comparisons require numbers");
      if (operator === "lt") return left < right;
      if (operator === "lte") return left <= right;
      if (operator === "gt") return left > right;
      return left >= right;
    }
    default: throw new Error(`Unsupported comparison: ${String(operator)}`);
  }
}

export function arithmetic(operator: unknown, operands: readonly Value[]): number {
  const numbers = operands.map(value => {
    if (value === null) throw new MissingInformation("Cannot calculate with a null characteristic");
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Arithmetic requires finite numbers");
    return value;
  });
  if (numbers.length === 0) throw new Error("Arithmetic requires operands");
  let result: number;
  switch (operator) {
    case "add": result = numbers.reduce((sum, value) => sum + value, 0); break;
    case "mul":
    case "multiply": result = numbers.reduce((product, value) => product * value, 1); break;
    case "neg": {
      if (numbers.length !== 1) throw new Error("neg requires one operand");
      result = -numbers[0]!;
      break;
    }
    case "sub":
    case "subtract":
    case "div":
    case "divide": {
      if (numbers.length !== 2) throw new Error(`${operator} requires two operands`);
      const subtract = operator === "sub" || operator === "subtract";
      if (!subtract && numbers[1] === 0) throw new Error("Division by zero");
      result = subtract ? numbers[0]! - numbers[1]! : numbers[0]! / numbers[1]!;
      break;
    }
    case "min": result = Math.min(...numbers); break;
    case "max": result = Math.max(...numbers); break;
    default: throw new Error(`Unsupported arithmetic: ${String(operator)}`);
  }
  if (!Number.isFinite(result)) throw new Error("Arithmetic result must be finite");
  return result;
}
