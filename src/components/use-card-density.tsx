"use client";

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";
import { cardDensityKey, isCompactDensity, type DensityPage } from "@/lib/domain/card-density";

const MemberKeyContext = createContext<string | null>(null);
const changeEvent = "gud:card-density-changed";
// Keep controls usable if storage is blocked or full. No CRM data is stored here.
const unsavedPreferences = new Map<string, boolean>();
const comfortableOnServer = () => false;

export function CardDensityProvider({ memberKey, children }: { memberKey: string; children: ReactNode }) {
  return <MemberKeyContext.Provider value={memberKey}>{children}</MemberKeyContext.Provider>;
}

/** Each page remembers its own density for this account and browser. */
export function useCardDensity(page: DensityPage) {
  const memberKey = useContext(MemberKeyContext);
  if (!memberKey) throw new Error("Card density needs the signed-in member context.");
  const key = cardDensityKey(memberKey, page);
  const subscribe = useCallback((onChange: () => void) => {
    const localChange = (event: Event) => { if ((event as CustomEvent<string>).detail === key) onChange(); };
    const otherTabChange = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      unsavedPreferences.delete(key);
      onChange();
    };
    window.addEventListener(changeEvent, localChange);
    window.addEventListener("storage", otherTabChange);
    return () => {
      window.removeEventListener(changeEvent, localChange);
      window.removeEventListener("storage", otherTabChange);
    };
  }, [key]);
  const snapshot = useCallback(() => {
    if (unsavedPreferences.has(key)) return unsavedPreferences.get(key)!;
    try { return isCompactDensity(window.localStorage.getItem(key)); }
    catch { return false; }
  }, [key]);
  const compact = useSyncExternalStore(subscribe, snapshot, comfortableOnServer);
  const setCompact = useCallback((value: boolean) => {
    try {
      window.localStorage.setItem(key, value ? "compact" : "comfortable");
      unsavedPreferences.delete(key);
    } catch { unsavedPreferences.set(key, value); }
    window.dispatchEvent(new CustomEvent(changeEvent, { detail: key }));
  }, [key]);
  return [compact, setCompact] as const;
}
