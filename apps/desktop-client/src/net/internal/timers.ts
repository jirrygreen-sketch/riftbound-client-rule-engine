export function setTimer(callback: () => void, delay: number): number {
  return globalThis.setTimeout(callback, delay) as unknown as number;
}

export function clearTimer(handle: number): void {
  globalThis.clearTimeout(handle);
}

export function setInterval(callback: () => void, delay: number): number {
  return globalThis.setInterval(callback, delay) as unknown as number;
}

export function clearIntervalTimer(handle: number): void {
  globalThis.clearInterval(handle);
}
