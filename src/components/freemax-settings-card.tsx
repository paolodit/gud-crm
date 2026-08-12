"use client";

import { Check, ExternalLink, KeyRound, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { saveFreeMaxConfigurationAction } from "@/app/actions/workspace";
import type { FreeMaxProvider, FreeMaxStatus } from "@/lib/enrichment/freemax";

export function FreeMaxSettingsCard({ status, canManage, context = "settings" }: { status: FreeMaxStatus; canManage: boolean; context?: "settings" | "targets" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [primary, setPrimary] = useState<FreeMaxProvider>(status.order[0] ?? "hunter");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const result = await saveFreeMaxConfigurationAction({
      hunterKey: form.get("hunterKey"),
      norbertKey: form.get("norbertKey"),
      disconnectHunter: form.get("disconnectHunter") === "on",
      disconnectNorbert: form.get("disconnectNorbert") === "on",
      primary,
    });
    setPending(false);
    if (!result.ok) return setMessage(result.error);
    setMessage("Provider setup saved. New lookups use it immediately.");
    router.refresh();
  }

  return (
    <article className={`surface settings-card settings-card-wide enrichment-settings-card enrichment-settings-card-live${context === "targets" ? " target-enrichment-card" : ""}`} id="freemax">
      <div className="settings-icon settings-icon-enrichment"><Sparkles /></div>
      <div><h2>{context === "targets" ? "Find a work email" : "FreeMax enrichment"}</h2><p>Use Hunter and Voila Norbert only after you have a named contact and company domain</p></div>
      {canManage ? <button className="btn btn-primary settings-card-action" type="button" onClick={() => setOpen((value) => !value)}><KeyRound size={14} />{open ? "Close setup" : "Manage providers"}</button> : null}
      <div className="enrichment-provider-grid">
        <div data-ready={status.hunter.configured}><span><strong>Hunter {status.order[0] === "hunter" ? "· First" : ""}</strong><small>Monthly free allowance</small></span><b>{status.hunter.configured ? `${status.hunter.used}/${status.hunter.limit} used` : "Not connected"}</b></div>
        <div data-ready={status.norbert.configured}><span><strong>Voila Norbert {status.order[0] === "norbert" ? "· First" : ""}</strong><small>Starter allowance</small></span><b>{status.norbert.configured ? `${status.norbert.used}/${status.norbert.limit} used` : "Not connected"}</b></div>
      </div>
      <div className="freemax-workflow" hidden={context === "targets" && !open}>
        <span><b>1</b><small>Research a real person and company domain</small></span>
        <span><b>2</b><small>Click Find work email in Research</small></span>
        <span><b>3</b><small>GUD stays inside connected providers and safety caps</small></span>
      </div>
      <p className="freemax-explainer"><ShieldCheck size={15} /><span>{context === "targets" ? "GUD tries your preferred provider first and falls back only when needed. Keys stay encrypted server-side." : "Keys are encrypted with this deployment’s secret and are never sent back to the browser. Successful lookups are counted here; provider dashboards remain authoritative."}</span></p>
      {open && canManage ? (
        <form className="freemax-key-form" onSubmit={submit}>
          <header><div><strong>Connect or switch providers</strong><small>Paste a new key only when adding or replacing it. Blank fields keep the current key.</small></div><div className="button-row"><a className="btn btn-quiet btn-compact" href="https://hunter.io/users/sign_up" target="_blank" rel="noreferrer">Hunter <ExternalLink size={13} /></a><a className="btn btn-quiet btn-compact" href="https://www.voilanorbert.com/" target="_blank" rel="noreferrer">Norbert <ExternalLink size={13} /></a></div></header>
          <div className="freemax-key-grid">
            <label className="field-label">Hunter API key<input className="field" name="hunterKey" type="password" autoComplete="off" placeholder={status.hunter.configured ? "Connected · paste to replace" : "Paste Hunter key"} /></label>
            <label className="field-label">Voila Norbert API key<input className="field" name="norbertKey" type="password" autoComplete="off" placeholder={status.norbert.configured ? "Connected · paste to replace" : "Paste Norbert key"} /></label>
          </div>
          <fieldset className="provider-order"><legend>Try first</legend>{(["hunter", "norbert"] as FreeMaxProvider[]).map((provider) => <label key={provider} data-selected={primary === provider}><input type="radio" name="primary" value={provider} checked={primary === provider} onChange={() => setPrimary(provider)} /><span>{provider === "hunter" ? "Hunter" : "Voila Norbert"}</span></label>)}</fieldset>
          <div className="freemax-disconnects">
            {status.hunter.configured ? <label><input type="checkbox" name="disconnectHunter" />Disconnect Hunter</label> : null}
            {status.norbert.configured ? <label><input type="checkbox" name="disconnectNorbert" />Disconnect Norbert</label> : null}
          </div>
          <footer><span role="status">{message}</span><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{pending ? "Saving…" : "Save provider setup"}</button></footer>
        </form>
      ) : null}
    </article>
  );
}
