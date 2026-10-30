import { useSyncExternalStore } from "react";

const STORAGE_KEY = "yanxin.simple-mode";

function savedSimpleMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let current = savedSimpleMode();
const listeners = new Set<() => void>();

function applySimpleMode() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.simpleMode = current ? "true" : "false";
}

applySimpleMode();

if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (event.key !== STORAGE_KEY) return;
    const next = savedSimpleMode();
    if (next === current) return;
    current = next;
    applySimpleMode();
    listeners.forEach(listener => listener());
  });
}

export function simpleModeEnabled(): boolean {
  return current;
}

export function subscribeSimpleMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSimpleMode(enabled: boolean) {
  if (current === enabled) return;
  current = enabled;
  applySimpleMode();
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // 存储不可用时仍对当前页面生效
  }
  listeners.forEach(listener => listener());
}

export function useSimpleMode(): boolean {
  return useSyncExternalStore(
    subscribeSimpleMode,
    () => current,
    () => false,
  );
}
