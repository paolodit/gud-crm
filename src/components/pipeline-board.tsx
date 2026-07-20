"use client";

import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Copy,
  ExternalLink,
  FilePenLine,
  Filter,
  GripVertical,
  Info,
  Link2,
  LoaderCircle,
  ListPlus,
  Mail,
  Maximize2,
  Minimize2,
  Phone,
  Plus,
  Columns3,
  Rows3,
  Search,
  Sparkles,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Target,
  UserRound,
  X,
} from "lucide-react";
import { format, formatDistanceStrict } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, startTransition, useMemo, useState } from "react";

import {
  completeTaskAction,
  logActivityAction,
  moveOpportunityAction,
  saveContactAction,
  saveOpportunityDetailsAction,
} from "@/app/actions/crm";
import {
  createTaskFromAiAction,
  generateAiCoachAction,
  saveAiFeedbackAction,
} from "@/app/actions/ai";
import { ActivityIcon, ChannelIcon } from "@/components/channel-icon";
import { CompanyEditorDialog } from "@/components/company-editor-dialog";
import { CreateOpportunityDialog } from "@/components/create-opportunity-dialog";
import { activeOffers, contextualOffers, defaultOffer } from "@/lib/domain/offers";
import { safeExternalUrl } from "@/lib/domain/normalise";
import type {
  ActivitySummary,
  AICoachMode,
  AIFeedbackRating,
  AISuggestionSummary,
  BoardSnapshot,
  ContactSummary,
  OpportunitySummary,
  StageSummary,
  TaskSummary,
} from "@/lib/domain/types";

type DueState = "overdue" | "soon" | "future" | "missing";

export function PipelineBoard({ initialSnapshot }: { initialSnapshot: BoardSnapshot }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [opportunities, setOpportunities] = useState(initialSnapshot.opportunities);
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const availableOffers = contextualOffers(initialSnapshot.offers, initialSnapshot.opportunities);
  const requestedOffer = searchParams.get("offer");
  const [offerFilter, setOfferFilter] = useState<string>(availableOffers.length > 1
    ? requestedOffer === "all" || availableOffers.some((offer) => offer.id === requestedOffer)
      ? requestedOffer ?? "all"
      : defaultOffer(initialSnapshot.offers)?.id ?? "all"
    : "all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [compact, setCompact] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const selectedId = searchParams.get("opportunity");
  const selected = opportunities.find((item) => item.id === selectedId) ?? null;
  const now = initialSnapshot.generatedAt;

  const filtered = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();
    return opportunities.filter((item) => {
      const matchesText =
        !normalisedQuery ||
        item.company.name.toLowerCase().includes(normalisedQuery) ||
        item.title.toLowerCase().includes(normalisedQuery) ||
        item.contacts.some((contact) => contact.name.toLowerCase().includes(normalisedQuery));
      const matchesOwner = owner === "all" || item.owner?.id === owner;
      const matchesOffer = offerFilter === "all" || item.offer?.id === offerFilter;
      const state = getDueState(item.nextActionAt, now);
      const needsAttention = state === "overdue" || state === "missing" || item.temperature === "at_risk";
      return matchesText && matchesOwner && matchesOffer && (!attentionOnly || needsAttention);
    });
  }, [attentionOnly, now, offerFilter, opportunities, owner, query]);

  function openOpportunity(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("opportunity", id);
    router.push(`/pipeline?${params.toString()}`, { scroll: false });
  }

  function closeOpportunity() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("opportunity");
    const suffix = params.toString();
    router.push(suffix ? `/pipeline?${suffix}` : "/pipeline", { scroll: false });
  }

  function updateOpportunity(next: OpportunitySummary) {
    setOpportunities((items) => items.map((item) => (item.id === next.id ? next : item)));
  }

  function moveOpportunity(opportunityId: string, stageId: string) {
    const previous = opportunities.find((item) => item.id === opportunityId);
    if (!previous || previous.stageId === stageId) return;

    setOpportunities((items) =>
      items.map((item) => (item.id === opportunityId ? { ...item, stageId } : item)),
    );
    startTransition(async () => {
      const result = await moveOpportunityAction({ opportunityId, toStageId: stageId });
      if (!result.ok) {
        setOpportunities((items) =>
          items.map((item) => (item.id === opportunityId ? previous : item)),
        );
        showToast(result.error);
      } else {
        const stage = initialSnapshot.stages.find((item) => item.id === stageId);
        showToast(`Moved to ${stage?.name ?? "new stage"}`);
      }
    });
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    moveOpportunity(String(event.active.id), String(event.over.id));
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  function opportunityCreated(opportunity: OpportunitySummary) {
    setOpportunities((items) => [opportunity, ...items]);
    setCreating(false);
    showToast(`${opportunity.company.name} is ready for a good next action.`);
    openOpportunity(opportunity.id);
  }

  return (
    <>
      <header className="page-header pipeline-page-header">
        <div className="page-title">
          <h1>{initialSnapshot.pipeline.name}</h1>
          <p>{opportunities.length} opportunities · Updated {formatTime(now)}</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" type="button" onClick={() => setCreating(true)} aria-label="Create a new opportunity">
            <Plus size={16} /> <span className="mobile-hide">New opportunity</span>
          </button>
        </div>
      </header>

      {initialSnapshot.demoMode ? (
        <div className="demo-banner">
          <Sparkles size={14} /> Demo workspace · changes reset on refresh
        </div>
      ) : null}

      <section className="pipeline-toolbar" aria-label="Pipeline filters">
        <div className="search-box">
          <Search size={15} />
          <input
            type="search"
            placeholder="Search company, opportunity or contact"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="filter-row">
          {availableOffers.length > 1 ? <label className="filter-chip offer-filter-chip"><Target size={14} /><select aria-label="Filter by offer" value={offerFilter} onChange={(event) => setOfferFilter(event.target.value)}><option value="all">All offers</option>{availableOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}{offer.active ? "" : " · Archived"}</option>)}</select></label> : null}
          <label className="filter-chip">
            <CircleUserRound size={14} />
            <select
              aria-label="Filter by owner"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              style={{ border: 0, background: "transparent", color: "inherit", fontWeight: 700 }}
            >
              <option value="all">All owners</option>
              {initialSnapshot.users.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </select>
          </label>
          <button
            className="filter-chip"
            type="button"
            data-active={attentionOnly}
            onClick={() => setAttentionOnly((value) => !value)}
          >
            <AlertCircle size={14} /> Needs attention
          </button>
          <span className="filter-chip" aria-label={`${filtered.length} shown`}>
            <Filter size={14} /> {filtered.length} shown
          </span>
          <div className="view-toggle" role="group" aria-label="Pipeline card density">
            <button type="button" aria-pressed={!compact} onClick={() => setCompact(false)} title="Comfortable cards"><Columns3 size={14} />Comfortable</button>
            <button type="button" aria-pressed={compact} onClick={() => setCompact(true)} title="Compact cards"><Rows3 size={14} />Compact</button>
          </div>
        </div>
      </section>

      <DndContext id="gud-crm-pipeline" sensors={sensors} onDragEnd={onDragEnd}>
        <div className="board-shell">
          <div className="board-viewport" data-density={compact ? "compact" : "comfortable"}>
            <div className="board">
              {initialSnapshot.stages.map((stage) => (
                <BoardColumn
                  key={stage.id}
                  stage={stage}
                  stages={initialSnapshot.stages}
                  opportunities={filtered.filter((item) => item.stageId === stage.id)}
                  now={now}
                  onOpen={openOpportunity}
                  onMove={moveOpportunity}
                  compact={compact}
                  showOffer={availableOffers.length > 1 && offerFilter === "all"}
                />
              ))}
            </div>
          </div>
          <span className="board-scroll-cue">Scroll for later stages <ChevronRight size={13} /></span>
        </div>
      </DndContext>

      {selected ? (
        <OpportunityPanel
          opportunity={selected}
          snapshot={initialSnapshot}
          now={now}
          onClose={closeOpportunity}
          onUpdate={updateOpportunity}
          onToast={showToast}
        />
      ) : null}
      {creating ? (
        <CreateOpportunityDialog
          snapshot={{ ...initialSnapshot, opportunities }}
          onClose={() => setCreating(false)}
          onCreated={opportunityCreated}
        />
      ) : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </>
  );
}

function BoardColumn({
  stage,
  stages,
  opportunities,
  now,
  onOpen,
  onMove,
  compact,
  showOffer,
}: {
  stage: StageSummary;
  stages: StageSummary[];
  opportunities: OpportunitySummary[];
  now: string;
  onOpen: (id: string) => void;
  onMove: (id: string, stageId: string) => void;
  compact: boolean;
  showOffer: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.id });
  return (
    <section className="board-column" ref={setNodeRef} data-over={isOver} aria-label={`${stage.name}, ${opportunities.length} opportunities`}>
      <header className="column-header" style={{ backgroundColor: stage.colour }}>
        <strong>{stage.name}</strong>
        <span className="column-help" title={stageGuidance(stage.name)} aria-label={`${stage.name}: ${stageGuidance(stage.name)}`}><Info size={13} /></span>
        <span className="column-count">{opportunities.length}</span>
      </header>
      <div className="column-cards">
        {opportunities.map((opportunity) => (
          <OpportunityCard
            key={opportunity.id}
            opportunity={opportunity}
            stages={stages}
            stageColour={stage.colour}
            now={now}
            onOpen={onOpen}
            onMove={onMove}
            compact={compact}
            showOffer={showOffer}
          />
        ))}
        {opportunities.length === 0 ? <div className="empty-column">Drop an opportunity here</div> : null}
      </div>
    </section>
  );
}

function OpportunityCard({
  opportunity,
  stages,
  stageColour,
  now,
  onOpen,
  onMove,
  compact,
  showOffer,
}: {
  opportunity: OpportunitySummary;
  stages: StageSummary[];
  stageColour: string;
  now: string;
  onOpen: (id: string) => void;
  onMove: (id: string, stageId: string) => void;
  compact: boolean;
  showOffer: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opportunity.id,
  });
  const primaryContact = opportunity.contacts.find((item) => item.primary) ?? opportunity.contacts[0];
  const nextTask = opportunity.tasks.find((item) => item.status === "open");
  const dueState = getDueState(nextTask?.dueAt ?? opportunity.nextActionAt, now);

  return (
    <article
      ref={setNodeRef}
      className="opportunity-card"
      data-dragging={isDragging}
      data-compact={compact}
      style={{ borderLeftColor: stageColour, transform: CSS.Translate.toString(transform) }}
      {...listeners}
      {...attributes}
    >
      <button className="card-open" type="button" onClick={() => onOpen(opportunity.id)}>
        <div className="card-topline">
          <span className="company-name">{opportunity.company.name}</span>
          {opportunity.isExample ? <span className="demo-label">Demo</span> : null}
          <GripVertical size={14} color="#98A2B3" aria-hidden="true" />
        </div>
        <p className="opportunity-title">{opportunity.title}</p>
        {showOffer && opportunity.offer ? <span className="offer-chip card-offer-chip" style={{ "--offer-colour": opportunity.offer.colour } as React.CSSProperties}>{opportunity.offer.name}</span> : null}
        {compact ? <div className="compact-card-summary">
          <span><CalendarClock size={12} />{opportunity.lastActivityAt ? `Touched ${relative(opportunity.lastActivityAt, now)}` : "No activity"}</span>
          <span className={dueState === "overdue" ? "due-overdue" : dueState === "soon" ? "due-soon" : ""}><ListPlus size={12} />{nextTask ? nextTask.title : "No next action"}</span>
        </div> : <><div className="card-contact">
          <UserRound size={13} />
          <span>{primaryContact ? `${primaryContact.name} · ${primaryContact.title}` : "No contact yet"}</span>
        </div>
        <div className="card-detail">
          <span className="truncate">
            <CalendarClock size={13} />
            {opportunity.lastActivityAt ? `Last touch ${relative(opportunity.lastActivityAt, now)}` : "No activity yet"}
          </span>
        </div>
        <div className="card-detail">
          <span className={`truncate ${dueState === "overdue" ? "due-overdue" : dueState === "soon" ? "due-soon" : ""}`}>
            <CalendarClock size={13} />
            {nextTask ? nextTask.title : opportunity.noNextActionReason || "No next action"}
          </span>
          {nextTask ? <span>{formatShortDate(nextTask.dueAt)}</span> : null}
        </div>
        <div className="card-footer">
          <div className="channel-row">
            {opportunity.recentChannels.map((channel) => <ChannelIcon key={channel} channel={channel} size={13} />)}
            {opportunity.recentChannels.length === 0 ? <span>No touches</span> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className={`badge badge-${opportunity.temperature}`}>{opportunity.temperature.replace("_", " ")}</span>
            <span className="mini-avatar">{initials(opportunity.owner?.name ?? "Unassigned")}</span>
          </div>
        </div></>}
      </button>
      {!compact ? <select
        className="stage-select"
        aria-label={`Move ${opportunity.company.name} to another stage`}
        value={opportunity.stageId}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => onMove(opportunity.id, event.target.value)}
      >
        {stages.map((stage) => <option key={stage.id} value={stage.id}>Move to {stage.name}</option>)}
      </select> : null}
    </article>
  );
}

function OpportunityPanel({
  opportunity,
  snapshot,
  now,
  onClose,
  onUpdate,
  onToast,
}: {
  opportunity: OpportunitySummary;
  snapshot: BoardSnapshot;
  now: string;
  onClose: () => void;
  onUpdate: (opportunity: OpportunitySummary) => void;
  onToast: (message: string) => void;
}) {
  const openTasks = opportunity.tasks.filter((task) => task.status === "open");
  const stage = snapshot.stages.find((item) => item.id === opportunity.stageId);
  const [contactEditor, setContactEditor] = useState<ContactSummary | "new" | null>(null);
  const [companyEditor, setCompanyEditor] = useState(false);
  const [opportunityEditor, setOpportunityEditor] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const companyWebsiteUrl = safeExternalUrl(opportunity.company.websiteUrl);
  const companyLinkedinUrl = safeExternalUrl(opportunity.company.linkedinUrl);

  function completeTask(task: TaskSummary) {
    const next = {
      ...opportunity,
      tasks: opportunity.tasks.map((item) =>
        item.id === task.id ? { ...item, status: "completed" as const } : item,
      ),
    };
    onUpdate(next);
    startTransition(async () => {
      const result = await completeTaskAction({ taskId: task.id });
      if (!result.ok) {
        onUpdate(opportunity);
        onToast(result.error);
      } else {
        onToast("Next action completed");
      }
    });
  }

  return (
    <>
      <button className="panel-backdrop" type="button" aria-label="Close opportunity" onClick={onClose} />
      <aside className="opportunity-panel" data-expanded={expanded} aria-label={`${opportunity.company.name} opportunity`}>
        <header className="panel-header">
          <button className="icon-button" type="button" onClick={onClose} aria-label="Back to pipeline">
            <ChevronLeft size={18} />
          </button>
          <div className="panel-title">
            <h2>{opportunity.company.name}</h2>
            <p>{opportunity.title} · {stage?.name}</p>
            {contextualOffers(snapshot.offers, snapshot.opportunities).length > 1 && opportunity.offer ? <span className="offer-chip" style={{ "--offer-colour": opportunity.offer.colour } as React.CSSProperties}>{opportunity.offer.name}</span> : null}
          </div>
          <button className="icon-button" type="button" onClick={() => setOpportunityEditor(true)} aria-label="Edit opportunity" title="Edit opportunity"><FilePenLine size={16} /></button>
          {companyWebsiteUrl ? (
            <a className="icon-button" href={companyWebsiteUrl} target="_blank" rel="noopener noreferrer" aria-label="Open company website">
              <Link2 size={16} />
            </a>
          ) : null}
          {companyLinkedinUrl ? (
            <a className="icon-button" href={companyLinkedinUrl} target="_blank" rel="noopener noreferrer" aria-label="Open company LinkedIn">
              <ExternalLink size={16} />
            </a>
          ) : null}
          <button className="icon-button panel-expand" type="button" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? "Restore workspace width" : "Expand workspace"} title={expanded ? "Restore width" : "Expand workspace"}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close panel"><X size={18} /></button>
        </header>

        <div className="panel-body">
          <div className="panel-grid">
            <div className="panel-stack">
              <section className="surface">
                <header className="surface-header"><h3>Opportunity summary</h3></header>
                <div className="surface-content">
                  <div className="summary-grid">
                    {contextualOffers(snapshot.offers, snapshot.opportunities).length > 1 ? <div className="summary-item"><span>Offer</span><strong>{opportunity.offer?.name ?? "Choose before outreach"}</strong></div> : null}
                    <div className="summary-item"><span>Owner</span><strong>{opportunity.owner?.name ?? "Unassigned"}</strong></div>
                    <div className="summary-item"><span>Priority</span><strong className={`badge badge-${opportunity.priority}`}>{opportunity.priority}</strong></div>
                    <div className="summary-item"><span>Temperature</span><strong className={`badge badge-${opportunity.temperature}`}>{opportunity.temperature.replace("_", " ")}</strong></div>
                    <button className="summary-item summary-item-edit" type="button" onClick={() => setCompanyEditor(true)} title="Edit company fit and qualification"><span>Fit <FilePenLine size={12} /></span><strong>{opportunity.company.fitScore ? `${opportunity.company.fitScore}/5` : "Not scored"} · {opportunity.company.scaleNote || "Add qualification note"}</strong></button>
                  </div>
                  {opportunity.expectedValue || opportunity.probability !== null && opportunity.probability !== undefined || opportunity.expectedCloseDate ? <div className="commercial-summary" aria-label="Commercial outlook">
                    {opportunity.expectedValue ? <span><small>Potential</small><strong>{formatMoney(opportunity.expectedValue)}</strong></span> : null}
                    {opportunity.probability !== null && opportunity.probability !== undefined ? <span><small>Probability</small><strong>{opportunity.probability}%</strong></span> : null}
                    {opportunity.expectedCloseDate ? <span><small>Expected close</small><strong>{format(new Date(opportunity.expectedCloseDate), "d MMM yyyy")}</strong></span> : null}
                  </div> : null}
                  {opportunity.outreachAngle ? <p className="angle">{opportunity.outreachAngle}</p> : null}
                  <OutreachRhythm opportunity={opportunity} />
                </div>
              </section>

              <section className="surface">
                <header className="surface-header">
                  <h3>Activity timeline</h3>
                  <span className="badge">{opportunity.activities.length} entries</span>
                </header>
                <div className="surface-content timeline">
                  {opportunity.activities.length ? opportunity.activities.map((item) => (
                    <div className="timeline-item" key={item.id}>
                      <span className="timeline-icon" style={{ background: item.type.colour }}>
                        <ActivityIcon icon={item.type.icon} size={12} />
                      </span>
                      <div className="timeline-head">
                        <strong>{item.type.name}</strong>
                        <time dateTime={item.occurredAt}>{format(new Date(item.occurredAt), "d MMM · HH:mm")}</time>
                      </div>
                      {item.contactName ? <div className="timeline-contact">{item.contactName}</div> : null}
                      {item.outcome ? <span className="timeline-outcome">{item.outcome}</span> : null}
                      {item.notes ? <p className="timeline-notes" title={item.notes}>{item.notes}</p> : null}
                    </div>
                  )) : <div className="empty-state">No activities have been logged yet.</div>}
                </div>
              </section>

              <QuickActivityComposer
                opportunity={opportunity}
                snapshot={snapshot}
                onUpdate={onUpdate}
                onToast={onToast}
              />
            </div>

            <div className="panel-stack">
              <section className="surface">
                <header className="surface-header"><h3>Next action</h3></header>
                <div className="surface-content task-list">
                  {openTasks.length ? openTasks.map((task) => (
                    <div className="task-row" key={task.id}>
                      <button className="complete-button" type="button" onClick={() => completeTask(task)} aria-label={`Complete ${task.title}`}><Check size={14} /></button>
                      <div className="task-copy">
                        <strong>{task.title}</strong>
                        <span className={getDueState(task.dueAt, now) === "overdue" ? "due-overdue" : ""}>Due {format(new Date(task.dueAt), "EEE d MMM, HH:mm")}</span>
                      </div>
                    </div>
                  )) : (
                    <div className="empty-state">
                      <AlertCircle size={20} style={{ margin: "0 auto 7px" }} />
                      {opportunity.noNextActionReason ?? "This live opportunity has no next action."}
                    </div>
                  )}
                </div>
              </section>

              <section className="surface">
                <header className="surface-header"><h3>Contacts</h3><button className="btn btn-quiet btn-compact" type="button" onClick={() => setContactEditor("new")}><Plus size={13} />Add</button></header>
                <div className="surface-content contact-list">
                  {opportunity.contacts.length ? opportunity.contacts.map((contact) => (
                    <div className="contact-row" key={contact.id}>
                      <span className="mini-avatar">{initials(contact.name)}</span>
                      <div className="contact-copy">
                        <strong>{contact.name} {contact.primary ? <span className="badge">Primary</span> : null} {contact.doNotContact ? <span className="badge badge-critical">Do not contact</span> : null}</strong>
                        <span>{contact.title || "Role not recorded"}</span>
                        {contact.preferredChannel ? <small>Prefers {contact.preferredChannel}</small> : null}
                        {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
                        {contact.phone ? <a href={`tel:${contact.phone}`}>{contact.phone}</a> : null}
                        {!contact.email && !contact.phone ? <small>Email and phone not yet recorded</small> : null}
                      </div>
                      {contact.email ? <a className="icon-button" href={`mailto:${contact.email}`} aria-label={`Email ${contact.name}`}><Mail size={14} /></a> : null}
                      {contact.phone ? <a className="icon-button" href={`tel:${contact.phone}`} aria-label={`Call ${contact.name}`}><Phone size={14} /></a> : null}
                      {safeExternalUrl(contact.linkedinUrl) ? <a className="icon-button" href={safeExternalUrl(contact.linkedinUrl)!} target="_blank" rel="noopener noreferrer" aria-label={`Open ${contact.name} on LinkedIn`}><ExternalLink size={14} /></a> : null}
                      <button className="icon-button" type="button" onClick={() => setContactEditor(contact)} aria-label={`Edit ${contact.name}`}><FilePenLine size={14} /></button>
                    </div>
                  )) : <div className="empty-state">No contacts linked yet.</div>}
                  {contactEditor ? <ContactEditor
                    opportunity={opportunity}
                    contact={contactEditor === "new" ? null : contactEditor}
                    onClose={() => setContactEditor(null)}
                    onSaved={(saved) => {
                      const contacts = opportunity.contacts.some((item) => item.id === saved.id)
                        ? opportunity.contacts.map((item) => item.id === saved.id ? saved : saved.primary ? { ...item, primary: false } : item)
                        : [...opportunity.contacts.map((item) => saved.primary ? { ...item, primary: false } : item), saved];
                      onUpdate({ ...opportunity, contacts });
                      setContactEditor(null);
                      onToast(`${saved.name} saved`);
                    }}
                    onToast={onToast}
                  /> : null}
                </div>
              </section>

              <AiCoach opportunity={opportunity} onUpdate={onUpdate} onToast={onToast} />
            </div>
          </div>
        </div>
        {companyEditor ? <CompanyEditorDialog company={opportunity.company} offers={snapshot.offers} onClose={() => setCompanyEditor(false)} onSaved={(company) => { onUpdate({ ...opportunity, company }); setCompanyEditor(false); onToast(`${company.name} updated`); }} /> : null}
        {opportunityEditor ? <OpportunityEditor opportunity={opportunity} snapshot={snapshot} onClose={() => setOpportunityEditor(false)} onSaved={(next) => { onUpdate(next); setOpportunityEditor(false); onToast("Opportunity updated"); }} /> : null}
      </aside>
    </>
  );
}

function OpportunityEditor({ opportunity, snapshot, onClose, onSaved }: { opportunity: OpportunitySummary; snapshot: BoardSnapshot; onClose: () => void; onSaved: (opportunity: OpportunitySummary) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offers = activeOffers(snapshot.offers);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const offerId = String(form.get("offerId") ?? "") || null;
    const ownerId = String(form.get("ownerId") ?? "") || null;
    const result = await saveOpportunityDetailsAction({
      opportunityId: opportunity.id,
      title: form.get("title"),
      offerId,
      ownerId,
      priority: form.get("priority"),
      temperature: form.get("temperature"),
      expectedValue: String(form.get("expectedValue") ?? "").trim() ? Number(form.get("expectedValue")) : null,
      probability: String(form.get("probability") ?? "").trim() ? Number(form.get("probability")) : null,
      expectedCloseDate: String(form.get("expectedCloseDate") ?? "").trim() ? new Date(`${String(form.get("expectedCloseDate"))}T12:00:00`) : null,
      outreachAngle: form.get("outreachAngle"),
    });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onSaved({
      ...opportunity,
      title: String(form.get("title") ?? ""),
      offer: offers.find((offer) => offer.id === offerId) ?? null,
      owner: snapshot.users.find((user) => user.id === ownerId) ?? null,
      priority: String(form.get("priority")) as OpportunitySummary["priority"],
      temperature: String(form.get("temperature")) as OpportunitySummary["temperature"],
      expectedValue: String(form.get("expectedValue") ?? "").trim() ? Number(form.get("expectedValue")) : null,
      probability: String(form.get("probability") ?? "").trim() ? Number(form.get("probability")) : null,
      expectedCloseDate: String(form.get("expectedCloseDate") ?? "").trim() ? new Date(`${String(form.get("expectedCloseDate"))}T12:00:00`).toISOString() : null,
      outreachAngle: String(form.get("outreachAngle") ?? "") || null,
    });
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="opportunity-editor-title">
        <header className="dialog-header"><div><span className="eyebrow">Opportunity</span><h2 id="opportunity-editor-title">Edit the pitch</h2><p>Keep ownership, commercial context and the next move clear.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close opportunity editor"><X size={17} /></button></header>
        <form className="dialog-form" onSubmit={submit}>
          <div className="form-grid">
            <label className="field-label form-span-2">Opportunity title<input className="field" name="title" defaultValue={opportunity.title} required minLength={2} /></label>
            {offers.length > 1 ? <label className="field-label form-span-2">What are you pitching?<select className="field-select" name="offerId" defaultValue={opportunity.offer?.id ?? ""} required><option value="" disabled>Choose an offer</option>{offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label> : <input type="hidden" name="offerId" value={opportunity.offer?.id ?? offers[0]?.id ?? ""} />}
            <label className="field-label">Owner<select className="field-select" name="ownerId" defaultValue={opportunity.owner?.id ?? ""}><option value="">Unassigned</option>{snapshot.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
            <label className="field-label">Priority<select className="field-select" name="priority" defaultValue={opportunity.priority}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
            <label className="field-label">Temperature<select className="field-select" name="temperature" defaultValue={opportunity.temperature}><option value="cold">Cold</option><option value="warm">Warm</option><option value="hot">Hot</option><option value="at_risk">At risk</option><option value="unresponsive">Unresponsive</option></select></label>
            <label className="field-label">Potential value (£)<input className="field" name="expectedValue" type="number" min="0" step="100" defaultValue={opportunity.expectedValue ?? ""} /></label>
            <label className="field-label">Probability<select className="field-select" name="probability" defaultValue={opportunity.probability ?? ""}><option value="">Not estimated</option>{[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
            <label className="field-label">Expected close<input className="field" name="expectedCloseDate" type="date" defaultValue={opportunity.expectedCloseDate?.slice(0, 10) ?? ""} /></label>
            <label className="field-label form-span-2">Outreach angle<textarea className="field-textarea" name="outreachAngle" defaultValue={opportunity.outreachAngle ?? ""} rows={4} /></label>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <footer className="dialog-actions"><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{pending ? "Saving…" : "Save opportunity"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function OutreachRhythm({ opportunity }: { opportunity: OpportunitySummary }) {
  const touches = opportunity.activities.filter((item) => ["linkedin", "email", "phone", "physical"].includes(item.type.channel));
  const channels = [...new Set(touches.map((item) => item.type.channel))];
  const latestOutcome = opportunity.activities.find((item) => item.outcome)?.outcome;
  return (
    <div className="outreach-rhythm" aria-label="Outreach progress">
      <div><span>Attempts</span><strong>{touches.length}</strong></div>
      <div><span>Channels</span><strong>{channels.length ? channels.map((channel) => <ChannelIcon key={channel} channel={channel} size={13} />) : "None yet"}</strong></div>
      <div><span>Latest outcome</span><strong>{latestOutcome ?? (touches.length ? "Awaiting response" : "Not started")}</strong></div>
    </div>
  );
}

function ContactEditor({ opportunity, contact, onClose, onSaved, onToast }: {
  opportunity: OpportunitySummary;
  contact: ContactSummary | null;
  onClose: () => void;
  onSaved: (contact: ContactSummary) => void;
  onToast: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const result = await saveContactAction({
      opportunityId: opportunity.id,
      contactId: contact?.id ?? null,
      name: value("name"),
      title: value("title"),
      email: value("email"),
      phone: value("phone"),
      linkedinUrl: value("linkedinUrl"),
      preferredChannel: value("preferredChannel") || null,
      primary: form.get("primary") === "on",
      doNotContact: form.get("doNotContact") === "on",
    });
    setPending(false);
    if (!result.ok) {
      onToast(result.error);
      return;
    }
    onSaved(result.contact);
  }

  return (
    <form className="contact-editor" onSubmit={submit}>
      <header><strong>{contact ? `Edit ${contact.name}` : "Add a contact"}</strong><button className="icon-button" type="button" onClick={onClose} aria-label="Close contact editor"><X size={14} /></button></header>
      <div className="two-fields">
        <label className="field-label">Name<input className="field" name="name" required minLength={2} defaultValue={contact?.name ?? ""} /></label>
        <label className="field-label">Role<input className="field" name="title" defaultValue={contact?.title ?? ""} /></label>
        <label className="field-label">Email<input className="field" name="email" type="email" defaultValue={contact?.email ?? ""} /></label>
        <label className="field-label">Phone<input className="field" name="phone" type="tel" defaultValue={contact?.phone ?? ""} /></label>
      </div>
      <label className="field-label">LinkedIn<input className="field" name="linkedinUrl" type="url" defaultValue={contact?.linkedinUrl ?? ""} placeholder="https://linkedin.com/in/…" /></label>
      <label className="field-label">Best channel<select className="field-select" name="preferredChannel" defaultValue={contact?.preferredChannel ?? ""}><option value="">Not set</option><option value="linkedin">LinkedIn</option><option value="email">Email</option><option value="phone">Phone</option><option value="meeting">Meeting</option><option value="physical">Physical</option></select></label>
      <div className="contact-checks">
        <label className="checkbox-row"><input name="primary" type="checkbox" defaultChecked={contact?.primary ?? opportunity.contacts.length === 0} />Primary contact</label>
        <label className="checkbox-row"><input name="doNotContact" type="checkbox" defaultChecked={contact?.doNotContact ?? false} />Do not contact</label>
      </div>
      <div className="button-row"><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{pending ? "Saving…" : "Save contact"}</button></div>
    </form>
  );
}

const coachModes: Array<{ value: AICoachMode; label: string; hint: string }> = [
  { value: "coach", label: "Best next move", hint: "Prioritise" },
  { value: "draft", label: "Write outreach", hint: "Draft" },
  { value: "creative", label: "Creative angles", hint: "Explore" },
  { value: "recovery", label: "Recover cold lead", hint: "Re-open" },
];

function AiCoach({ opportunity, onUpdate, onToast }: {
  opportunity: OpportunitySummary;
  onUpdate: (opportunity: OpportunitySummary) => void;
  onToast: (message: string) => void;
}) {
  const [mode, setMode] = useState<AICoachMode>("coach");
  const [suggestion, setSuggestion] = useState<AISuggestionSummary | null>(opportunity.aiSuggestions?.[0] ?? null);
  const [pending, setPending] = useState(false);
  const [taskPending, setTaskPending] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setPending(true);
    setError(null);
    const result = await generateAiCoachAction({ opportunityId: opportunity.id, mode });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuggestion(result.suggestion);
    onUpdate({ ...opportunity, aiSuggestions: [result.suggestion, ...(opportunity.aiSuggestions ?? [])] });
    onToast("Fresh coaching generated");
  }

  async function copyDraft(index: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      window.setTimeout(() => setCopied(null), 1_800);
    } catch {
      onToast("Clipboard access is not available in this browser");
    }
  }

  async function createTask(index: number) {
    if (!suggestion) return;
    setTaskPending(index);
    const result = await createTaskFromAiAction({ opportunityId: opportunity.id, suggestionId: suggestion.id, actionIndex: index });
    setTaskPending(null);
    if (!result.ok) {
      onToast(result.error);
      return;
    }
    onUpdate({ ...opportunity, tasks: [...opportunity.tasks, result.task], nextActionAt: result.task.dueAt, noNextActionReason: null });
    onToast("Suggested action added to My work");
  }

  async function rate(rating: AIFeedbackRating) {
    if (!suggestion) return;
    const result = await saveAiFeedbackAction({ opportunityId: opportunity.id, suggestionId: suggestion.id, rating });
    if (!result.ok) {
      onToast(result.error);
      return;
    }
    const updated = { ...suggestion, feedbackRating: rating };
    setSuggestion(updated);
    onUpdate({ ...opportunity, aiSuggestions: (opportunity.aiSuggestions ?? []).map((item) => item.id === updated.id ? updated : item) });
    onToast("Feedback saved");
  }

  return (
    <section className="surface ai-coach-surface">
      <header className="surface-header"><h3>AI coach</h3><span className="badge">On demand</span></header>
      <div className="surface-content ai-coach">
        <div className="ai-coach-intro">
          <span className="ai-spark"><Sparkles size={16} /></span>
          <div><strong>A useful second brain, grounded in this record.</strong><p>It drafts and suggests; you decide. Nothing is sent or scheduled automatically.</p></div>
        </div>
        <div className="ai-coach-controls">
          <div className="ai-mode-grid" role="radiogroup" aria-label="Coaching mode">{coachModes.map((item) => <button type="button" role="radio" aria-checked={mode === item.value} key={item.value} onClick={() => setMode(item.value)}><small>{item.hint}</small><strong>{item.label}</strong></button>)}</div>
          <button className="btn btn-primary" type="button" disabled={pending} onClick={generate}>{pending ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{pending ? "Thinking..." : suggestion ? "Generate fresh" : "Coach me"}</button>
        </div>
        {error ? <div className="ai-error" role="alert"><AlertCircle size={15} />{error}</div> : null}

        {suggestion ? (
          <div className="ai-result" aria-live="polite">
            <div className="ai-summary"><span>Read on the relationship</span><p>{suggestion.output.summary}</p></div>
            {suggestion.output.warnings.length ? <div className="ai-warnings">{suggestion.output.warnings.map((warning) => <p key={warning}><AlertCircle size={14} />{warning}</p>)}</div> : null}

            {suggestion.output.nextActions.length ? <div className="ai-section"><h4>Best next actions</h4><div className="ai-action-list">{suggestion.output.nextActions.map((action, index) => <article key={`${action.title}-${index}`}><div><span className="ai-number">{index + 1}</span><strong>{action.title}</strong><small>{action.timing} - {action.confidence} confidence</small></div><p>{action.reason}</p><button className="btn btn-quiet" type="button" disabled={taskPending === index} onClick={() => createTask(index)}>{taskPending === index ? <LoaderCircle className="spin" size={14} /> : <ListPlus size={14} />}Make task</button></article>)}</div></div> : null}

            {suggestion.output.drafts.length ? <div className="ai-section"><h4>Drafts to adapt</h4><div className="ai-draft-list">{suggestion.output.drafts.map((draft, index) => <article key={`${draft.channel}-${index}`}><header><span className="badge">{draft.channel}</span><button className="btn btn-quiet" type="button" onClick={() => copyDraft(index, draft.text)}>{copied === index ? <Check size={14} /> : <Copy size={14} />}{copied === index ? "Copied" : "Copy"}</button></header><p>{draft.text}</p></article>)}</div></div> : null}

            {suggestion.output.creativeIdeas.length ? <div className="ai-section"><h4>Creative routes</h4><div className="ai-idea-list">{suggestion.output.creativeIdeas.map((idea) => <article key={idea.level} data-level={idea.level}><header><span>{idea.level}</span><small>{idea.costBand}</small></header><strong>{idea.idea}</strong><p>{idea.reason}</p></article>)}</div></div> : null}

            <footer className="ai-footer">
              <div><ShieldCheck size={14} /><span>Generated for human review</span><small>{suggestion.provider} / {suggestion.model} / {format(new Date(suggestion.generatedAt), "d MMM, HH:mm")}</small></div>
              <div className="ai-feedback" aria-label="Rate this suggestion">
                <button type="button" data-selected={suggestion.feedbackRating === "useful"} onClick={() => rate("useful")}><ThumbsUp size={13} /> Useful</button>
                <button type="button" data-selected={suggestion.feedbackRating === "not_useful"} onClick={() => rate("not_useful")}><ThumbsDown size={13} /> Not useful</button>
                <button type="button" data-selected={suggestion.feedbackRating === "already_tried"} onClick={() => rate("already_tried")}><Check size={13} /> Tried</button>
              </div>
            </footer>
          </div>
        ) : <p className="ai-empty">Choose what you need. The coach will use the company, contacts, stage, recent activity, tasks, outreach angle, and the approved playbook.</p>}
      </div>
    </section>
  );
}

function QuickActivityComposer({
  opportunity,
  snapshot,
  onUpdate,
  onToast,
}: {
  opportunity: OpportunitySummary;
  snapshot: BoardSnapshot;
  onUpdate: (opportunity: OpportunitySummary) => void;
  onToast: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState(snapshot.activityTypes[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [contactId, setContactId] = useState(opportunity.contacts.find((item) => item.primary)?.id ?? "");
  const [occurredAt, setOccurredAt] = useState(toDateTimeLocal(snapshot.generatedAt));
  const [addFollowUp, setAddFollowUp] = useState(false);
  const [nextActionTitle, setNextActionTitle] = useState("");
  const [nextActionAt, setNextActionAt] = useState(toDateTimeLocal(addDays(snapshot.generatedAt, 3)));
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const type = snapshot.activityTypes.find((item) => item.id === typeId);
    if (!type) return;
    setPending(true);

    const input = {
      opportunityId: opportunity.id,
      activityTypeId: type.id,
      contactId: contactId || null,
      outcome: outcome || null,
      notes: notes || null,
      occurredAt: new Date(occurredAt).toISOString(),
      nextActionTitle: addFollowUp && nextActionTitle ? nextActionTitle : undefined,
      nextActionAt: addFollowUp && nextActionTitle ? new Date(nextActionAt).toISOString() : undefined,
    };
    const result = await logActivityAction(input);
    setPending(false);
    if (!result.ok) {
      onToast(result.error);
      return;
    }

    const createdAt = new Date().toISOString();
    const newActivity: ActivitySummary = {
      id: crypto.randomUUID(),
      type,
      contactId: contactId || null,
      contactName: opportunity.contacts.find((item) => item.id === contactId)?.name ?? null,
      outcome: outcome || null,
      notes: notes || null,
      occurredAt: input.occurredAt,
      createdAt,
      createdBy: snapshot.users[0]?.name ?? "Current user",
    };
    const newTask: TaskSummary | null =
      input.nextActionTitle && input.nextActionAt
        ? {
            id: crypto.randomUUID(),
            title: input.nextActionTitle,
            dueAt: input.nextActionAt,
            status: "open",
            owner: opportunity.owner,
            contactId: contactId || null,
          }
        : null;
    onUpdate({
      ...opportunity,
      lastActivityAt: input.occurredAt,
      nextActionAt: newTask?.dueAt ?? opportunity.nextActionAt,
      activities: [newActivity, ...opportunity.activities],
      tasks: newTask ? [...opportunity.tasks, newTask] : opportunity.tasks,
      recentChannels: [...new Set([type.channel, ...opportunity.recentChannels])].slice(0, 4),
    });
    setNotes("");
    setOutcome("");
    setNextActionTitle("");
    setOpen(false);
    onToast(`${type.name} logged`);
  }

  return (
    <section className="surface compact-composer" data-open={open}>
      <header className="surface-header">
        <div><h3>Log an activity</h3><small>Record every attempt, channel and outcome</small></div>
        <button className={`btn ${open ? "btn-quiet" : "btn-primary"} btn-compact`} type="button" onClick={() => setOpen((value) => !value)}>{open ? <X size={13} /> : <Plus size={13} />}{open ? "Cancel" : "Log touch"}</button>
      </header>
      {open ? <form className="surface-content composer-fields" onSubmit={submit}>
        <div className="three-fields">
          <label className="field-label">Activity
            <select className="field-select" value={typeId} onChange={(event) => setTypeId(event.target.value)}>
              {snapshot.activityTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>
          <label className="field-label">Contact
            <select className="field-select" value={contactId} onChange={(event) => setContactId(event.target.value)}>
              <option value="">No contact</option>
              {opportunity.contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
            </select>
          </label>
          <label className="field-label">Outcome
            <select className="field-select" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              <option value="">Not set</option>
              <option>No response</option>
              <option>Connected</option>
              <option>Positive reply</option>
              <option>Negative reply</option>
              <option>Referred internally</option>
              <option>Wrong person</option>
              <option>Asked to follow up</option>
              <option>Meeting booked</option>
            </select>
          </label>
        </div>
        <div className="composer-fields-inner">
          <div className="two-fields">
            <label className="field-label">When it happened
              <input className="field" type="datetime-local" value={occurredAt} max={toDateTimeLocal(new Date().toISOString())} onChange={(event) => setOccurredAt(event.target.value)} required />
            </label>
            <label className="field-label">Notes (optional)
              <textarea className="field-textarea composer-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What happened? Record the useful detail." />
            </label>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={addFollowUp} onChange={(event) => setAddFollowUp(event.target.checked)} />
            Add the next action now
          </label>
          {addFollowUp ? (
            <div className="two-fields">
              <label className="field-label">Next action
                <input className="field" value={nextActionTitle} onChange={(event) => setNextActionTitle(event.target.value)} placeholder="e.g. Follow up on the overview" />
              </label>
              <label className="field-label">Due
                <input className="field" type="datetime-local" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} />
              </label>
            </div>
          ) : null}
          <div className="button-row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-primary" type="submit" disabled={pending || !typeId}>
              {pending ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
              Log activity
            </button>
          </div>
        </div>
      </form> : null}
    </section>
  );
}

function getDueState(value: string | null | undefined, now: string): DueState {
  if (!value) return "missing";
  const due = new Date(value).getTime();
  const reference = new Date(now).getTime();
  if (due < reference) return "overdue";
  if (due - reference < 48 * 60 * 60 * 1000) return "soon";
  return "future";
}

function stageGuidance(name: string) {
  return ({
    "Researching": "Actively validating fit and finding the right person.",
    "Research holding": "Market-map or paused research. No active outreach and not a sales loss.",
    "Ready to contact": "A credible person and route are identified; the next touch can be prepared.",
    "Outreach active": "One or more touches are underway; keep attempts and outcomes here until engagement.",
    "Engaged": "A real person has responded or opened a useful conversation.",
    "Conversation active": "A real person has responded and a useful sales conversation is underway.",
    "Review booked": "A discovery, review or working session is in the diary.",
    "Discovery booked": "A discovery or scoping conversation is in the diary.",
    "Pilot proposed": "A specific pilot or commercial next step has been offered.",
    "Proposal sent": "A clear scope, value and commercial proposal have been shared.",
    "Pilot active": "A live pilot is underway with an owner and success criteria.",
    "Decision pending": "The buyer has what they need and a decision or agreed next step is pending.",
    "Nurture": "There is genuine relationship signal, but timing is not active. Record a re-entry trigger and date.",
    "Won": "The opportunity converted into a customer or agreed engagement.",
    "Lost": "A genuine post-contact commercial loss. Research exclusions belong in Research holding.",
  } as Record<string, string>)[name] ?? "Pipeline stage";
}

function relative(value: string, now: string) {
  return formatDistanceStrict(new Date(value), new Date(now), { addSuffix: true });
}

function formatShortDate(value: string) {
  return format(new Date(value), "d MMM");
}

function formatTime(value: string) {
  return format(new Date(value), "d MMM, HH:mm");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function addDays(value: string, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}
