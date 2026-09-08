"use client";
import { Children, isValidElement, useEffect, useState, type ReactNode } from "react";

const tabs = [ ["workspace", "Workspace"], ["team", "People & access"], ["sales", "Sales"], ["delivery", "Live projects"], ["ai", "AI & connections"], ["system", "Data & updates"] ];
export function SettingsSections({ children }: { children: ReactNode }) {
  const [active, setActive] = useState("workspace");
  useEffect(() => {
    function sync() {
      const url = new URL(window.location.href);
      const requested = url.searchParams.get("tab") ?? (url.hash.includes("ai") ? "ai" : url.hash === "#import" ? "system" : "workspace");
      if (tabs.some(([id]) => id === requested)) setActive(requested);
    }
    queueMicrotask(sync); window.addEventListener("popstate", sync); window.addEventListener("hashchange", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("hashchange", sync); };
  }, []);
  function select(id: string) { setActive(id); const url = new URL(window.location.href); url.searchParams.set("tab", id); url.hash = ""; window.history.replaceState(null, "", url); }
  return <><div className="settings-tabs" role="tablist" aria-label="Settings sections">{tabs.map(([id, label], index) => <button key={id} type="button" role="tab" id={`settings-tab-${id}`} aria-controls={`settings-panel-${id}`} aria-selected={active === id} tabIndex={active === id ? 0 : -1} onClick={() => select(id)} onKeyDown={(e) => {
    const next = e.key === "ArrowRight" ? (index + 1) % tabs.length : e.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next >= 0) { e.preventDefault(); select(tabs[next][0]); document.getElementById(`settings-tab-${tabs[next][0]}`)?.focus(); }
  }}>{label}</button>)}</div>{tabs.map(([id]) => <section key={id} className="settings-grid" role="tabpanel" id={`settings-panel-${id}`} aria-labelledby={`settings-tab-${id}`} hidden={id !== active}>{Children.toArray(children).filter((child) => isValidElement<{ "data-settings-tab"?: string }>(child) && (child.props["data-settings-tab"] ?? "workspace") === id)}</section>)}</>;
}
