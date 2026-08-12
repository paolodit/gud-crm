"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  CircleUserRound,
  Clock3,
  Columns3,
  Copy,
  Compass,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Globe2,
  KeyRound,
  LibraryBig,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  MessageSquareText,
  MonitorPlay,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Rows3,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Users,
  Video,
  Workflow,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { setWorkspaceAiEnabledAction } from "@/app/actions/ai";
import { saveActivityTypeAction } from "@/app/actions/crm";
import { importLocalTrackerAction } from "@/app/actions/import";
import { prepareSafeUpdateAction } from "@/app/actions/system";
import { archivePipelineStageAction, deactivateOfferAction, deactivateTeamMemberAction, revokeMcpConnectionAction, saveOfferAction, savePipelineNameAction, savePipelineStageAction, saveSalesAssetAction, saveTeamMemberAction, saveWorkspaceEditionAction } from "@/app/actions/workspace";
import { CompanyEditorDialog } from "@/components/company-editor-dialog";
import { isResearchStage } from "@/lib/data/board-selectors";
import { contextualOffers, defaultOffer } from "@/lib/domain/offers";
import type { ActivityTypeSummary, BoardSnapshot, OfferSummary, OpportunitySummary, PersonSummary, SalesAssetSummary, StageSummary } from "@/lib/domain/types";
import { editions, getEdition, type EditionKey } from "@/lib/editions";
import type { FreeMaxStatus } from "@/lib/enrichment/freemax";

export function CompaniesDirectory({ snapshot }: { snapshot: BoardSnapshot }) {
  const router = useRouter();
  const edition = getEdition(snapshot.edition);
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("all");
  const availableOffers = contextualOffers(snapshot.offers, snapshot.opportunities);
  const [offerFilter, setOfferFilter] = useState("all");
  const [sort, setSort] = useState("fit-desc");
  const [compact, setCompact] = useState(false);
  const [addingCompany, setAddingCompany] = useState(false);
  const companies = useMemo(() => aggregateCompanies(snapshot.opportunities), [snapshot.opportunities]);
  const sectors = [...new Set(companies.map((item) => item.company.sector).filter(Boolean))] as string[];
  const filtered = companies.filter((item) => {
    const haystack = [item.company.name, item.company.sector, item.company.researchNote, item.company.idealBuyerRoles, ...item.opportunities.map((opportunity) => opportunity.offer?.name ?? ""), ...item.contacts.map((contact) => `${contact.name} ${contact.title ?? ""} ${contact.email ?? ""} ${contact.phone ?? ""}`)]
      .join(" ")
      .toLowerCase();
    const matchesOffer = offerFilter === "all" || item.opportunities.some((opportunity) => opportunity.offer?.id === offerFilter);
    return haystack.includes(query.trim().toLowerCase()) && matchesOffer && (sector === "all" || item.company.sector === sector);
  });
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "name") return a.company.name.localeCompare(b.company.name);
    if (sort === "contacts") return b.contacts.length - a.contacts.length || a.company.name.localeCompare(b.company.name);
    if (sort === "stage") {
      const aPosition = snapshot.stages.find((stage) => stage.id === a.opportunities[0]?.stageId)?.position ?? 999;
      const bPosition = snapshot.stages.find((stage) => stage.id === b.opportunities[0]?.stageId)?.position ?? 999;
      return aPosition - bPosition || a.company.name.localeCompare(b.company.name);
    }
    return (b.company.fitScore ?? -1) - (a.company.fitScore ?? -1) || a.company.name.localeCompare(b.company.name);
  });

  return (
    <WorkspaceFrame title={sentenceCase(edition.language.companies)} subtitle={`${companies.length} accounts · ${companies.reduce((sum, item) => sum + item.contacts.length, 0)} known ${edition.language.contacts}`}>
      <section className="workspace-toolbar">
        <label className="search-box search-box-grow"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, sector, contact or role" /></label>
        <label className="field-select compact-select"><span className="sr-only">Sector</span><select value={sector} onChange={(event) => setSector(event.target.value)}><option value="all">All sectors</option>{sectors.map((item) => <option key={item}>{item}</option>)}</select></label>
        {availableOffers.length > 1 ? <label className="field-select compact-select"><span className="sr-only">Offer</span><select value={offerFilter} onChange={(event) => setOfferFilter(event.target.value)}><option value="all">All offers</option>{availableOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}{offer.active ? "" : " · Archived"}</option>)}</select></label> : null}
        <label className="field-select compact-select sort-select"><ArrowDownWideNarrow size={14} /><span className="sr-only">Sort companies</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="fit-desc">Fit: highest first</option><option value="name">Name: A–Z</option><option value="contacts">Most contacts</option><option value="stage">Pipeline order</option></select></label>
        <div className="view-toggle" role="group" aria-label="Company card density"><button type="button" aria-pressed={!compact} onClick={() => setCompact(false)} title="Comfortable cards"><Columns3 size={14} />Comfortable</button><button type="button" aria-pressed={compact} onClick={() => setCompact(true)} title="Compact cards"><Rows3 size={14} />Compact</button></div>
        <button className="btn btn-primary" type="button" onClick={() => setAddingCompany(true)}><Plus size={15} />Add company</button>
      </section>

      <section className="company-grid" data-density={compact ? "compact" : "comfortable"} aria-live="polite">
        {sorted.map(({ company, opportunities, contacts }) => {
          const relevantOpportunities = offerFilter === "all" ? opportunities : opportunities.filter((opportunity) => opportunity.offer?.id === offerFilter);
          const primary = relevantOpportunities.find((item) => !isResearchStage(snapshot.stages.find((stage) => stage.id === item.stageId))) ?? relevantOpportunities[0] ?? opportunities[0];
          const stage = snapshot.stages.find((item) => item.id === primary.stageId);
          const inResearch = isResearchStage(stage);
          return (
            <article className="company-card" key={company.id}>
              <div className="company-card-head">
                <div className="company-logo">{initials(company.name)}</div>
                <div><h2>{company.name}</h2><p>{company.sector || "Sector not set"}</p></div>
                <span className="fit-score" title="Fit score">{company.fitScore ? `${company.fitScore}/5 fit` : "Unscored"}</span>
              </div>
              <p className="company-scale">{company.scaleNote || "Add a scale note to sharpen qualification."}</p>
              <div className="company-facts">
                <span><Target size={14} /> {relevantOpportunities.length} {relevantOpportunities.length === 1 ? "opportunity" : "opportunities"}</span>
                <span><Users size={14} /> {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}</span>
                <span className="stage-dot" style={{ "--stage-colour": stage?.colour ?? "#98a2b3" } as React.CSSProperties}>{stage?.name ?? "Unknown stage"}</span>
              </div>
              {availableOffers.length > 1 ? <div className="company-offer-list">{[...new Map(opportunities.filter((item) => item.offer).map((item) => [item.offer!.id, item.offer!])).values()].map((offer) => <span className="offer-chip" key={offer.id} style={{ "--offer-colour": offer.colour } as React.CSSProperties}>{offer.name}</span>)}</div> : null}
              <div className="contact-stack">
                {contacts.slice(0, 2).map((contact) => <span key={contact.id}><CircleUserRound size={15} /><span><strong>{contact.name}</strong><small>{contact.title || "Role not set"}</small></span></span>)}
                {!contacts.length ? <span className="muted-row"><CircleUserRound size={15} /> No decision-maker found yet</span> : null}
              </div>
              <Link className="card-link" href={inResearch ? `/targets?target=${primary.id}` : `/pipeline?opportunity=${primary.id}`}>{inResearch ? "Open target" : "Open relationship"} <ArrowRight size={15} /></Link>
            </article>
          );
        })}
      </section>
      {!sorted.length ? <EmptyResult title="No companies match" detail="Try a broader name or clear the sector filter." /> : null}
      {addingCompany ? <CompanyEditorDialog company={null} offers={snapshot.offers} onClose={() => setAddingCompany(false)} onSaved={(_, opportunityId) => { setAddingCompany(false); if (opportunityId) router.push(`/targets?target=${opportunityId}`); else router.refresh(); }} /> : null}
    </WorkspaceFrame>
  );
}

export function GlobalSearch({ snapshot }: { snapshot: BoardSnapshot }) {
  const [query, setQuery] = useState("");
  const normalised = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (normalised.length < 2) return [];
    return snapshot.opportunities.flatMap((opportunity) => {
      const output: SearchResult[] = [];
      const stage = snapshot.stages.find((item) => item.id === opportunity.stageId);
      const href = isResearchStage(stage) ? `/targets?target=${opportunity.id}` : `/pipeline?opportunity=${opportunity.id}`;
      if (`${opportunity.company.name} ${opportunity.company.sector ?? ""} ${opportunity.company.researchNote ?? ""} ${opportunity.company.idealBuyerRoles ?? ""} ${opportunity.title} ${opportunity.offer?.name ?? ""} ${opportunity.offer?.description ?? ""} ${opportunity.outreachAngle ?? ""}`.toLowerCase().includes(normalised)) {
        output.push({ id: `opp-${opportunity.id}`, kind: isResearchStage(stage) ? "Research" : "Opportunity", title: opportunity.company.name, detail: `${snapshot.offers.filter((offer) => offer.active).length > 1 && opportunity.offer ? `${opportunity.offer.name} · ` : ""}${opportunity.title}`, href });
      }
      for (const contact of opportunity.contacts) {
        if (`${contact.name} ${contact.title ?? ""} ${contact.email ?? ""} ${contact.phone ?? ""} ${contact.linkedinUrl ?? ""}`.toLowerCase().includes(normalised)) {
          output.push({ id: `contact-${contact.id}`, kind: "Contact", title: contact.name, detail: `${contact.title || "Role not set"} · ${opportunity.company.name}`, href });
        }
      }
      for (const item of opportunity.activities) {
        if (`${item.notes ?? ""} ${item.outcome ?? ""} ${item.type.name}`.toLowerCase().includes(normalised)) {
          output.push({ id: `activity-${item.id}`, kind: "Activity", title: item.type.name, detail: `${item.notes || item.outcome || "No detail"} · ${opportunity.company.name}`, href });
        }
      }
      return output;
    }).slice(0, 40);
  }, [normalised, snapshot.offers, snapshot.opportunities, snapshot.stages]);

  return (
    <WorkspaceFrame title="Search" subtitle="Companies, contacts, opportunities and activity history">
      <section className="search-hero">
        <Sparkles size={20} />
        <div><h2>Find the thread, not just the record</h2><p>Search names, roles, sectors, notes, outcomes and outreach angles.</p></div>
        <label className="search-box search-box-hero"><Search size={18} /><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try ‘operations’ or a contact name" /></label>
      </section>

      {normalised.length < 2 ? (
        <section className="quick-searches"><span>Good starting points</span>{["operations", "overview", "Managing Director"].map((item) => <button type="button" key={item} onClick={() => setQuery(item)}>{item}</button>)}</section>
      ) : (
        <section className="result-list" aria-live="polite">
          <div className="result-count">{results.length} {results.length === 1 ? "result" : "results"}</div>
          {results.map((result) => <Link href={result.href} className="search-result" key={result.id}><span className={`result-kind result-kind-${result.kind.toLowerCase()}`}>{result.kind}</span><span><strong>{result.title}</strong><small>{highlight(result.detail, normalised)}</small></span><ArrowRight size={16} /></Link>)}
          {!results.length ? <EmptyResult title="Nothing found" detail="Try a company, person, role, activity type, outcome, or a phrase from your notes." /> : null}
        </section>
      )}
    </WorkspaceFrame>
  );
}

export function ReportsDashboard({ snapshot }: { snapshot: BoardSnapshot }) {
  const availableOffers = contextualOffers(snapshot.offers, snapshot.opportunities);
  const [offerFilter, setOfferFilter] = useState("all");
  const records = offerFilter === "all" ? snapshot.opportunities : snapshot.opportunities.filter((item) => item.offer?.id === offerFilter);
  const now = new Date(snapshot.generatedAt).getTime();
  const open = records.filter((item) => snapshot.stages.find((stage) => stage.id === item.stageId)?.terminalType === "open");
  const overdue = open.filter((item) => item.nextActionAt && new Date(item.nextActionAt).getTime() < now);
  const unscheduled = open.filter((item) => !item.nextActionAt);
  const atRisk = open.filter((item) => item.temperature === "at_risk" || item.temperature === "unresponsive");
  const pipelineValue = open.reduce((sum, item) => sum + (item.expectedValue ?? 0), 0);
  const weightedValue = open.reduce((sum, item) => sum + (item.expectedValue ?? 0) * ((item.probability ?? 0) / 100), 0);
  const health = Math.max(0, Math.min(100, 100 - overdue.length * 10 - unscheduled.length * 8 - atRisk.length * 5));
  const maxStage = Math.max(1, ...snapshot.stages.map((stage) => records.filter((item) => item.stageId === stage.id).length));
  const ownerCounts = snapshot.users.map((user) => ({ user, count: open.filter((item) => item.owner?.id === user.id).length }));
  const channelCounts = snapshot.activityTypes.reduce<Record<string, number>>((counts, type) => {
    counts[type.channel] ??= 0;
    return counts;
  }, {});
  records.flatMap((item) => item.activities).forEach((item) => { channelCounts[item.type.channel] = (channelCounts[item.type.channel] ?? 0) + 1; });

  return (
    <WorkspaceFrame title="Reports" subtitle={`Live pipeline health · Snapshot ${formatShortDate(snapshot.generatedAt)}`}>
      {availableOffers.length > 1 ? <section className="report-offer-toolbar"><span><Target size={16} />Report focus</span><select value={offerFilter} onChange={(event) => setOfferFilter(event.target.value)}><option value="all">All offers</option>{availableOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}{offer.active ? "" : " · Archived"}</option>)}</select></section> : null}
      <section className="report-metrics">
        <Metric icon={<Target />} label={pipelineValue ? "Weighted pipeline" : "Open opportunities"} value={pipelineValue ? formatMoney(weightedValue) : open.length} detail={pipelineValue ? `${formatMoney(pipelineValue)} unweighted · ${open.length} open` : `${records.length} total records`} />
        <Metric icon={<Clock3 />} label="Overdue next actions" value={overdue.length} detail={overdue.length ? "Needs a decision today" : "Clear — keep it that way"} tone={overdue.length ? "danger" : "good"} />
        <Metric icon={<AlertTriangle />} label="No next action" value={unscheduled.length} detail="Open records without a plan" tone={unscheduled.length ? "warning" : "good"} />
        <Metric icon={<Activity />} label="Pipeline health" value={`${health}%`} detail={health >= 80 ? "Strong operating rhythm" : "Triage the attention list"} tone={health >= 80 ? "good" : "warning"} />
      </section>

      <div className="report-grid">
        <section className="surface report-panel">
          <div className="surface-header"><div><h2>Stage distribution</h2><p>Where current attention is accumulating</p></div><Workflow size={18} /></div>
          <div className="bar-list">{snapshot.stages.map((stage) => { const count = records.filter((item) => item.stageId === stage.id).length; return <div className="bar-row" key={stage.id}><span>{stage.name}</span><div><i style={{ width: `${Math.max(count ? 8 : 0, (count / maxStage) * 100)}%`, background: stage.colour }} /></div><strong>{count}</strong></div>; })}</div>
        </section>
        {availableOffers.length > 1 ? <section className="surface report-panel"><div className="surface-header"><div><h2>Offer mix</h2><p>Current focus and retained history</p></div><Target size={18} /></div><div className="offer-mix">{availableOffers.map((offer) => { const count = snapshot.opportunities.filter((item) => item.offer?.id === offer.id).length; return <button type="button" key={offer.id} onClick={() => setOfferFilter(offer.id)} data-active={offerFilter === offer.id}><i style={{ background: offer.colour }} /><span><strong>{offer.name}{offer.active ? "" : " · Archived"}</strong><small>{count} {count === 1 ? "record" : "records"}</small></span><b>{count}</b></button>; })}</div></section> : null}
        <section className="surface report-panel">
          <div className="surface-header"><div><h2>Owner load</h2><p>Open opportunities by teammate</p></div><Users size={18} /></div>
          <div className="owner-load">{ownerCounts.map(({ user, count }) => <div key={user.id}><span className="mini-avatar">{initials(user.name)}</span><span><strong>{user.name}</strong><small>{count} open</small></span><div className="load-dots" aria-label={`${count} open opportunities`}>{Array.from({ length: Math.max(1, count) }, (_, index) => <i key={index} data-empty={count === 0} />)}</div></div>)}</div>
        </section>
        <section className="surface report-panel">
          <div className="surface-header"><div><h2>Activity mix</h2><p>Recorded touchpoints in this snapshot</p></div><MessageSquareText size={18} /></div>
          <div className="channel-stats">{Object.entries(channelCounts).map(([channel, count]) => <div key={channel}><strong>{count}</strong><span>{sentenceCase(channel)}</span></div>)}</div>
        </section>
        <section className="surface report-panel attention-panel">
          <div className="surface-header"><div><h2>Needs attention</h2><p>The shortest route to a healthier board</p></div><AlertTriangle size={18} /></div>
          <div className="attention-list">{[...new Map([...overdue, ...unscheduled, ...atRisk].map((item) => [item.id, item])).values()].slice(0, 6).map((item) => <Link href={`/pipeline?opportunity=${item.id}`} key={item.id}><span><strong>{item.company.name}</strong><small>{attentionReason(item, now)}</small></span><ArrowRight size={15} /></Link>)}{!overdue.length && !unscheduled.length && !atRisk.length ? <div className="all-clear"><Check size={17} /> Every open record has a healthy next step.</div> : null}</div>
        </section>
      </div>
    </WorkspaceFrame>
  );
}

const playbookFlow = [
  { title: "Research", detail: "Find one useful operational fact", icon: Compass, tone: "cyan" },
  { title: "Choose a route", detail: "Pick the person and best channel", icon: Route, tone: "blue" },
  { title: "Make a touch", detail: "One observation, one small ask", icon: Send, tone: "purple" },
  { title: "Read the signal", detail: "Log outcome, not just activity", icon: Radio, tone: "amber" },
  { title: "Decide", detail: "Follow up, nurture or close", icon: MessageCircle, tone: "green" },
] as const;

const playbookItems = [
  { id: "opener", category: "Outreach", title: "Proof-led opener", description: "Earn relevance before asking for time.", when: "First direct message or email to a credible owner.", guardrail: "Use one approved proof point; never imply they are already a customer.", body: "Hi [name] — I noticed [specific operational context]. [[offer-positioning]] [Approved proof, if relevant.] Is improving [relevant process] on your list this quarter?" },
  { id: "referral", category: "Outreach", title: "Warm referral ask", description: "A low-friction route when the role is close, but not exact.", when: "The person is relevant, but ownership is uncertain.", guardrail: "Ask for a name or role—not a meeting and a referral at the same time.", body: "Thanks, [name]. I may have the ownership wrong: who looks after how store teams complete and evidence [process] across the estate? A name or role is genuinely enough — I’ll keep the context concise." },
  { id: "discovery", category: "Discovery", title: "Evidence gap prompts", description: "Questions that reveal workflow cost without manufacturing pain.", when: "A contact is engaged and willing to compare the current routine.", guardrail: "Follow their answer. Do not march through every question like a script.", body: "How is the check completed today?\nWho can see that it happened?\nWhat happens when a site misses it?\nWhere does evidence live when someone needs it quickly?\nWhat would a simpler routine make possible?" },
  { id: "diagnostic", category: "Offer", title: "Lightweight review offer", description: "Give value before asking for a full discovery call.", when: "There is relevance, but a meeting is still too large a commitment.", guardrail: "A diagnostic is one option—not a compulsory pipeline step.", body: "I can send a one-page review your team can use to sense-check the current workflow across ownership, visibility, follow-up and evidence. No form or meeting required. If it surfaces a gap, we can compare notes for 15 minutes." },
  { id: "already", category: "Objection", title: "We already have a system", description: "Respect the incumbent and test the workflow around it.", when: "The contact points to existing software or an established process.", guardrail: "Do not attack the incumbent; distinguish the frontline routine from the system of record.", body: "That makes sense — most teams we speak with do. The useful question is usually not whether a system exists, but whether the frontline routine is easy enough to complete and the evidence easy enough to retrieve. If both are working well, I’ll happily leave it there." },
  { id: "timing", category: "Objection", title: "Not a priority", description: "Keep dignity and create a legitimate future trigger.", when: "There is a credible fit, but no active timing.", guardrail: "Nurture only when a real trigger and re-entry date are recorded.", body: "Understood. I won’t manufacture urgency. What would normally move this up the list — an audit, rollout, incident, leadership change, or a wider systems review? I can close the loop now and only return if that trigger appears." },
] as const;

const salesAssetDefinitions = [
  { id: "website", title: "Website / service page", purpose: "A credible home for the problem, product and proof.", moment: "Before or after a first touch", icon: Globe2 },
  { id: "walkthrough", title: "Video walkthrough", purpose: "A short human explanation of the routine and outcome.", moment: "When a contact wants context without a meeting", icon: Video },
  { id: "playable_demo", title: "Playable demo", purpose: "Something concrete to use live in a review or meeting.", moment: "Engaged, review booked or internal hand-off", icon: MonitorPlay },
  { id: "benefits_pdf", title: "Benefits one-pager", purpose: "A forwardable summary for email and internal sharing.", moment: "After relevance is established", icon: FileText },
  { id: "qualifier", title: "Light qualifier", purpose: "A short questionnaire that reveals fit without creating homework.", moment: "Before a review or as an asynchronous alternative", icon: ListChecks },
  { id: "compliance_research", title: "Industry research", purpose: "Useful evidence that earns attention and sharpens discovery.", moment: "Research, outreach and nurture", icon: LibraryBig },
] as const;

export function PlaybookWorkspace({ offers, assetsByOffer, canManageAssets }: { offers: OfferSummary[]; assetsByOffer: Record<string, SalesAssetSummary[]>; canManageAssets: boolean }) {
  const [category, setCategory] = useState("Outreach");
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState(defaultOffer(offers)?.id ?? offers[0]?.id ?? "");
  const [assetLists, setAssetLists] = useState(assetsByOffer);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const selectedOffer = offers.find((offer) => offer.id === selectedOfferId) ?? offers[0];
  const assetList = assetLists[selectedOfferId] ?? [];
  const categories = [...new Set(playbookItems.map((item) => item.category))];
  async function copy(id: string, body: string) {
    await navigator.clipboard.writeText(body);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1800);
  }
  return (
    <WorkspaceFrame title="Sales guide" subtitle="What to do before, during and after a first conversation">
      <section className="playbook-hero"><span className="playbook-hero-icon"><BookOpen size={24} /></span><div><span className="eyebrow">A practical guide{selectedOffer ? ` · ${selectedOffer.name}` : ""}</span><h2>Know what to do, say and send.</h2><p>This is your calm reference when you are preparing outreach, writing a message, or deciding what should happen next.</p>{offers.length > 1 ? <label className="playbook-offer-select">Guide for<select value={selectedOfferId} onChange={(event) => { setSelectedOfferId(event.target.value); setSelectedAssetId(null); }}>{offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label> : null}</div><aside><small>The useful message</small><strong>Observation → relevance → proof → small ask</strong><span>{selectedOffer?.positioning || "Be specific, useful and easy to answer."}</span></aside></section>

      <section className="playbook-start surface"><header><span className="eyebrow">Start here</span><h2>Three steps are enough</h2><p>You do not need to learn a system before doing useful sales work.</p></header><div><Link href="/targets"><span>1</span><strong>Prepare</strong><small>Choose a credible company, person and reason to contact them.</small><ArrowRight size={17} /></Link><button type="button" onClick={() => setCategory("Outreach")}><span>2</span><strong>Start a conversation</strong><small>Use one observation and one small, answerable ask.</small><ArrowRight size={17} /></button><Link href="/pipeline"><span>3</span><strong>Record the signal</strong><small>Log the outcome, set the next move, or close the loop.</small><ArrowRight size={17} /></Link></div></section>

      <div className="playbook-tools">
        <details className="playbook-tool surface"><summary><span><Route size={20} /><span><strong>Plan an outreach rhythm</strong><small>A light multi-channel sequence—never an automated chase.</small></span></span><ChevronDown size={18} /></summary><div className="playbook-tool-content"><div className="playbook-flow">{playbookFlow.map((step, index) => { const Icon = step.icon; return <div className="playbook-flow-step" data-tone={step.tone} key={step.title}><span><Icon size={17} /></span><div><strong>{step.title}</strong><small>{step.detail}</small></div>{index < playbookFlow.length - 1 ? <ArrowRight className="playbook-flow-arrow" size={16} /> : null}</div>; })}</div><section className="cadence-board"><div><span className="eyebrow">A sensible first sequence</span><h2>Vary the route, not the pressure</h2><p>Stop or adapt when the evidence changes.</p></div><ol><li><b>Day 1</b><span><strong>LinkedIn or email</strong><small>Observation + one question</small></span></li><li><b>Day 4–6</b><span><strong>Use a second channel</strong><small>Add new value</small></span></li><li><b>Day 10–14</b><span><strong>Close the loop</strong><small>Pause, redirect or set a trigger</small></span></li></ol></section></div></details>

        <details className="playbook-tool surface"><summary><span><LibraryBig size={20} /><span><strong>Check what proof is ready</strong><small>Open an asset only when you need to send or improve it.</small></span></span><span className="asset-kit-progress">{assetList.filter((asset) => asset.status === "ready").length} / {assetList.length} ready</span><ChevronDown size={18} /></summary><div className="playbook-tool-content"><div className="asset-browser">{salesAssetDefinitions.map((definition) => { const asset = assetList.find((item) => item.id === definition.id); if (!asset) return null; const Icon = definition.icon; return <button className="asset-tile" data-status={asset.status} aria-pressed={selectedAssetId === asset.id} type="button" key={definition.id} onClick={() => setSelectedAssetId((current) => current === asset.id ? null : asset.id)}><span className="asset-tile-icon"><Icon size={20} /></span><span><strong>{definition.title}</strong><small>{definition.purpose}</small></span><i>{assetStatusLabel(asset.status)}</i><ChevronDown size={17} /></button>; })}</div>{selectedAssetId ? (() => { const definition = salesAssetDefinitions.find((item) => item.id === selectedAssetId); const asset = assetList.find((item) => item.id === selectedAssetId); return definition && asset && selectedOffer ? <SalesAssetEditor definition={definition} asset={asset} offerId={selectedOffer.id} canManage={canManageAssets} onClose={() => setSelectedAssetId(null)} onSaved={(saved) => setAssetLists((items) => ({ ...items, [selectedOffer.id]: (items[selectedOffer.id] ?? []).map((item) => item.id === saved.id ? saved : item) }))} /> : null; })() : null}</div></details>
      </div>

      <section className="playbook-patterns"><header><div><span className="eyebrow">When you need words</span><h2>Copy a starting point</h2><p>Choose the moment, then open one pattern. Adapt it until it sounds like you.</p></div><div className="segmented" role="tablist" aria-label="Sales guide category">{categories.map((item) => <button role="tab" aria-selected={category === item} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div></header><div className="playbook-grid">{playbookItems.filter((item) => item.category === category).map((item) => { const body = adaptPlaybookBody(item.body, selectedOffer); return <details className="playbook-card" data-category={item.category.toLowerCase()} key={item.id}><summary><span><span className="eyebrow">{item.category}</span><strong>{item.title}</strong><small>{item.description}</small></span><ChevronDown size={19} /></summary><div className="playbook-card-content"><div className="playbook-card-meta"><div><small>Use when</small><span>{item.when}</span></div><div><small>Guardrail</small><span>{item.guardrail}</span></div></div><div className="playbook-copy"><span>Adapt this</span><p>{body}</p></div><button className="btn btn-quiet" type="button" onClick={() => copy(item.id, body)}>{copied === item.id ? <Check size={15} /> : <Copy size={15} />}{copied === item.id ? "Copied" : "Copy pattern"}</button></div></details>; })}</div></section>
      <p className="playbook-note"><ShieldCheck size={16} /> Use approved proof, replace every bracketed field, and read the message aloud before sending.</p>
    </WorkspaceFrame>
  );
}

function SalesAssetEditor({ definition, asset, offerId, canManage, onClose, onSaved }: { definition: (typeof salesAssetDefinitions)[number]; asset: SalesAssetSummary; offerId: string; canManage: boolean; onClose: () => void; onSaved: (asset: SalesAssetSummary) => void }) {
  const Icon = definition.icon;
  const [status, setStatus] = useState(asset.status);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const result = await saveSalesAssetAction({ offerId, id: asset.id, status, url: form.get("url"), note: form.get("note") });
    setPending(false);
    setMessage(result.ok ? "Saved" : result.error);
    if (result.ok) onSaved({ ...asset, status, url: String(form.get("url") ?? ""), note: String(form.get("note") ?? "") });
  }

  return <form className="asset-editor" data-status={status} onSubmit={submit}><header><span><Icon size={21} /></span><div><h3>{definition.title}</h3><p>{definition.purpose}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close asset details"><X size={15} /></button></header><p className="asset-moment"><strong>Best used:</strong> {definition.moment}</p><div className="asset-editor-fields"><label className="field-label">Status<select className="field-select" aria-label={`${definition.title} status`} value={status} onChange={(event) => setStatus(event.target.value as SalesAssetSummary["status"])} disabled={!canManage}><option value="untracked">Needs checking</option><option value="missing">Missing</option><option value="in_progress">In progress</option><option value="ready">Ready</option></select></label><label className="field-label">Link<input className="field" name="url" type="url" defaultValue={asset.url ?? ""} placeholder="https://..." readOnly={!canManage} /></label><label className="field-label asset-note-field">Owner / next step<textarea className="field-textarea" name="note" defaultValue={asset.note ?? ""} placeholder="Who owns it, or what is missing?" readOnly={!canManage} /></label></div><footer><span>{canManage ? message : "View only - asset editing is limited to managers and admins."}</span>{canManage ? <button className="btn btn-primary btn-compact" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{pending ? "Saving..." : "Save asset"}</button> : null}</footer></form>;
}

function assetStatusLabel(status: SalesAssetSummary["status"]) {
  return ({ untracked: "Check", missing: "Missing", in_progress: "In progress", ready: "Ready" } as const)[status];
}

function adaptPlaybookBody(body: string, offer?: OfferSummary) {
  const positioning = offer?.positioning?.trim();
  return body.replace("[[offer-positioning]]", positioning || "[One clear sentence about how this offer helps]");
}

export type RuntimeStatus = {
  demoMode: boolean;
  storageMode: BoardSnapshot["storageMode"];
  databaseConfigured: boolean;
  aiEnabled: boolean;
  aiProvider: "local" | "openai";
  aiKeyConfigured: boolean;
  aiModel: string;
  workspaceAiEnabled: boolean;
  passwordAuthActive: boolean;
  passwordResetConfigured: boolean;
  mcpEnabled: boolean;
  mcpEndpoint: string;
  mcpConnections: Array<{ clientId: string; name: string; scopes: string; createdAt: string }>;
  freeMaxStatus: FreeMaxStatus;
  version: string;
  backupAutomationConfigured: boolean;
  safeUpdateConfigured: boolean;
};
export type ImportStatus = { available: boolean; fileName?: string; totalRows?: number; companies?: number; contacts?: number; duplicates?: number; invalid?: number; error?: string };

export function SettingsDashboard({ snapshot, runtime, importStatus, currentMemberId, currentRole }: { snapshot: BoardSnapshot; runtime: RuntimeStatus; importStatus: ImportStatus; currentMemberId: string; currentRole: "admin" | "manager" | "member" }) {
  const router = useRouter();
  const [workspaceAiEnabled, setWorkspaceAiEnabled] = useState(runtime.workspaceAiEnabled);
  const [aiPending, setAiPending] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiSetupOpen, setAiSetupOpen] = useState(false);
  const [aiConfigCopied, setAiConfigCopied] = useState(false);
  const [mcpEndpointCopied, setMcpEndpointCopied] = useState(false);
  const [mcpConnections, setMcpConnections] = useState(runtime.mcpConnections);
  const [mcpRevokePending, setMcpRevokePending] = useState<string | null>(null);
  const [mcpMessage, setMcpMessage] = useState<string | null>(null);
  const [updatePending, setUpdatePending] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [activityTypes, setActivityTypes] = useState(snapshot.activityTypes);
  const [activityEditor, setActivityEditor] = useState<ActivityTypeSummary | "new" | null>(null);
  const [importPending, setImportPending] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [team, setTeam] = useState(snapshot.users);
  const [teamEditor, setTeamEditor] = useState<PersonSummary | "new" | null>(null);
  const [offerList, setOfferList] = useState(snapshot.offers);
  const [offerEditor, setOfferEditor] = useState<OfferSummary | "new" | null>(null);
  const [stageList, setStageList] = useState(snapshot.stages);
  const [stageEditor, setStageEditor] = useState<StageSummary | "new" | null>(null);
  const [pipelineName, setPipelineName] = useState(snapshot.pipeline.name);
  const [editingPipelineName, setEditingPipelineName] = useState(false);
  const [pipelinePending, setPipelinePending] = useState(false);
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);
  const [editionKey, setEditionKey] = useState<EditionKey>(snapshot.edition);
  const [editionChoice, setEditionChoice] = useState<EditionKey>(snapshot.edition);
  const [editingEdition, setEditingEdition] = useState(false);
  const [editionPending, setEditionPending] = useState(false);
  const [editionMessage, setEditionMessage] = useState<string | null>(null);
  const edition = getEdition(editionKey);
  const currentMember = team.find((member) => member.id === currentMemberId);
  const readinessChecks = [
    { label: "Pipeline named", ready: pipelineName.trim().length >= 2 },
    { label: "Offer defined", ready: offerList.some((offer) => offer.active) },
    { label: "Team and roles", ready: team.some((member) => member.active !== false) },
    { label: "Activity types", ready: activityTypes.length > 0 },
    { label: "Protected login", ready: runtime.passwordAuthActive },
    { label: "Password recovery", ready: runtime.passwordResetConfigured },
  ];
  const readinessCount = readinessChecks.filter((item) => item.ready).length;

  async function savePipelineName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPipelinePending(true);
    setPipelineMessage(null);
    const result = await savePipelineNameAction({ name: pipelineName });
    setPipelinePending(false);
    setPipelineMessage(result.ok ? "Pipeline name saved." : result.error);
    if (result.ok) {
      setEditingPipelineName(false);
      router.refresh();
    }
  }

  async function saveEdition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEditionPending(true);
    setEditionMessage(null);
    const result = await saveWorkspaceEditionAction({ edition: editionChoice });
    setEditionPending(false);
    if (!result.ok) return setEditionMessage(result.error);
    setEditionKey(editionChoice);
    setEditingEdition(false);
    setEditionMessage("Sales model saved. Existing stages, offers and records were left unchanged.");
    router.refresh();
  }

  async function toggleAi() {
    setAiPending(true);
    setAiMessage(null);
    const enabled = !workspaceAiEnabled;
    const result = await setWorkspaceAiEnabledAction({ enabled });
    setAiPending(false);
    if (!result.ok) {
      setAiMessage(result.error);
      return;
    }
    setWorkspaceAiEnabled(enabled);
    setAiMessage(enabled ? "AI coaching enabled for this workspace." : "AI coaching disabled for this workspace.");
  }

  async function importTracker() {
    setImportPending(true);
    setImportMessage(null);
    const result = await importLocalTrackerAction();
    setImportPending(false);
    if (!result.ok) {
      setImportMessage(result.error);
      return;
    }
    const report = result.report;
    setImportMessage(result.alreadyCommitted
      ? "This exact tracker is already in the workspace; no duplicates were created."
      : `Imported ${report.opportunitiesCreated} opportunities and ${report.contactsCreated} contacts.`);
    router.refresh();
  }

  async function copyAiConfiguration() {
    await navigator.clipboard.writeText(`AI_PROVIDER=openai\nAI_MODEL=${runtime.aiModel}\nOPENAI_API_KEY=sk-proj-your-server-side-key`);
    setAiConfigCopied(true);
    window.setTimeout(() => setAiConfigCopied(false), 1_800);
  }

  async function copyMcpEndpoint() {
    await navigator.clipboard.writeText(runtime.mcpEndpoint);
    setMcpEndpointCopied(true);
    window.setTimeout(() => setMcpEndpointCopied(false), 1_800);
  }

  async function revokeMcpConnection(clientId: string) {
    if (!window.confirm("Disconnect this AI coworker? Its current access and refresh tokens will stop working.")) return;
    setMcpRevokePending(clientId);
    setMcpMessage(null);
    const result = await revokeMcpConnectionAction({ clientId });
    setMcpRevokePending(null);
    if (!result.ok) return setMcpMessage(result.error);
    setMcpConnections((connections) => connections.filter((connection) => connection.clientId !== clientId));
    setMcpMessage("Connection revoked.");
  }

  async function requestUpdate() {
    if (!window.confirm("Create and verify a fresh database backup, then deploy the approved release? The app may be unavailable briefly while CapRover completes its health check.")) return;
    setUpdatePending(true);
    setUpdateMessage(null);
    const result = await prepareSafeUpdateAction();
    setUpdatePending(false);
    setUpdateMessage(result.ok ? result.message : result.error);
  }

  return (
    <WorkspaceFrame title="Settings" subtitle="Workspace shape, data readiness and operational guardrails">
      <section className="surface settings-readiness" data-ready={readinessCount === readinessChecks.length}>
        <span className="settings-readiness-icon"><ShieldCheck size={20} /></span>
        <div><span className="eyebrow">Workspace readiness</span><h2>{runtime.storageMode === "sqlite" ? "Development workspace is healthy" : `${readinessCount} of ${readinessChecks.length} go-live checks complete`}</h2><p>{runtime.storageMode === "sqlite" ? "SQLite is ideal for building and evaluating. PostgreSQL activates protected team logins for live use." : readinessCount === readinessChecks.length ? "The core operational and access controls are in place." : "Review the remaining essentials before inviting the team."}</p></div>
        <details><summary>Review setup <ChevronDown size={15} /></summary><div>{readinessChecks.map((item) => <span key={item.label} data-ready={item.ready}>{item.ready ? <Check size={13} /> : <AlertTriangle size={13} />}{item.label}</span>)}</div></details>
      </section>
      <section className="settings-grid">
        <article className="surface settings-card settings-card-wide edition-settings-card">
          <div className="settings-icon"><Compass /></div>
          <div><h2>Sales model</h2><p>Choose the shape of selling work, not a separate CRM</p></div>
          {currentRole === "admin" && !editingEdition ? <button className="btn btn-quiet settings-card-action" type="button" onClick={() => { setEditionChoice(editionKey); setEditingEdition(true); setEditionMessage(null); }}><Pencil size={14} />Change</button> : null}
          {editingEdition && currentRole === "admin" ? <form className="edition-editor" onSubmit={saveEdition}>
            <div className="edition-options">{editions.map((item) => <label key={item.key} data-selected={editionChoice === item.key}><input type="radio" name="edition" value={item.key} checked={editionChoice === item.key} onChange={() => setEditionChoice(item.key)} /><span><strong>{item.name}</strong><small>{item.audience}</small><em>{item.description}</em></span></label>)}</div>
            <p><ShieldCheck size={14} />Changing the model updates guidance and terminology only. It never rewrites existing stages, offers or sales records.</p>
            {editionMessage ? <small className="form-error">{editionMessage}</small> : null}
            <div className="button-row"><button className="btn btn-quiet" type="button" onClick={() => setEditingEdition(false)}>Cancel</button><button className="btn btn-primary" type="submit" disabled={editionPending}>{editionPending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{editionPending ? "Saving…" : "Save model"}</button></div>
          </form> : <div className="edition-current"><span className="edition-mark">{edition.shortName.slice(0, 1)}</span><span><strong>{edition.name}</strong><small>{edition.audience}</small><em>{edition.description}</em></span></div>}
          {!editingEdition && editionMessage ? <p className="settings-hint">{editionMessage}</p> : null}
        </article>
        <article className="surface settings-card"><div className="settings-icon"><Users /></div><div><h2>Team access</h2><p>{team.length} active members · role-based access</p></div>{currentRole === "admin" ? <button className="btn btn-quiet settings-card-action" type="button" onClick={() => setTeamEditor("new")}><Plus size={14} />Add member</button> : null}<div className="settings-list">{team.map((user) => <span key={user.id}><i className="mini-avatar">{initials(user.name)}</i><span><strong>{user.name}{user.id === currentMemberId ? " · You" : ""}</strong><small>{user.email || "No email"} · {roleLabel(user.role)}</small></span>{currentRole === "admin" ? <button className="icon-button taxonomy-edit" type="button" onClick={() => setTeamEditor(user)} aria-label={`Edit ${user.name}`}><Pencil size={13} /></button> : null}</span>)}</div><p className="settings-hint">Admins manage access and workspace settings. Managers can run imports and maintain sales assets. Sales support can work opportunities, contacts, tasks and activities but cannot manage the team.</p>{runtime.storageMode === "sqlite" ? <p className="settings-local-note"><ShieldCheck size={14} />Local SQLite is one trusted admin session. This roster and its roles are ready for migration; separate logins become active on PostgreSQL.</p> : null}{teamEditor ? <TeamMemberEditor member={teamEditor === "new" ? null : teamEditor} storageMode={runtime.storageMode} currentMemberId={currentMemberId} onClose={() => setTeamEditor(null)} onSaved={(saved) => { setTeam((items) => items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]); setTeamEditor(null); }} onDeactivated={(id) => { setTeam((items) => items.filter((item) => item.id !== id)); setTeamEditor(null); }} /> : null}</article>
        <article className="surface settings-card settings-card-offers"><div className="settings-icon"><Target /></div><div><h2>Offers</h2><p>{offerList.filter((offer) => offer.active).length} active · what the team can pitch</p></div>{currentRole === "admin" ? <button className="btn btn-quiet settings-card-action" type="button" onClick={() => setOfferEditor("new")}><Plus size={14} />Add offer</button> : null}<div className="offer-settings-list">{offerList.filter((offer) => offer.active).sort((a, b) => a.position - b.position).map((offer) => <button type="button" key={offer.id} onClick={() => currentRole === "admin" && setOfferEditor(offer)} disabled={currentRole !== "admin"}><i style={{ background: offer.colour }} /><span><strong>{offer.name}{offer.isDefault ? " · Default" : ""}</strong><small>{offer.description || "Add a short description"}</small></span>{currentRole === "admin" ? <Pencil size={13} /> : null}</button>)}</div><p className="settings-hint">With one active offer, GUD stays visually single-focus. Add a second and offer controls appear only where they help.</p>{offerEditor && currentRole === "admin" ? <OfferEditor offer={offerEditor === "new" ? null : offerEditor} activeCount={offerList.filter((offer) => offer.active).length} onClose={() => setOfferEditor(null)} onSaved={(saved) => { setOfferList((items) => items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : saved.isDefault ? { ...item, isDefault: false } : item) : [...items.map((item) => saved.isDefault ? { ...item, isDefault: false } : item), saved]); setOfferEditor(null); }} onArchived={(id) => { setOfferList((items) => items.map((item) => item.id === id ? { ...item, active: false } : item)); setOfferEditor(null); }} /> : null}</article>
        <article className="surface settings-card settings-card-stages"><div className="settings-icon"><Workflow /></div><div><h2>Pipeline stages</h2><p>{stageList.filter((stage) => !isResearchStage(stage)).length} visible sales stages</p></div>{currentRole === "admin" ? <button className="btn btn-quiet settings-card-action" type="button" onClick={() => setStageEditor("new")}><Plus size={14} />Add stage</button> : null}<div className="stage-settings-list">{stageList.filter((stage) => !isResearchStage(stage)).sort((a, b) => a.position - b.position).map((stage) => <button type="button" key={stage.id} onClick={() => currentRole === "admin" && setStageEditor(stage)} disabled={currentRole !== "admin"}><i style={{ background: stage.colour }} /><span><strong>{stage.name}</strong><small>{settingsStageGuidance(stage.name)}</small></span>{currentRole === "admin" ? <Pencil size={13} /> : null}</button>)}</div><p className="settings-hint">Targets stays outside the active pipeline. Removing a stage first moves every opportunity into a destination you choose, so records and history stay intact.</p>{stageEditor && currentRole === "admin" ? <PipelineStageEditor stage={stageEditor === "new" ? null : stageEditor} stages={stageList.filter((stage) => !isResearchStage(stage))} opportunityCounts={Object.fromEntries(stageList.map((stage) => [stage.id, snapshot.opportunities.filter((item) => item.stageId === stage.id).length]))} onClose={() => setStageEditor(null)} onSaved={(saved) => { setStageList((items) => items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]); setStageEditor(null); }} onArchived={(id) => { setStageList((items) => items.filter((item) => item.id !== id)); setStageEditor(null); }} /> : null}</article>

        <article className="surface settings-card"><div className="settings-icon"><Pencil /></div><div><h2>Pipeline name</h2><p>The title shown above the board</p></div>{currentRole === "admin" && !editingPipelineName ? <button className="btn btn-quiet settings-card-action" type="button" onClick={() => setEditingPipelineName(true)}><Pencil size={14} />Edit</button> : null}{editingPipelineName && currentRole === "admin" ? <form className="settings-inline-form" onSubmit={savePipelineName}><label className="field-label">Name<input className="field" value={pipelineName} onChange={(event) => setPipelineName(event.target.value)} required minLength={2} autoFocus /></label><div className="button-row"><button className="btn btn-quiet" type="button" onClick={() => { setPipelineName(snapshot.pipeline.name); setEditingPipelineName(false); setPipelineMessage(null); }}>Cancel</button><button className="btn btn-primary" type="submit" disabled={pipelinePending}>{pipelinePending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{pipelinePending ? "Saving…" : "Save name"}</button></div>{pipelineMessage ? <small>{pipelineMessage}</small> : null}</form> : <div className="settings-readonly-value"><strong>{pipelineName}</strong><small>{currentRole === "admin" ? "Click Edit to change it." : "Only an admin can change this."}</small></div>}</article>

        <article className="surface settings-card"><div className="settings-icon"><Download /></div><div><h2>Light backup</h2><p>A consistent point-in-time copy of the local database</p></div><div className="backup-panel"><a className={`btn btn-primary${runtime.storageMode !== "sqlite" || currentRole !== "admin" ? " is-disabled" : ""}`} href={runtime.storageMode === "sqlite" && currentRole === "admin" ? "/api/backup" : undefined} aria-disabled={runtime.storageMode !== "sqlite" || currentRole !== "admin"}><Download size={14} />Download SQLite backup</a><p>{runtime.storageMode === "sqlite" ? "Download after meaningful work and store it away from this computer. The file includes contacts, activity, settings and audit history." : "On the VPS, use encrypted daily volume/database snapshots with retention instead of emailing a database full of contact data."}</p></div></article>
        <article className="surface settings-card system-update-card"><div className="settings-icon"><RefreshCw /></div><div><h2>Safe updates</h2><p>Version {runtime.version} · backup before deployment</p></div><div className="status-list"><StatusRow label="Database backup hook" value={runtime.backupAutomationConfigured ? "Connected" : "Setup required"} good={runtime.backupAutomationConfigured} /><StatusRow label="Deployment hook" value={runtime.safeUpdateConfigured ? "Connected" : "Setup required"} good={runtime.safeUpdateConfigured} /><StatusRow label="Bootstrap protection" value={runtime.storageMode === "postgres" ? "Live data preserved" : "Local mode"} good /></div><div className="settings-ai-control"><button className="btn btn-primary" type="button" onClick={requestUpdate} disabled={currentRole !== "admin" || updatePending || !runtime.safeUpdateConfigured}>{updatePending ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{updatePending ? "Preparing…" : "Back up & update"}</button>{updateMessage ? <small>{updateMessage}</small> : !runtime.safeUpdateConfigured ? <small>Configure both server-side webhooks before this control becomes available.</small> : <small>GUD verifies the backup hook before requesting a deployment.</small>}</div></article>

        <article className="surface settings-card"><div className="settings-icon"><KeyRound /></div><div><h2>Login readiness</h2><p>Password and account recovery controls</p></div>{runtime.storageMode === "postgres" && currentRole === "admin" && currentMember ? <button className="btn btn-quiet settings-card-action" type="button" onClick={() => setTeamEditor(currentMember)}><KeyRound size={14} />Set my password</button> : null}<div className="status-list"><StatusRow label="Email/password sign-in" value={runtime.passwordAuthActive ? "Active" : "Starts with PostgreSQL"} good={runtime.passwordAuthActive} /><StatusRow label="Password reset email" value={runtime.passwordResetConfigured ? "Configured" : "Email sender required"} good={runtime.passwordResetConfigured} /><StatusRow label="Team administration" value={currentRole === "admin" ? "Admin only" : "Restricted"} good={currentRole === "admin"} /></div>{runtime.storageMode === "postgres" && currentRole === "admin" ? <p className="settings-hint">Use Set my password now. Email recovery becomes available after an outbound email sender is configured.</p> : null}</article>

        <article className="surface settings-card settings-card-wide"><div className="settings-icon"><MessageSquareText /></div><div><h2>Activity taxonomy</h2><p>{activityTypes.length} ways to record a touchpoint</p></div>{currentRole === "admin" ? <button className="btn btn-quiet settings-card-action" type="button" onClick={() => setActivityEditor("new")}><Plus size={14} />Add activity type</button> : null}<div className="taxonomy-list">{activityTypes.map((type) => <span key={type.id}><i style={{ background: type.colour }} /><span><strong>{type.name}</strong><small>{type.channel}</small></span>{currentRole === "admin" ? <button className="icon-button taxonomy-edit" type="button" onClick={() => setActivityEditor(type)} aria-label={`Edit ${type.name}`}><Pencil size={13} /></button> : null}</span>)}</div>{activityEditor && currentRole === "admin" ? <ActivityTypeEditor activityType={activityEditor === "new" ? null : activityEditor} onClose={() => setActivityEditor(null)} onSaved={(saved) => { setActivityTypes((items) => items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]); setActivityEditor(null); }} /> : null}</article>

        <article className="surface settings-card"><div className="settings-icon"><Database /></div><div><h2>Runtime</h2><p>Capabilities active for this process</p></div><div className="status-list"><StatusRow label="Data" value={runtime.storageMode === "sqlite" ? "Local SQLite" : runtime.storageMode === "postgres" ? "PostgreSQL" : "Demo snapshot"} good={runtime.storageMode !== "demo"} /><StatusRow label="VPS database" value={runtime.databaseConfigured ? "Configured" : "Not needed locally"} good={runtime.storageMode === "sqlite" || runtime.databaseConfigured} /><StatusRow label="AI available" value={runtime.aiEnabled ? "Available" : "Disabled by server"} good={runtime.aiEnabled} /></div></article>

        <article className="surface settings-card coworker-settings-card">
          <div className="settings-icon settings-icon-coworker"><Bot /></div>
          <div><h2>AI coworker connection</h2><p>Let Codex, ChatGPT or another MCP client work with this pipeline</p></div>
          <div className="status-list">
            <StatusRow label="Remote connector" value={runtime.mcpEnabled ? "Ready" : "Disabled by server"} good={runtime.mcpEnabled} />
            <StatusRow label="Access" value="Your GUD login + consent" good={runtime.mcpEnabled} />
            <StatusRow label="Research writes" value="Held for human review" good />
          </div>
          <div className="coworker-endpoint">
            <code>{runtime.mcpEndpoint}</code>
            <button className="btn btn-quiet" type="button" disabled={!runtime.mcpEnabled} onClick={copyMcpEndpoint}>{mcpEndpointCopied ? <Check size={14} /> : <Copy size={14} />}{mcpEndpointCopied ? "Copied" : "Copy endpoint"}</button>
          </div>
          <details className="coworker-setup-guide">
            <summary>How to connect Codex or ChatGPT <ChevronDown size={15} /></summary>
            <div>
              <section><b>1</b><span><strong>Codex desktop or IDE</strong><small>Open Settings → MCP servers → Add server. Choose Streamable HTTP, paste the endpoint, save and restart. Select Authenticate and approve the GUD connection.</small></span></section>
              <section><b>2</b><span><strong>ChatGPT Work</strong><small>Enable developer mode, then use Settings → Apps → Create. Paste the endpoint, scan the tools and complete GUD’s sign-in and permission screen. Availability depends on your ChatGPT plan and workspace controls.</small></span></section>
              <section><b>3</b><span><strong>Start with a safe request</strong><small>Try “Review my pipeline and show what needs attention.” For research, ask it to cite public sources and submit findings to Researching for human review.</small></span></section>
              <p><ShieldCheck size={14} />Connect each GUD instance separately. Read-only is the default; approve read/write only when you want the coworker to update this workspace.</p>
            </div>
          </details>
          {mcpConnections.length ? <div className="coworker-connections">
            {mcpConnections.map((connection) => <span key={connection.clientId}><Bot size={16} /><span><strong>{connection.name}</strong><small>{connection.scopes.includes("gud:write") ? "Read & write" : "Read-only"} · connected {new Date(connection.createdAt).toLocaleDateString("en-GB")}</small></span><button className="btn btn-quiet btn-compact" type="button" disabled={mcpRevokePending !== null} onClick={() => revokeMcpConnection(connection.clientId)}>{mcpRevokePending === connection.clientId ? <LoaderCircle className="spin" size={13} /> : <X size={13} />}Disconnect</button></span>)}
          </div> : null}
          {mcpMessage ? <small className="settings-hint">{mcpMessage}</small> : null}
          <p className="settings-hint">{runtime.mcpEnabled ? "Add this endpoint to your AI workspace once, sign in here, then grant read-only or read/write access. GUD never gives the client raw database access." : runtime.storageMode === "postgres" ? "Set MCP_ENABLED=true in the private server environment, redeploy, then return here to copy the endpoint." : "Remote MCP stays off in local SQLite and demo workspaces. Use a PostgreSQL deployment for separate logins and revocable connections."}</p>
        </article>

        <article className="surface settings-card ai-settings-card"><div className="settings-icon settings-icon-ai"><KeyRound /></div><div><h2>AI coach</h2><p>Provider, server-side key and workspace access</p></div><div className="status-list"><StatusRow label="Provider" value={runtime.aiProvider === "openai" ? "OpenAI Responses API" : "Local deterministic coach"} good={runtime.aiEnabled} /><StatusRow label="OpenAI key" value={runtime.aiKeyConfigured ? "Configured on server" : "Not configured"} good={runtime.aiKeyConfigured || runtime.aiProvider === "local"} /><StatusRow label="Model" value={runtime.aiProvider === "openai" ? runtime.aiModel : "No API model used"} good /><StatusRow label="Workspace AI" value={workspaceAiEnabled && runtime.aiEnabled ? "Enabled" : "Disabled"} good={workspaceAiEnabled && runtime.aiEnabled} /></div><div className="settings-ai-control"><button className="btn btn-quiet" type="button" disabled={aiPending || !runtime.aiEnabled || currentRole !== "admin"} onClick={toggleAi}><Sparkles size={14} />{aiPending ? "Saving..." : workspaceAiEnabled ? "Disable AI coach" : "Enable AI coach"}</button><button className="btn btn-primary" type="button" disabled={currentRole !== "admin"} onClick={() => setAiSetupOpen((value) => !value)}><KeyRound size={14} />{aiSetupOpen ? "Close setup" : "Configure OpenAI"}</button>{currentRole !== "admin" ? <small>Admin access is required to change AI settings.</small> : aiMessage ? <small>{aiMessage}</small> : null}</div>{aiSetupOpen && currentRole === "admin" ? <div className="ai-setup-panel"><div className="ai-setup-step"><b>1</b><span><strong>Create a project API key</strong><small>Use a dedicated project key with its own spend controls.</small></span><a className="btn btn-quiet" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Open API keys <ExternalLink size={13} /></a></div><div className="ai-setup-step"><b>2</b><span><strong>Add it to the server environment</strong><small>Use <code>.env.local</code> locally, or your VPS/CapRover secret variables in production.</small></span></div><code className="ai-env-block">AI_PROVIDER=openai{"\n"}AI_MODEL={runtime.aiModel}{"\n"}OPENAI_API_KEY=sk-proj-your-server-side-key</code><div className="ai-setup-actions"><button className="btn btn-quiet" type="button" onClick={copyAiConfiguration}>{aiConfigCopied ? <Check size={14} /> : <Copy size={14} />}{aiConfigCopied ? "Copied" : "Copy configuration"}</button><span><ShieldCheck size={14} />Never paste a live key into a browser form or commit it to Git. Restart the app after changing server variables.</span></div></div> : null}</article>
        <article className="surface settings-card settings-card-wide" id="import">
          <div className="settings-icon"><FileSpreadsheet /></div>
          <div><h2>Tracker import</h2><p>Review the local research file, then import it safely into this workspace</p></div>
          {importStatus.available ? <div className="import-summary"><StatusRow label="Source" value={importStatus.fileName ?? "Tracker"} good /><StatusRow label="Rows" value={String(importStatus.totalRows ?? 0)} good /><StatusRow label="Unique companies" value={String(importStatus.companies ?? 0)} good /><StatusRow label="Contacts" value={String(importStatus.contacts ?? 0)} good /><StatusRow label="Duplicate source rows" value={String(importStatus.duplicates ?? 0)} good={!importStatus.duplicates} /><StatusRow label="Invalid rows" value={String(importStatus.invalid ?? 0)} good={!importStatus.invalid} /></div> : <div className="import-empty"><FileSpreadsheet size={24} /><div><strong>{importStatus.error ? "Tracker could not be previewed" : "No local tracker is mounted"}</strong><p>{importStatus.error ?? "Keep workbooks outside Git, then pass a local path to the import command."}</p></div></div>}
          <div className="import-actions"><button className="btn btn-primary" type="button" disabled={importPending || !importStatus.available || Boolean(importStatus.invalid) || currentRole === "member"} onClick={importTracker}><FileSpreadsheet size={14} />{importPending ? "Importing…" : "Import into workspace"}</button>{currentRole === "member" ? <span>Managers or admins can run imports.</span> : importMessage ? <span>{importMessage}</span> : null}</div>
          <code className="command-line">npm run import:tracker -- &quot;C:\path\to\tracker.xlsx&quot; --commit</code>
          <p className="settings-hint">Imports are idempotent: importing the exact same workbook again will not duplicate records. SQLite needs no organisation ID; PostgreSQL does.</p>
        </article>
      </section>
    </WorkspaceFrame>
  );
}

function PipelineStageEditor({ stage, stages, opportunityCounts, onClose, onSaved, onArchived }: { stage: StageSummary | null; stages: StageSummary[]; opportunityCounts: Record<string, number>; onClose: () => void; onSaved: (stage: StageSummary) => void; onArchived: (id: string) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const destinations = stages.filter((item) => item.id !== stage?.id);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await savePipelineStageAction({ stageId: stage?.id ?? null, name: form.get("name"), colour: form.get("colour"), terminalType: form.get("terminalType") });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onSaved(result.stage);
  }

  async function archive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stage) return;
    const form = new FormData(event.currentTarget);
    const destinationStageId = String(form.get("destinationStageId") ?? "");
    const destination = stages.find((item) => item.id === destinationStageId);
    if (!destination || !window.confirm(`Remove ${stage.name} and move ${opportunityCounts[stage.id] ?? 0} ${opportunityCounts[stage.id] === 1 ? "opportunity" : "opportunities"} to ${destination.name}?`)) return;
    setPending(true);
    setError(null);
    const result = await archivePipelineStageAction({ stageId: stage.id, destinationStageId });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onArchived(stage.id);
  }

  if (removing && stage) return <form className="stage-editor" onSubmit={archive}><header><div><strong>Remove {stage.name}</strong><small>Nothing is deleted: choose where its {opportunityCounts[stage.id] ?? 0} current {opportunityCounts[stage.id] === 1 ? "opportunity goes" : "opportunities go"}.</small></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close stage editor"><X size={14} /></button></header><label className="field-label">Move opportunities to<select name="destinationStageId" defaultValue={destinations[0]?.id ?? ""} required>{destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{error ? <p className="settings-form-error">{error}</p> : null}<div className="team-editor-actions"><button className="btn btn-quiet" type="button" onClick={() => setRemoving(false)}>Back</button><button className="btn btn-danger" type="submit" disabled={pending || !destinations.length}><Trash2 size={14} />{pending ? "Moving…" : "Move and remove"}</button></div></form>;

  return <form className="stage-editor" onSubmit={submit}><header><div><strong>{stage ? `Edit ${stage.name}` : "Add a pipeline stage"}</strong><small>Keep stages outcome-based and few enough to understand at a glance.</small></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close stage editor"><X size={14} /></button></header><div className="stage-editor-fields"><label className="field-label">Name<input className="field" name="name" defaultValue={stage?.name ?? ""} required minLength={2} placeholder="Commercial review" /></label><label className="field-label">Meaning<select name="terminalType" defaultValue={stage?.terminalType === "nurture" ? "open" : stage?.terminalType ?? "open"}><option value="open">Work in progress</option><option value="won">Won / converted</option><option value="lost">Lost / closed</option></select></label><label className="field-label colour-field">Colour<input name="colour" type="color" defaultValue={stage?.colour ?? "#0073EA"} /></label></div>{error ? <p className="settings-form-error">{error}</p> : null}<div className="team-editor-actions">{stage && destinations.length ? <button className="btn btn-danger" type="button" onClick={() => setRemoving(true)} disabled={pending}><Trash2 size={14} />Remove stage</button> : <span />}<div className="button-row"><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{pending ? "Saving…" : "Save stage"}</button></div></div></form>;
}

function OfferEditor({ offer, activeCount, onClose, onSaved, onArchived }: { offer: OfferSummary | null; activeCount: number; onClose: () => void; onSaved: (offer: OfferSummary) => void; onArchived: (id: string) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await saveOfferAction({
      offerId: offer?.id ?? null,
      name: form.get("name"),
      colour: form.get("colour"),
      description: form.get("description"),
      idealCustomer: form.get("idealCustomer"),
      positioning: form.get("positioning"),
      isDefault: form.get("isDefault") === "on",
    });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onSaved(result.offer);
  }

  async function archive() {
    if (!offer || !window.confirm(`Archive ${offer.name}? Existing opportunities keep their history, but it cannot be chosen for new work.`)) return;
    setPending(true);
    setError(null);
    const result = await deactivateOfferAction({ offerId: offer.id });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onArchived(offer.id);
  }

  return <form className="offer-editor" onSubmit={submit}><header><div><strong>{offer ? `Edit ${offer.name}` : "Add an offer"}</strong><small>Describe the sales context once; research, reporting and AI reuse it.</small></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close offer editor"><X size={14} /></button></header><div className="offer-editor-fields"><label className="field-label">Name<input className="field" name="name" defaultValue={offer?.name ?? ""} required minLength={2} placeholder="Website project" /></label><label className="field-label colour-field">Colour<input name="colour" type="color" defaultValue={offer?.colour ?? "#0073EA"} /></label><label className="field-label form-span-2">Short description<input className="field" name="description" defaultValue={offer?.description ?? ""} placeholder="What is being sold?" /></label><label className="field-label form-span-2">Ideal customer<textarea className="field-textarea" name="idealCustomer" defaultValue={offer?.idealCustomer ?? ""} rows={2} placeholder="Who is this genuinely useful for?" /></label><label className="field-label form-span-2">Positioning<textarea className="field-textarea" name="positioning" defaultValue={offer?.positioning ?? ""} rows={2} placeholder="The clearest reason to care" /></label><label className="check-row form-span-2"><input type="checkbox" name="isDefault" defaultChecked={offer?.isDefault ?? false} disabled={offer?.isDefault} /><span><strong>Default focus</strong><small>Used when the workspace opens and for automatic single-offer flows.</small></span></label></div>{error ? <p className="settings-form-error">{error}</p> : null}<div className="team-editor-actions">{offer && !offer.isDefault && activeCount > 1 ? <button className="btn btn-danger" type="button" onClick={archive} disabled={pending}><Trash2 size={14} />Archive</button> : <span />}<div className="button-row"><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{pending ? "Saving…" : "Save offer"}</button></div></div></form>;
}

function TeamMemberEditor({ member, storageMode, currentMemberId, onClose, onSaved, onDeactivated }: { member: PersonSummary | null; storageMode: BoardSnapshot["storageMode"]; currentMemberId: string; onClose: () => void; onSaved: (member: PersonSummary) => void; onDeactivated: (id: string) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await saveTeamMemberAction({ userId: member?.id ?? null, name: form.get("name"), email: form.get("email"), role: form.get("role") ?? member?.role ?? "member", temporaryPassword: form.get("temporaryPassword") ?? "" });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onSaved(result.member);
  }

  async function deactivate() {
    if (!member || !window.confirm(`Deactivate ${member.name}? They will be signed out and removed from the active team.`)) return;
    setPending(true);
    setError(null);
    const result = await deactivateTeamMemberAction({ userId: member.id });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onDeactivated(member.id);
  }

  return <form className="team-member-editor" onSubmit={submit}><header><div><strong>{member?.id === currentMemberId ? "Set my login password" : member ? `Edit ${member.name}` : "Add team member"}</strong><small>{storageMode === "postgres" ? member?.id === currentMemberId ? "Choose a new password of at least 12 characters. Saving it takes effect immediately." : "Set a temporary password now; email recovery is available when an outbound sender is configured." : "This updates the migration-ready local roster; SQLite remains one trusted session."}</small></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close team editor"><X size={14} /></button></header><div className="team-member-fields"><label className="field-label">Name<input className="field" name="name" defaultValue={member?.name ?? ""} required minLength={2} /></label><label className="field-label">Work email<input className="field" name="email" type="email" defaultValue={member?.email ?? ""} required /></label><label className="field-label">Role<select className="field-select" name="role" defaultValue={member?.role ?? "member"} disabled={member?.id === currentMemberId}><option value="admin">Admin</option><option value="manager">Manager</option><option value="member">Sales support</option></select></label>{storageMode === "postgres" ? <label className="field-label">{member?.id === currentMemberId ? "New login password" : member ? "New password (optional)" : "Temporary password"}<input className="field" name="temporaryPassword" type="password" minLength={12} maxLength={128} required={!member || member.id === currentMemberId} autoComplete="new-password" /></label> : null}</div>{error ? <p className="settings-form-error">{error}</p> : null}<div className="team-editor-actions">{member && member.id !== currentMemberId ? <button className="btn btn-danger" type="button" onClick={deactivate} disabled={pending}><Trash2 size={14} />Deactivate</button> : <span />}<div className="button-row"><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{pending ? "Saving…" : member?.id === currentMemberId ? "Save my password" : "Save member"}</button></div></div></form>;
}

function ActivityTypeEditor({ activityType, onClose, onSaved }: { activityType: ActivityTypeSummary | null; onClose: () => void; onSaved: (activityType: ActivityTypeSummary) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await saveActivityTypeAction({
      activityTypeId: activityType?.id ?? null,
      name: String(form.get("name") ?? ""),
      channel: String(form.get("channel") ?? "note"),
      colour: String(form.get("colour") ?? "#667085"),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(result.activityType);
  }

  return <form className="activity-type-editor" onSubmit={submit}><header><div><strong>{activityType ? `Edit ${activityType.name}` : "Add activity type"}</strong><small>Names appear in the activity composer; channel drives reporting and AI context.</small></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close activity type editor"><X size={14} /></button></header><div className="activity-type-fields"><label className="field-label">Name<input className="field" name="name" defaultValue={activityType?.name ?? ""} required minLength={2} /></label><label className="field-label">Channel<select className="field-select" name="channel" defaultValue={activityType?.channel ?? "note"}><option value="linkedin">LinkedIn</option><option value="email">Email</option><option value="phone">Phone</option><option value="meeting">Meeting</option><option value="physical">Physical</option><option value="note">Note</option></select></label><label className="field-label colour-field">Colour<input name="colour" type="color" defaultValue={activityType?.colour ?? "#667085"} /></label></div>{error ? <p className="settings-form-error">{error}</p> : null}<div className="button-row"><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{pending ? "Saving…" : "Save activity type"}</button></div></form>;
}

function settingsStageGuidance(name: string) {
  return ({
    "Researching": "Actively checking fit and finding the right person.",
    "Research holding": "Market-map, reference or paused research; no active selling.",
    "Ready to contact": "A credible person and route are identified.",
    "Outreach active": "Touches are underway; a response is not required yet.",
    "Engaged": "A real person has responded or opened a conversation.",
    "Conversation active": "A real person has responded and a useful sales conversation is underway.",
    "Proposal / decision": "A clear commercial next step is with the buyer for review or decision.",
    "Review booked": "A review or discovery session is booked.",
    "Discovery booked": "A discovery or scoping conversation is booked.",
    "Pilot proposed": "A concrete pilot or commercial next step is offered.",
    "Proposal sent": "A clear scope, value and commercial proposal have been shared.",
    "Pilot active": "A live pilot has an owner and success criteria.",
    "Decision pending": "The buyer has what they need and a decision is pending.",
    "Nurture": "Real relationship signal, inactive timing, and a recorded re-entry trigger.",
    "Won": "Converted to a customer or agreed engagement.",
    "Lost": "A genuine post-contact commercial loss, never a desk-research exclusion.",
  } as Record<string, string>)[name] ?? "Pipeline stage";
}

function roleLabel(role?: PersonSummary["role"]) {
  return role === "admin" ? "Admin" : role === "manager" ? "Manager" : "Sales support";
}

function WorkspaceFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <><header className="page-header"><div className="page-title"><h1>{title}</h1><p>{subtitle}</p></div></header><div className="workspace-page">{children}</div></>;
}

function EmptyResult({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-result"><Search size={22} /><strong>{title}</strong><p>{detail}</p></div>;
}

function Metric({ icon, label, value, detail, tone = "neutral" }: { icon: React.ReactNode; label: string; value: string | number; detail: string; tone?: "neutral" | "good" | "warning" | "danger" }) {
  return <article className="report-metric" data-tone={tone}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
}

function StatusRow({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <span className="status-row"><span>{label}</span><strong><i data-good={good} />{value}</strong></span>;
}

type SearchResult = { id: string; kind: "Opportunity" | "Research" | "Contact" | "Activity"; title: string; detail: string; href: string };

function aggregateCompanies(opportunities: OpportunitySummary[]) {
  const groups = new Map<string, { company: OpportunitySummary["company"]; opportunities: OpportunitySummary[]; contacts: OpportunitySummary["contacts"] }>();
  for (const opportunity of opportunities) {
    const group = groups.get(opportunity.company.id) ?? { company: opportunity.company, opportunities: [], contacts: [] };
    group.opportunities.push(opportunity);
    for (const contact of opportunity.contacts) if (!group.contacts.some((item) => item.id === contact.id)) group.contacts.push(contact);
    groups.set(opportunity.company.id, group);
  }
  return [...groups.values()].sort((a, b) => a.company.name.localeCompare(b.company.name));
}

function initials(name: string) { return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function formatShortDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)); }
function sentenceCase(value: string) { return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function attentionReason(item: OpportunitySummary, now: number) { if (!item.nextActionAt) return "No next action"; if (new Date(item.nextActionAt).getTime() < now) return "Next action overdue"; return sentenceCase(item.temperature); }
function highlight(text: string, query: string) { const index = text.toLowerCase().indexOf(query); if (index < 0) return text; return <>{text.slice(0, index)}<mark>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>; }
