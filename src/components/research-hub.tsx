"use client";

import {
  ArrowRight,
  Bot,
  Building2,
  Check,
  ChevronRight,
  CirclePause,
  Clipboard,
  Download,
  ExternalLink,
  FileUp,
  Globe2,
  KeyRound,
  LoaderCircle,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  Sparkles,
  Target,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FormEvent, useMemo, useRef, useState } from "react";

import { saveContactAction, moveOpportunityAction, saveOpportunityDetailsAction } from "@/app/actions/crm";
import { enrichResearchContactAction, importResearchResultsAction, saveResearchThemeAction } from "@/app/actions/research";
import { CompanyEditorDialog } from "@/components/company-editor-dialog";
import { getResearchTargets, researchReadiness, type ResearchReadiness } from "@/lib/data/board-selectors";
import { activeOffers } from "@/lib/domain/offers";
import { safeExternalUrl } from "@/lib/domain/normalise";
import type { BoardSnapshot, ContactSummary, OpportunitySummary, ResearchThemeSummary } from "@/lib/domain/types";
import type { FreeMaxStatus } from "@/lib/enrichment/freemax";

const statusCopy: Record<ResearchReadiness, { label: string; detail: string }> = {
  ready: { label: "Ready to review", detail: "Evidence and a contact route are present" },
  needs_contact: { label: "Needs a contact", detail: "Company fit is recorded; find the right person" },
  needs_evidence: { label: "Needs evidence", detail: "Add a useful fact and its source" },
  held: { label: "On hold", detail: "Preserved outside the active sales board" },
};

export function ResearchHub({ snapshot, freeMaxStatus }: { snapshot: BoardSnapshot; freeMaxStatus: FreeMaxStatus }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInput = useRef<HTMLInputElement>(null);
  const targets = useMemo(() => getResearchTargets(snapshot), [snapshot]);
  const [query, setQuery] = useState("");
  const [researchView, setResearchView] = useState<"accounts" | "themes">(snapshot.edition === "service" ? "themes" : "accounts");
  const [themes, setThemes] = useState(snapshot.researchThemes);
  const [selectedThemeId, setSelectedThemeId] = useState(snapshot.researchThemes[0]?.id ?? null);
  const [themeEditor, setThemeEditor] = useState<ResearchThemeSummary | "new" | null>(null);
  const [filter, setFilter] = useState<ResearchReadiness | "all">("all");
  const availableOffers = activeOffers(snapshot.offers);
  const [offerFilter, setOfferFilter] = useState("all");
  const [showHandoff, setShowHandoff] = useState(false);
  const [addingCompany, setAddingCompany] = useState(false);
  const [editingCompany, setEditingCompany] = useState<OpportunitySummary | null>(null);
  const [editingContact, setEditingContact] = useState<ContactSummary | "new" | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const decorated = useMemo(() => targets.map((opportunity) => {
    const stage = snapshot.stages.find((item) => item.id === opportunity.stageId);
    return { opportunity, stage, readiness: researchReadiness(opportunity, stage) };
  }), [snapshot.stages, targets]);
  const filtered = decorated.filter(({ opportunity, readiness }) => {
    const searchText = [
      opportunity.company.name,
      opportunity.company.sector,
      opportunity.company.scaleNote,
      opportunity.company.researchNote,
      ...opportunity.contacts.map((contact) => `${contact.name} ${contact.title ?? ""}`),
    ].join(" ").toLowerCase();
    const matchesOffer = offerFilter === "all" || (offerFilter === "unassigned" ? !opportunity.offer : opportunity.offer?.id === offerFilter);
    return searchText.includes(query.trim().toLowerCase()) && matchesOffer && (filter === "all" || readiness === filter);
  });
  const requestedId = searchParams.get("target");
  const selected = filtered.find(({ opportunity }) => opportunity.id === requestedId)?.opportunity
    ?? decorated.find(({ opportunity }) => opportunity.id === requestedId)?.opportunity
    ?? filtered[0]?.opportunity
    ?? null;
  const selectedStage = selected ? snapshot.stages.find((stage) => stage.id === selected.stageId) : undefined;
  const selectedReadiness = selected ? researchReadiness(selected, selectedStage) : null;
  const selectedWebsiteUrl = safeExternalUrl(selected?.company.websiteUrl);
  const selectedSourceUrls = (selected?.company.sourceUrls ?? []).map(safeExternalUrl).filter((url): url is string => Boolean(url));
  const enrichableContact = selected?.contacts.find((contact) => !contact.email) ?? null;
  const readyStage = snapshot.stages.find((stage) => stage.name === "Ready to contact");
  const activeResearchStage = snapshot.stages.find((stage) => stage.name === "Researching");
  const holdStage = snapshot.stages.find((stage) => stage.name === "Research holding");
  const freeMaxConfigured = freeMaxStatus.hunter.configured || freeMaxStatus.norbert.configured;
  const selectedTheme = themes.find((theme) => theme.id === selectedThemeId) ?? themes[0] ?? null;

  const counts = decorated.reduce<Record<ResearchReadiness, number>>((total, item) => {
    total[item.readiness] += 1;
    return total;
  }, { ready: 0, needs_contact: 0, needs_evidence: 0, held: 0 });

  function selectTarget(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("target", id);
    router.replace(`/research?${params.toString()}`, { scroll: false });
  }

  async function moveSelected(stageId: string | undefined, action: string) {
    if (!selected || !stageId) return;
    setPendingAction(action);
    const result = await moveOpportunityAction({ opportunityId: selected.id, toStageId: stageId });
    setPendingAction(null);
    if (!result.ok) return setNotice(result.error);
    setNotice(action === "promote" ? `${selected.company.name} is now ready to contact.` : `${selected.company.name} has been updated.`);
    router.replace("/research", { scroll: false });
    router.refresh();
  }

  async function assignSelectedOffer(offerId: string) {
    if (!selected) return;
    setPendingAction("offer");
    setNotice(null);
    const result = await saveOpportunityDetailsAction({
      opportunityId: selected.id,
      title: selected.title,
      offerId: offerId || null,
      ownerId: selected.owner?.id ?? null,
      priority: selected.priority,
      temperature: selected.temperature,
      outreachAngle: selected.outreachAngle ?? "",
    });
    setPendingAction(null);
    if (!result.ok) return setNotice(result.error);
    setNotice(offerId ? "Offer assigned. This target can now be promoted when the research is ready." : "Offer cleared while this target remains in research.");
    router.refresh();
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setPendingAction("import");
    setNotice(null);
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const result = await importResearchResultsAction(payload);
      if (!result.ok) setNotice(result.error);
      else {
        setNotice(`Research updated: ${result.targetsCreated} new, ${result.targetsUpdated} matched, ${result.contactsCreated} contacts added.`);
        setShowHandoff(false);
        router.refresh();
      }
    } catch {
      setNotice("That file is not valid JSON. Use the downloaded research pack as the starting format.");
    } finally {
      setPendingAction(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function enrichContact() {
    if (!selected || !enrichableContact) return;
    if (!freeMaxConfigured) {
      setNotice("Add a Hunter or Voila Norbert key to the server environment to connect FreeMax securely.");
      return;
    }
    setPendingAction(`enrich-${enrichableContact.id}`);
    setNotice(null);
    const result = await enrichResearchContactAction({ opportunityId: selected.id, contactId: enrichableContact.id });
    setPendingAction(null);
    if (!result.ok) return setNotice(result.error);
    setNotice(`${result.provider} found ${result.email}${result.score ? ` with a ${result.score}% confidence score` : ""}.`);
    router.refresh();
  }

  function currentPack() {
    const chosen = selected ? [selected] : filtered.map((item) => item.opportunity);
    return buildResearchPack(chosen, snapshot.generatedAt);
  }

  async function copyBrief() {
    await navigator.clipboard.writeText(researchView === "themes" && selectedTheme ? buildResearchThemeBrief(selectedTheme, availableOffers) : buildResearchBrief(currentPack()));
    setNotice("Research brief copied. Paste it into Codex, Cowork, or your preferred research assistant.");
  }

  function downloadPack() {
    const payload = researchView === "themes" ? { schemaVersion: 1, themes: selectedTheme ? [selectedTheme] : themes } : currentPack();
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gud-research-${researchView === "themes" ? selectedTheme ? slug(selectedTheme.title) : "themes" : selected ? slug(selected.company.name) : "batch"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="research-page">
      <header className="research-hero">
        <div>
          <span className="eyebrow">Pre-pipeline intelligence</span>
          <h1>Research</h1>
          <p>{researchView === "themes" ? "Turn an emerging need into evidence, an offer angle and a shortlist." : "Qualify the right organisations before they become sales opportunities."}</p>
        </div>
        <div className="research-hero-actions">
          <button className="btn btn-quiet research-handoff-button" type="button" onClick={() => setShowHandoff(true)}><Bot size={17} />Research handoff</button>
          <button className="btn btn-primary" type="button" onClick={() => researchView === "themes" ? setThemeEditor("new") : setAddingCompany(true)}><Plus size={17} />{researchView === "themes" ? "Add theme" : "Add target"}</button>
        </div>
      </header>

      <section className="research-overview" aria-label="Research overview">
        {researchView === "themes" ? <><ResearchMetric label="Themes" value={themes.length} icon={<Sparkles />} /><ResearchMetric label="Ready to shortlist" value={themes.filter((theme) => theme.status === "ready").length} icon={<Check />} tone="green" /><ResearchMetric label="Gathering evidence" value={themes.filter((theme) => theme.status === "evidence").length} icon={<Search />} tone="blue" /><ResearchMetric label="Account targets" value={targets.length} icon={<Target />} tone="slate" /></> : <><ResearchMetric label="Targets preserved" value={targets.length} icon={<Target />} /><ResearchMetric label="Ready to review" value={counts.ready} icon={<Check />} tone="green" /><ResearchMetric label="Need a contact" value={counts.needs_contact} icon={<Users />} tone="blue" /><ResearchMetric label="On hold" value={counts.held} icon={<CirclePause />} tone="slate" /></>}
      </section>

      {notice ? <div className="research-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={15} /></button></div> : null}

      <section className="research-view-switch" aria-label="Research shape">
        <div><strong>What are you researching?</strong><span>Keep market thinking separate from live opportunities.</span></div>
        <div className="view-toggle"><button type="button" aria-pressed={researchView === "accounts"} onClick={() => setResearchView("accounts")}><Building2 size={15} />Accounts</button><button type="button" aria-pressed={researchView === "themes"} onClick={() => setResearchView("themes")}><Sparkles size={15} />Themes</button></div>
      </section>

      {researchView === "accounts" ? <><section className="research-toolbar">
        <label className="search-box search-box-grow"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search targets, sectors, contacts or evidence" /></label>
        {availableOffers.length > 1 ? <label className="field-select research-filter"><span className="sr-only">Offer</span><select value={offerFilter} onChange={(event) => setOfferFilter(event.target.value)}><option value="all">All offers</option><option value="unassigned">Not assigned yet</option>{availableOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label> : null}
        <label className="field-select research-filter"><span className="sr-only">Research status</span><select value={filter} onChange={(event) => setFilter(event.target.value as ResearchReadiness | "all")}><option value="all">All research</option><option value="ready">Ready to review</option><option value="needs_contact">Needs a contact</option><option value="needs_evidence">Needs evidence</option><option value="held">On hold</option></select></label>
      </section>

      <div className="research-workspace">
        <section className="research-list" aria-label="Research targets">
          <div className="research-list-heading"><strong>{filtered.length} {filtered.length === 1 ? "target" : "targets"}</strong><span>Existing tracker data stays intact until you promote it.</span></div>
          {filtered.map(({ opportunity, readiness }) => {
            const contact = opportunity.contacts.find((item) => item.primary) ?? opportunity.contacts[0];
            return (
              <button className="research-row" data-active={selected?.id === opportunity.id} type="button" key={opportunity.id} onClick={() => selectTarget(opportunity.id)}>
                <span className="research-row-mark">{initials(opportunity.company.name)}</span>
                <span className="research-row-copy">
                  <span className="research-row-title"><strong>{opportunity.company.name}</strong><ResearchStatus status={readiness} /></span>
                  {availableOffers.length > 1 ? <span className="research-row-offer">{opportunity.offer?.name ?? "Offer not chosen"}</span> : null}
                  <span>{opportunity.company.sector || "Sector not set"}{opportunity.company.scaleNote ? ` · ${opportunity.company.scaleNote}` : ""}</span>
                  <small>{contact ? `${contact.name}${contact.title ? ` · ${contact.title}` : ""}` : "No contact route yet"}</small>
                </span>
                <span className="research-row-fit">{opportunity.company.fitScore ? `${opportunity.company.fitScore}/5` : "—"}</span>
                <ChevronRight size={18} />
              </button>
            );
          })}
          {!filtered.length ? <div className="research-empty"><Sparkles size={24} /><strong>No targets in this view</strong><span>Change the filter or add a new company to begin research.</span></div> : null}
        </section>

        <aside className="research-inspector" aria-label="Selected research target">
          {selected && selectedReadiness ? (
            <>
              <header className="research-inspector-head">
                <div className="research-company-icon">{initials(selected.company.name)}</div>
                <div><ResearchStatus status={selectedReadiness} /><h2>{selected.company.name}</h2><p>{selected.company.sector || "Sector not set"}</p></div>
                <button className="icon-button" type="button" onClick={() => setEditingCompany(selected)} aria-label={`Edit ${selected.company.name}`}><Pencil size={16} /></button>
              </header>

              <div className="research-fit-strip">
                {availableOffers.length > 1 ? <label><small>Offer</small><select value={selected.offer?.id ?? ""} onChange={(event) => assignSelectedOffer(event.target.value)} disabled={pendingAction !== null}><option value="">Decide after research</option>{availableOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label> : null}
                <span><small>Fit</small><strong>{selected.company.fitScore ? `${selected.company.fitScore}/5` : "Unscored"}</strong></span>
                <span><small>Contacts</small><strong>{selected.contacts.length}</strong></span>
                <span><small>Sources</small><strong>{selected.company.sourceUrls?.length ?? 0}</strong></span>
              </div>

              <section className="research-section">
                <div className="research-section-head"><div><span className="eyebrow">Why this target</span><h3>Qualification evidence</h3></div></div>
                <p className="research-summary">{selected.company.researchNote || "No research note yet. Add one useful fact, why it matters, and the source."}</p>
                {selected.company.scaleNote ? <div className="research-scale"><Building2 size={16} /><span>{selected.company.scaleNote}</span></div> : null}
                <div className="research-links">
                  {selectedWebsiteUrl ? <a href={selectedWebsiteUrl} target="_blank" rel="noopener noreferrer"><Globe2 size={15} />Website<ExternalLink size={13} /></a> : null}
                  <a href={`https://find-and-update.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(selected.company.name)}`} target="_blank" rel="noopener noreferrer"><Building2 size={14} />Companies House<ExternalLink size={13} /></a>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected.company.name)}`} target="_blank" rel="noopener noreferrer"><Globe2 size={14} />Maps search<ExternalLink size={13} /></a>
                  {selectedSourceUrls.slice(0, 4).map((url) => <a href={url} target="_blank" rel="noopener noreferrer" key={url}><ExternalLink size={14} />{sourceLabel(url)}</a>)}
                  {!selectedWebsiteUrl && !selectedSourceUrls.length ? <span>No safe source links recorded</span> : null}
                </div>
              </section>

              <section className="research-section">
                <div className="research-section-head"><div><span className="eyebrow">People</span><h3>Contact routes</h3></div><div className="research-contact-actions">{enrichableContact && selected.company.websiteUrl ? freeMaxConfigured ? <button className="btn btn-quiet btn-compact" type="button" disabled={pendingAction !== null} onClick={enrichContact} title={`FreeMax tries Hunter first, then Norbert only if needed, for ${enrichableContact.name}`}>{pendingAction === `enrich-${enrichableContact.id}` ? <LoaderCircle className="spin" size={14} /> : <Mail size={14} />}Find work email</button> : <Link className="btn btn-quiet btn-compact" href="/settings#enrichment"><KeyRound size={14} />Connect FreeMax</Link> : null}<button className="btn btn-quiet btn-compact" type="button" onClick={() => setEditingContact("new")}><Plus size={14} />Add</button></div></div>
                {freeMaxConfigured ? <FreeMaxSummary status={freeMaxStatus} /> : null}
                <div className="research-contacts">
                  {selected.contacts.map((contact) => (
                    <button type="button" key={contact.id} onClick={() => setEditingContact(contact)}>
                      <span className="mini-avatar">{initials(contact.name)}</span>
                      <span><strong>{contact.name}</strong><small>{contact.title || "Role not set"}</small><ContactRoutes contact={contact} /></span>
                      <Pencil size={14} />
                    </button>
                  ))}
                  {!selected.contacts.length ? <div className="research-contact-empty"><UserRound size={20} /><span><strong>No contact route yet</strong><small>Add a named contact or let your research assistant return candidates.</small></span></div> : null}
                </div>
              </section>

              <footer className="research-decision">
                <div><span className="eyebrow">Human decision</span><strong>{statusCopy[selectedReadiness].detail}</strong></div>
                <div>
                  {selectedStage?.name === "Research holding" ? <button className="btn btn-quiet" type="button" disabled={!activeResearchStage || pendingAction !== null} onClick={() => moveSelected(activeResearchStage?.id, "resume")}>{pendingAction === "resume" ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}Resume research</button> : <button className="btn btn-quiet" type="button" disabled={!holdStage || pendingAction !== null} onClick={() => moveSelected(holdStage?.id, "hold")}><CirclePause size={15} />Hold</button>}
                  <button className="btn btn-primary" type="button" disabled={!readyStage || pendingAction !== null || (availableOffers.length > 1 && !selected.offer)} title={availableOffers.length > 1 && !selected.offer ? "Choose what you are pitching first" : undefined} onClick={() => moveSelected(readyStage?.id, "promote")}>{pendingAction === "promote" ? <LoaderCircle className="spin" size={15} /> : <ArrowRight size={15} />}Promote to pipeline</button>
                </div>
              </footer>
            </>
          ) : <div className="research-empty research-empty-panel"><Target size={28} /><strong>Select a target</strong><span>Research details, sources and contacts will appear here.</span></div>}
        </aside>
      </div></> : <ThemeWorkspace themes={themes} selected={selectedTheme} offers={availableOffers} onSelect={setSelectedThemeId} onEdit={setThemeEditor} onAddTarget={() => setAddingCompany(true)} onCopied={() => setNotice("Theme brief copied. Paste it into Codex or your preferred research assistant.")} />}

      {showHandoff ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog-card research-handoff" role="dialog" aria-modal="true" aria-labelledby="research-handoff-title">
            <header className="dialog-header"><div><span className="eyebrow">No CRM API required</span><h2 id="research-handoff-title">Research with your preferred assistant</h2><p>Send a focused brief out, then bring structured evidence back for human review.</p></div><button className="icon-button" type="button" onClick={() => setShowHandoff(false)} aria-label="Close research handoff"><X size={17} /></button></header>
            <div className="research-handoff-steps">
              <button type="button" onClick={copyBrief}><span><Clipboard size={20} /></span><strong>Copy the brief</strong><small>Best for one target in Codex or Cowork.</small></button>
              <button type="button" onClick={downloadPack}><span><Download size={20} /></span><strong>Download JSON</strong><small>Use the exact return format for a batch.</small></button>
              {researchView === "accounts" ? <><button type="button" onClick={() => fileInput.current?.click()} disabled={pendingAction === "import"}><span>{pendingAction === "import" ? <LoaderCircle className="spin" size={20} /> : <FileUp size={20} />}</span><strong>Import results</strong><small>Match companies, merge evidence and add contacts.</small></button><input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => importFile(event.target.files?.[0])} /></> : null}
            </div>
            <div className="research-handoff-rule"><Sparkles size={17} /><span><strong>Nothing is promoted automatically.</strong> {researchView === "themes" ? "Use the returned evidence to sharpen the theme, then add only credible account targets." : "Imported findings remain in research until a person chooses otherwise."}</span></div>
          </section>
        </div>
      ) : null}

      {addingCompany ? <CompanyEditorDialog company={null} offers={snapshot.offers} onClose={() => setAddingCompany(false)} onSaved={(_, opportunityId) => { setAddingCompany(false); if (opportunityId) selectTarget(opportunityId); router.refresh(); }} /> : null}
      {editingCompany ? <CompanyEditorDialog company={editingCompany.company} offers={snapshot.offers} onClose={() => setEditingCompany(null)} onSaved={() => { setEditingCompany(null); router.refresh(); }} /> : null}
      {editingContact && selected ? <ResearchContactDialog opportunity={selected} contact={editingContact === "new" ? null : editingContact} onClose={() => setEditingContact(null)} onSaved={() => { setEditingContact(null); router.refresh(); }} /> : null}
      {themeEditor ? <ResearchThemeDialog theme={themeEditor === "new" ? null : themeEditor} offers={availableOffers} onClose={() => setThemeEditor(null)} onSaved={(saved) => { setThemes((items) => items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items]); setSelectedThemeId(saved.id); setThemeEditor(null); }} /> : null}
    </div>
  );
}

function ThemeWorkspace({ themes, selected, offers, onSelect, onEdit, onAddTarget, onCopied }: { themes: ResearchThemeSummary[]; selected: ResearchThemeSummary | null; offers: BoardSnapshot["offers"]; onSelect: (id: string) => void; onEdit: (theme: ResearchThemeSummary) => void; onAddTarget: () => void; onCopied: () => void }) {
  const offer = selected ? offers.find((item) => item.id === selected.offerId) : null;
  async function copyTheme() {
    if (!selected) return;
    await navigator.clipboard.writeText([
      `Research theme: ${selected.title}`,
      `Audience: ${selected.audience || "To establish"}`,
      `Problem or change: ${selected.problem || "To establish"}`,
      `Evidence signal: ${selected.signal || "Find credible, dated evidence and sources"}`,
      `Possible offer: ${offer?.name ?? "Not chosen"}`,
      `Angle to test: ${selected.angle || "Develop a useful, non-invented angle"}`,
      "Return: key findings, source URLs, candidate organisations, relevant buyer roles, and what would disprove this opportunity.",
    ].join("\n\n"));
    onCopied();
  }
  return <div className="research-workspace theme-workspace">
    <section className="research-list" aria-label="Research themes">
      <div className="research-list-heading"><strong>{themes.length} {themes.length === 1 ? "theme" : "themes"}</strong><span>Ideas stay here until evidence supports real targets.</span></div>
      {themes.map((theme) => <button className="research-row theme-row" data-active={selected?.id === theme.id} type="button" key={theme.id} onClick={() => onSelect(theme.id)}><span className="research-row-mark"><Sparkles size={16} /></span><span className="research-row-copy"><span className="research-row-title"><strong>{theme.title}</strong><ThemeStatus status={theme.status} /></span><span>{theme.audience || "Audience not defined"}</span><small>{theme.angle || theme.problem || "Add the problem and angle worth testing"}</small></span><ChevronRight size={18} /></button>)}
      {!themes.length ? <div className="research-empty"><Sparkles size={24} /><strong>Start with one useful question</strong><span>A theme is a market problem or change you may be able to help with—not a vague content topic.</span></div> : null}
    </section>
    <aside className="research-inspector theme-inspector" aria-label="Selected research theme">
      {selected ? <><header className="research-inspector-head"><div className="research-company-icon"><Sparkles size={19} /></div><div><ThemeStatus status={selected.status} /><h2>{selected.title}</h2><p>{selected.audience || "Audience not defined"}</p></div><button className="icon-button" type="button" onClick={() => onEdit(selected)} aria-label={`Edit ${selected.title}`}><Pencil size={16} /></button></header><div className="research-fit-strip"><span><small>Offer angle</small><strong>{offer?.name ?? "Open"}</strong></span><span><small>Sources</small><strong>{selected.sourceUrls.length}</strong></span><span><small>State</small><strong>{themeStatusLabel(selected.status)}</strong></span></div><section className="research-section theme-question"><span className="eyebrow">The question</span><h3>Is this a problem worth pursuing?</h3><dl><div><dt>Problem or change</dt><dd>{selected.problem || "Not recorded yet"}</dd></div><div><dt>Evidence signal</dt><dd>{selected.signal || "Add the strongest fact, trend or repeated observation."}</dd></div><div><dt>Angle to test</dt><dd>{selected.angle || "Describe one useful way your service might respond."}</dd></div></dl>{selected.sourceUrls.length ? <div className="research-links">{selected.sourceUrls.slice(0, 6).map((url) => <a href={url} target="_blank" rel="noopener noreferrer" key={url}><ExternalLink size={14} />{sourceLabel(url)}</a>)}</div> : null}</section><footer className="research-decision"><div><span className="eyebrow">Next move</span><strong>Research externally, then turn credible matches into account targets.</strong></div><div><button className="btn btn-quiet" type="button" onClick={copyTheme}><Clipboard size={15} />Copy brief</button><button className="btn btn-primary" type="button" onClick={onAddTarget}><ArrowRight size={15} />Add target</button></div></footer></> : <div className="research-empty research-empty-panel"><Sparkles size={28} /><strong>Select a theme</strong><span>The research question and offer angle will appear here.</span></div>}
    </aside>
  </div>;
}

function ResearchThemeDialog({ theme, offers, onClose, onSaved }: { theme: ResearchThemeSummary | null; offers: BoardSnapshot["offers"]; onClose: () => void; onSaved: (theme: ResearchThemeSummary) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const sourceUrls = String(form.get("sourceUrls") ?? "").split(/\s+/).map((item) => item.trim()).filter(Boolean);
    const result = await saveResearchThemeAction({ themeId: theme?.id ?? null, title: form.get("title"), audience: form.get("audience"), problem: form.get("problem"), signal: form.get("signal"), angle: form.get("angle"), status: form.get("status"), offerId: String(form.get("offerId") ?? "") || null, sourceUrls });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onSaved(result.theme);
  }
  return <div className="dialog-backdrop" role="presentation"><section className="dialog-card dialog-card-wide" role="dialog" aria-modal="true" aria-labelledby="theme-dialog-title"><header className="dialog-header"><div><span className="eyebrow">Market research</span><h2 id="theme-dialog-title">{theme ? "Shape the research theme" : "Start with a useful question"}</h2><p>A theme connects evidence to an audience and a possible service angle. It is not yet an opportunity.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close research theme editor"><X size={17} /></button></header><form className="dialog-form" onSubmit={submit}><div className="form-grid"><label className="field-label form-span-2">Theme title<input className="field" name="title" defaultValue={theme?.title ?? ""} required minLength={2} autoFocus placeholder="A costly change or unmet need worth investigating" /></label><label className="field-label">Audience<input className="field" name="audience" defaultValue={theme?.audience ?? ""} placeholder="Who appears to experience it?" /></label><label className="field-label">Research state<select className="field-select" name="status" defaultValue={theme?.status ?? "idea"}><option value="idea">Idea</option><option value="evidence">Gathering evidence</option><option value="ready">Ready to shortlist</option></select></label>{offers.length > 1 ? <label className="field-label form-span-2">Possible service<select className="field-select" name="offerId" defaultValue={theme?.offerId ?? ""}><option value="">Emerging / not chosen</option>{offers.map((offer) => <option value={offer.id} key={offer.id}>{offer.name}</option>)}</select></label> : null}<label className="field-label form-span-2">Problem or change<textarea className="field textarea" name="problem" rows={3} defaultValue={theme?.problem ?? ""} placeholder="What seems to be changing, breaking or becoming newly valuable?" /></label><label className="field-label form-span-2">Strongest signal<textarea className="field textarea" name="signal" rows={3} defaultValue={theme?.signal ?? ""} placeholder="What evidence would make this more than a hunch?" /></label><label className="field-label form-span-2">Offer angle to test<textarea className="field textarea" name="angle" rows={3} defaultValue={theme?.angle ?? ""} placeholder="How might one existing or emerging service help?" /></label><label className="field-label form-span-2">Source links<textarea className="field textarea" name="sourceUrls" rows={3} defaultValue={theme?.sourceUrls.join("\n") ?? ""} placeholder="One HTTPS link per line" /></label></div>{error ? <p className="form-error">{error}</p> : null}<footer className="dialog-actions"><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{pending ? "Saving…" : "Save theme"}</button></footer></form></section></div>;
}

function ThemeStatus({ status }: { status: ResearchThemeSummary["status"] }) {
  return <span className="research-status" data-status={status === "ready" ? "ready" : status === "evidence" ? "needs_contact" : "needs_evidence"}>{themeStatusLabel(status)}</span>;
}

function themeStatusLabel(status: ResearchThemeSummary["status"]) {
  return status === "ready" ? "Ready to shortlist" : status === "evidence" ? "Gathering evidence" : "Idea";
}

function ResearchMetric({ label, value, icon, tone = "purple" }: { label: string; value: number; icon: React.ReactNode; tone?: string }) {
  return <div className="research-metric" data-tone={tone}><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>;
}

function ResearchStatus({ status }: { status: ResearchReadiness }) {
  return <span className="research-status" data-status={status}>{statusCopy[status].label}</span>;
}

function FreeMaxSummary({ status }: { status: FreeMaxStatus }) {
  return (
    <div className="freemax-summary" title="Tracked GUD CRM usage only. Provider dashboards remain authoritative.">
      <Sparkles size={13} />
      <strong>FreeMax</strong>
      {status.hunter.configured ? <span>Hunter {status.hunter.used}/{status.hunter.limit} this month</span> : null}
      {status.norbert.configured ? <span>Norbert {status.norbert.used}/{status.norbert.limit} starter</span> : null}
      <small>Free-first caps</small>
    </div>
  );
}

function ContactRoutes({ contact }: { contact: ContactSummary }) {
  return <span className="contact-route-icons">{contact.email ? <Mail size={13} /> : null}{contact.phone ? <Phone size={13} /> : null}{contact.linkedinUrl ? <span>in</span> : null}{!contact.email && !contact.phone && !contact.linkedinUrl ? "No route recorded" : null}</span>;
}

function ResearchContactDialog({ opportunity, contact, onClose, onSaved }: { opportunity: OpportunitySummary; contact: ContactSummary | null; onClose: () => void; onSaved: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await saveContactAction({
      opportunityId: opportunity.id,
      contactId: contact?.id ?? null,
      name: form.get("name"),
      title: form.get("title"),
      email: form.get("email"),
      phone: form.get("phone"),
      linkedinUrl: form.get("linkedinUrl"),
      preferredChannel: form.get("preferredChannel") || null,
      doNotContact: form.get("doNotContact") === "on",
      primary: form.get("primary") === "on",
    });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onSaved();
  }
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="research-contact-title">
        <header className="dialog-header"><div><span className="eyebrow">Contact route</span><h2 id="research-contact-title">{contact ? `Edit ${contact.name}` : `Add a contact for ${opportunity.company.name}`}</h2><p>Record only what is useful, sourced and appropriate for business outreach.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close contact editor"><X size={17} /></button></header>
        <form className="dialog-form" onSubmit={submit}>
          <div className="form-grid">
            <label className="field-label">Name<input className="field" name="name" defaultValue={contact?.name ?? ""} required autoFocus /></label>
            <label className="field-label">Role<input className="field" name="title" defaultValue={contact?.title ?? ""} /></label>
            <label className="field-label">Work email<input className="field" name="email" type="email" defaultValue={contact?.email ?? ""} /></label>
            <label className="field-label">Phone<input className="field" name="phone" defaultValue={contact?.phone ?? ""} /></label>
            <label className="field-label form-span-2">LinkedIn profile<input className="field" name="linkedinUrl" type="url" defaultValue={contact?.linkedinUrl ?? ""} /></label>
            <label className="field-label">Preferred route<select className="field-select" name="preferredChannel" defaultValue={contact?.preferredChannel ?? ""}><option value="">Not set</option><option value="linkedin">LinkedIn</option><option value="email">Email</option><option value="phone">Phone</option><option value="meeting">Meeting</option><option value="physical">Physical</option><option value="note">Note only</option></select></label>
            <div className="research-contact-checks"><label className="checkbox-row"><input name="primary" type="checkbox" defaultChecked={contact?.primary ?? opportunity.contacts.length === 0} />Primary contact</label><label className="checkbox-row"><input name="doNotContact" type="checkbox" defaultChecked={contact?.doNotContact ?? false} />Do not contact</label></div>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="dialog-actions"><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{pending ? "Saving…" : "Save contact"}</button></div>
        </form>
      </section>
    </div>
  );
}

function buildResearchPack(targets: OpportunitySummary[], generatedAt: string) {
  return {
    schemaVersion: 1,
    generatedAt,
    purpose: "Evidence-led service-industry prospect research for human review before sales outreach.",
    targets: targets.map((opportunity) => ({
      opportunityId: opportunity.id,
      companyId: opportunity.company.id,
      offerId: opportunity.offer?.id ?? null,
      offerName: opportunity.offer?.name ?? "",
      name: opportunity.company.name,
      websiteUrl: opportunity.company.websiteUrl ?? "",
      linkedinUrl: opportunity.company.linkedinUrl ?? "",
      sector: opportunity.company.sector ?? "",
      fitScore: opportunity.company.fitScore,
      scaleNote: opportunity.company.scaleNote ?? "",
      researchNote: opportunity.company.researchNote ?? "",
      sourceUrls: opportunity.company.sourceUrls ?? [],
      evidence: [],
      contacts: opportunity.contacts.map((contact) => ({
        name: contact.name,
        title: contact.title ?? "",
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        linkedinUrl: contact.linkedinUrl ?? "",
        preferredChannel: contact.preferredChannel ?? null,
        sourceUrls: contact.sourceUrls ?? [],
      })),
    })),
  };
}

function buildResearchBrief(pack: ReturnType<typeof buildResearchPack>) {
  return `Research the target data below for a service-industry outreach team. Use browser research where appropriate. Confirm the company identity and domain, find 2–4 useful operational or commercial facts, assess fit from 1–5, and identify no more than two credible decision-maker candidates. Keep the process proportionate. Do not guess an email, phone number, role, fact, or URL. Preserve existing values unless reliable evidence improves them. Every material claim must include a public source URL and observation date. Return only valid JSON in exactly the supplied schema so it can be reviewed and imported into GUD CRM. Never promote a target or initiate outreach.\n\n${JSON.stringify(pack, null, 2)}`;
}

function buildResearchThemeBrief(theme: ResearchThemeSummary, offers: BoardSnapshot["offers"]) {
  const offer = offers.find((item) => item.id === theme.offerId);
  return `Investigate this market theme for a service-business sales team. Determine whether the problem is real, important and reachable; do not merely collect supportive material. Find current, dated evidence from credible public sources, identify patterns and counter-evidence, suggest a small set of organisation types or named candidates only when supported, and identify relevant buyer roles without guessing personal data. Relate the evidence to the possible service, but do not force the fit or initiate outreach. Return a concise synthesis followed by source URLs and a shortlist table.\n\nTheme: ${theme.title}\nAudience: ${theme.audience || "To establish"}\nProblem or change: ${theme.problem || "To establish"}\nCurrent signal: ${theme.signal || "None recorded"}\nPossible service: ${offer?.name ?? "Emerging / not chosen"}\nAngle to test: ${theme.angle || "To develop"}\nExisting sources:\n${theme.sourceUrls.join("\n") || "None recorded"}`;
}

function initials(value: string) {
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function sourceLabel(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Source"; }
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
