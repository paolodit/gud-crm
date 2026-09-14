"use client";

import { ArrowLeft, Check, ExternalLink, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { saveFreeMaxConfigurationAction } from "@/app/actions/workspace";
import type { FreeMaxProvider, FreeMaxStatus } from "@/lib/enrichment/freemax";
import { emailFindingReturnHref } from "@/lib/domain/email-finding-links";

export function FreeMaxSettingsCard({ status, canManage, ...attributes }: { status: FreeMaxStatus; canManage: boolean; "data-settings-tab"?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnHref = emailFindingReturnHref(searchParams.get("returnTarget"));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [hunterKey, setHunterKey] = useState("");
  const [norbertKey, setNorbertKey] = useState("");
  const [disconnectHunter, setDisconnectHunter] = useState(false);
  const [disconnectNorbert, setDisconnectNorbert] = useState(false);
  const [primary, setPrimary] = useState<FreeMaxProvider>(status.order[0] ?? "hunter");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canManage) return;
    setPending(true);
    setMessage(null);
    setFailed(false);
    try {
      const result = await saveFreeMaxConfigurationAction({ hunterKey, norbertKey, disconnectHunter, disconnectNorbert, primary });
      if (!result.ok) { setFailed(true); setMessage(result.error); return; }
      setHunterKey("");
      setNorbertKey("");
      setDisconnectHunter(false);
      setDisconnectNorbert(false);
      setMessage("Provider setup saved. New lookups use it immediately.");
      router.refresh();
    } catch {
      setFailed(true);
      setMessage("Provider setup could not be saved. Please try again.");
    } finally { setPending(false); }
  }

  return (
    <article {...attributes} className="surface settings-card settings-card-wide enrichment-settings-card enrichment-settings-card-live" id="email-finding" aria-labelledby="email-finding-title">
      <div className="settings-icon settings-icon-enrichment"><Mail /></div>
      <div><h2 id="email-finding-title">Email finding</h2><p>Connect Hunter or Voila Norbert here. Use Find work email beside a named contact in Targets.</p></div>
      {returnHref ? <Link className="btn btn-quiet settings-card-action" href={returnHref}><ArrowLeft size={14} />Back to target</Link> : null}
      <div className="enrichment-provider-grid">
        <div data-ready={status.hunter.configured}><span><strong>Hunter {status.order[0] === "hunter" ? "· First" : ""}</strong><small>Monthly free allowance</small></span><b>{status.hunter.configured ? `${status.hunter.used}/${status.hunter.limit} used` : "Not connected"}</b></div>
        <div data-ready={status.norbert.configured}><span><strong>Voila Norbert {status.order[0] === "norbert" ? "· First" : ""}</strong><small>Starter allowance</small></span><b>{status.norbert.configured ? `${status.norbert.used}/${status.norbert.limit} used` : "Not connected"}</b></div>
      </div>
      <div className="freemax-workflow">
        <span><b>1</b><small>Research a real person and company domain</small></span>
        <span><b>2</b><small>Click Find work email beside the contact in Targets</small></span>
        <span><b>3</b><small>GUD stays inside connected providers and safety caps</small></span>
      </div>
      <p className="freemax-explainer"><ShieldCheck size={15} /><span>GUD tries your preferred provider first and falls back only when needed. Keys are encrypted server-side and never returned to the browser. Successful lookups are counted here; provider dashboards remain authoritative.</span></p>
      {canManage ? (
        <form className="freemax-key-form" onSubmit={submit} aria-label="Email provider setup" aria-busy={pending}>
          <header><div><strong>Connect or switch providers</strong><small>Paste a new key only when adding or replacing it. Blank fields keep the current key.</small></div><div className="button-row"><a className="btn btn-quiet btn-compact" href="https://hunter.io/users/sign_up" target="_blank" rel="noreferrer">Hunter <ExternalLink size={13} /></a><a className="btn btn-quiet btn-compact" href="https://www.voilanorbert.com/" target="_blank" rel="noreferrer">Norbert <ExternalLink size={13} /></a></div></header>
          <div className="freemax-key-grid">
            <label className="field-label">Hunter API key<input className="field" name="hunterKey" type="password" autoComplete="off" value={hunterKey} onChange={(event) => setHunterKey(event.target.value)} disabled={pending} placeholder={status.hunter.configured ? "Connected · paste to replace" : "Paste Hunter key"} /></label>
            <label className="field-label">Voila Norbert API key<input className="field" name="norbertKey" type="password" autoComplete="off" value={norbertKey} onChange={(event) => setNorbertKey(event.target.value)} disabled={pending} placeholder={status.norbert.configured ? "Connected · paste to replace" : "Paste Norbert key"} /></label>
          </div>
          <fieldset className="provider-order" disabled={pending}><legend>Try first</legend>{(["hunter", "norbert"] as FreeMaxProvider[]).map((provider) => <label key={provider} data-selected={primary === provider}><input type="radio" name="primary" value={provider} checked={primary === provider} onChange={() => setPrimary(provider)} /><span>{provider === "hunter" ? "Hunter" : "Voila Norbert"}</span></label>)}</fieldset>
          <div className="freemax-disconnects">
            {status.hunter.configured ? <label><input type="checkbox" name="disconnectHunter" checked={disconnectHunter} onChange={(event) => setDisconnectHunter(event.target.checked)} disabled={pending} />Disconnect Hunter</label> : null}
            {status.norbert.configured ? <label><input type="checkbox" name="disconnectNorbert" checked={disconnectNorbert} onChange={(event) => setDisconnectNorbert(event.target.checked)} disabled={pending} />Disconnect Norbert</label> : null}
          </div>
          <footer><span role={failed ? "alert" : "status"} data-error={failed}>{message}</span><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{pending ? "Saving…" : "Save provider setup"}</button></footer>
        </form>
      ) : <p className="settings-hint">Only an admin can connect, change or disconnect email providers. You can use connected providers from a target’s contact routes.</p>}
    </article>
  );
}
