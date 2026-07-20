"use client";

import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Gauge,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import { startTransition, useMemo, useState } from "react";

import { completeTaskAction } from "@/app/actions/crm";
import type { BoardSnapshot, OpportunitySummary, StageSummary, TaskSummary } from "@/lib/domain/types";
import { getEdition } from "@/lib/editions";

type WorkItem = { task: TaskSummary; opportunity: OpportunitySummary };

export function MyWork({
  initialSnapshot,
  memberId,
  memberName,
}: {
  initialSnapshot: BoardSnapshot;
  memberId: string;
  memberName: string;
}) {
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const availableOffers = initialSnapshot.offers.filter((offer) => offer.active).sort((a, b) => a.position - b.position);
  const [offerFilter, setOfferFilter] = useState("all");
  const opportunities = useMemo(
    () => offerFilter === "all"
      ? initialSnapshot.opportunities
      : initialSnapshot.opportunities.filter((opportunity) => opportunity.offer?.id === offerFilter),
    [initialSnapshot.opportunities, offerFilter],
  );
  const now = useMemo(() => new Date(initialSnapshot.generatedAt), [initialSnapshot.generatedAt]);
  const stageById = useMemo(
    () => new Map(initialSnapshot.stages.map((stage) => [stage.id, stage])),
    [initialSnapshot.stages],
  );

  const allTasks = useMemo(
    () => opportunities
      .flatMap((opportunity) => opportunity.tasks
        .filter((task) => task.status === "open" && !completedIds.includes(task.id))
        .filter((task) => initialSnapshot.demoMode || task.owner?.id === memberId)
        .map((task) => ({ task, opportunity })))
      .sort((left, right) => compareWorkItems(left, right, now, stageById)),
    [completedIds, initialSnapshot.demoMode, memberId, now, opportunities, stageById],
  );

  const overdue = allTasks.filter(({ task }) => new Date(task.dueAt) < startOfToday(now));
  const dueToday = allTasks.filter(({ task }) => sameDay(new Date(task.dueAt), now));
  const dueThisWeek = allTasks.filter(({ task }) => {
    const due = new Date(task.dueAt);
    const days = (due.getTime() - startOfToday(now).getTime()) / 86_400_000;
    return days > 0 && days <= 7;
  });
  const laterTasks = allTasks.filter(({ task }) => new Date(task.dueAt).getTime() > startOfToday(now).getTime() + 7 * 86_400_000);
  const focusItems = allTasks.slice(0, 5);
  const openOpportunities = opportunities.filter((opportunity) => stageById.get(opportunity.stageId)?.terminalType === "open");
  const noNextAction = openOpportunities.filter(
    (opportunity) => opportunity.tasks.every((task) => task.status !== "open") && !opportunity.noNextActionReason,
  );
  const atRisk = openOpportunities.filter((opportunity) =>
    ["at_risk", "unresponsive"].includes(opportunity.temperature)
    || opportunity.tasks.some((task) => task.status === "open" && new Date(task.dueAt) < startOfToday(now)),
  );
  const attention = [...new Map([...noNextAction, ...atRisk].map((item) => [item.id, item])).values()];

  const readyCount = stageCount(opportunities, stageById, ["Ready to contact"]);
  const outreachCount = stageCount(opportunities, stageById, ["Outreach active"]);
  const conversationCount = stageCount(opportunities, stageById, ["Engaged", "Review booked", "Pilot proposed", "Pilot active", "Conversation active", "Discovery booked", "Proposal sent", "Decision pending"]);
  const nurtureCount = stageCount(opportunities, stageById, ["Nurture"]);
  const firstName = memberName.trim().split(/\s+/)[0] || "there";
  const edition = getEdition(initialSnapshot.edition);

  function complete(task: TaskSummary) {
    setCompletedIds((items) => [...items, task.id]);
    startTransition(async () => {
      const result = await completeTaskAction({ taskId: task.id });
      if (!result.ok) {
        setCompletedIds((items) => items.filter((id) => id !== task.id));
        showToast(result.error);
      } else {
        showToast("Task completed");
      }
    });
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2_400);
  }

  return (
    <>
      <header className="page-header today-header">
        <div className="page-title">
          <div className="today-kicker"><span className="today-date">{format(now, "EEEE d MMMM")}</span><span className="today-edition">{edition.name}</span></div>
          <h1>{greeting(now)}, {firstName}</h1>
          <p>{statusSentence(overdue.length, conversationCount, noNextAction.length)}</p>
        </div>
        <div className="header-actions">
          {availableOffers.length > 1 ? <label className="filter-chip offer-filter-chip"><Target size={14} /><select aria-label="Filter work by offer" value={offerFilter} onChange={(event) => setOfferFilter(event.target.value)}><option value="all">All offers</option>{availableOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label> : null}
          <Link className="btn" href="/pipeline"><Gauge size={15} />Open pipeline</Link>
        </div>
      </header>

      {initialSnapshot.demoMode ? <div className="demo-banner"><Sparkles size={14} /> Showing all owners in demo mode</div> : null}

      <div className="today-page">
        <div className="today-grid">
          <section className="surface focus-surface" aria-labelledby="focus-heading">
            <header className="focus-header">
              <div><span className="eyebrow">Start here</span><h2 id="focus-heading">Your next moves</h2></div>
              <span className="focus-count">{allTasks.length} open</span>
            </header>
            {focusItems.length ? (
              <div className="focus-list">
                {focusItems.map(({ task, opportunity }, index) => (
                  <FocusItem key={task.id} task={task} opportunity={opportunity} now={now} rank={index + 1} showOffer={availableOffers.length > 1 && offerFilter === "all"} onComplete={complete} />
                ))}
              </div>
            ) : <div className="command-empty"><Check size={24} /><strong>Your owned queue is clear.</strong><span>Use the pipeline to choose the next useful opportunity.</span></div>}
          </section>

          <aside className="today-rail">
            <section className="surface pulse-card" aria-labelledby="pulse-heading">
              <header><div><span className="eyebrow">Where things stand</span><h2 id="pulse-heading">Pipeline pulse</h2></div><Link href="/pipeline">View board <ArrowRight size={14} /></Link></header>
              <div className="pulse-track" aria-label={`${readyCount} ready, ${outreachCount} in outreach, ${conversationCount} in conversation, ${nurtureCount} nurturing`}>
                <i style={{ flexGrow: Math.max(readyCount, 0), background: "#53a0ff" }} />
                <i style={{ flexGrow: Math.max(outreachCount, 0), background: "#087bed" }} />
                <i style={{ flexGrow: Math.max(conversationCount, 0), background: "#08a878" }} />
                <i style={{ flexGrow: Math.max(nurtureCount, 0), background: "#64748b" }} />
              </div>
              <div className="pulse-list">
                <PulseRow label="Ready to contact" value={readyCount} colour="#53a0ff" />
                <PulseRow label="Outreach underway" value={outreachCount} colour="#087bed" />
                <PulseRow label="Live conversations" value={conversationCount} colour="#08a878" />
                <PulseRow label="Nurture" value={nurtureCount} colour="#64748b" />
              </div>
            </section>

            <section className="surface attention-card" aria-labelledby="attention-heading">
              <header><div><span className="eyebrow">Keep honest</span><h2 id="attention-heading">Needs a decision</h2></div><span>{attention.length}</span></header>
              {attention.length ? attention.slice(0, 4).map((opportunity) => (
                <Link href={`/pipeline?opportunity=${opportunity.id}`} key={opportunity.id}>
                  <span><strong>{opportunity.company.name}</strong><small>{attentionReason(opportunity, now)}</small></span>
                  <ArrowRight size={15} />
                </Link>
              )) : <div className="all-clear"><Check size={17} /> Every live opportunity has a healthy next step.</div>}
            </section>
          </aside>
        </div>

        <details className="surface queue-details">
          <summary>
            <span><CalendarDays size={17} /><span><strong>Plan the rest of the queue</strong><small>Open only when you need the full schedule.</small></span></span>
            <span className="queue-summary-count">{allTasks.length} actions</span>
            <ChevronDown size={18} className="queue-chevron" />
          </summary>
          <div className="queue-groups">
            <WorkGroup title="Overdue" icon={<AlertCircle size={15} />} items={overdue} onComplete={complete} empty="Nothing overdue." showOffer={availableOffers.length > 1 && offerFilter === "all"} />
            <WorkGroup title="Today" icon={<Clock3 size={15} />} items={dueToday} onComplete={complete} empty="No more actions due today." showOffer={availableOffers.length > 1 && offerFilter === "all"} />
            <WorkGroup title="Next seven days" icon={<CalendarDays size={15} />} items={dueThisWeek} onComplete={complete} empty="The next seven days are clear." showOffer={availableOffers.length > 1 && offerFilter === "all"} />
            {laterTasks.length ? <WorkGroup title="Later" icon={<TrendingUp size={15} />} items={laterTasks} onComplete={complete} empty="" showOffer={availableOffers.length > 1 && offerFilter === "all"} /> : null}
          </div>
        </details>
      </div>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </>
  );
}

function FocusItem({ task, opportunity, now, rank, showOffer, onComplete }: { task: TaskSummary; opportunity: OpportunitySummary; now: Date; rank: number; showOffer: boolean; onComplete: (task: TaskSummary) => void }) {
  return (
    <article className="focus-item" data-urgent={new Date(task.dueAt) < startOfToday(now)}>
      <span className="focus-rank">{rank}</span>
      <button className="complete-button" type="button" onClick={() => onComplete(task)} aria-label={`Complete ${task.title}`}><Check size={14} /></button>
      <div className="focus-copy">
        <Link href={`/pipeline?opportunity=${opportunity.id}`}>{task.title}</Link>
        <p><strong>{opportunity.company.name}</strong><span>{dueLabel(task.dueAt, now)}</span>{showOffer && opportunity.offer ? <span>{opportunity.offer.name}</span> : null}</p>
      </div>
      <Link className="focus-open" href={`/pipeline?opportunity=${opportunity.id}`} aria-label={`Open ${opportunity.company.name}`}><ArrowRight size={17} /></Link>
    </article>
  );
}

function PulseRow({ label, value, colour }: { label: string; value: number; colour: string }) {
  return <div><i style={{ background: colour }} /><span>{label}</span><strong>{value}</strong></div>;
}

function WorkGroup({ title, icon, items, onComplete, empty, showOffer }: { title: string; icon: React.ReactNode; items: WorkItem[]; onComplete: (task: TaskSummary) => void; empty: string; showOffer: boolean }) {
  return (
    <section className="queue-group">
      <header><h3>{icon}{title}</h3><span>{items.length}</span></header>
      {items.length ? items.map(({ task, opportunity }) => (
        <div className="work-item" key={task.id}>
          <button className="complete-button" type="button" onClick={() => onComplete(task)} aria-label={`Complete ${task.title}`}><Check size={14} /></button>
          <div className="work-item-copy">
            <Link href={`/pipeline?opportunity=${opportunity.id}`}>{task.title}</Link>
            <p>{opportunity.company.name} · {format(new Date(task.dueAt), "EEE d MMM, HH:mm")}</p>
            {showOffer && opportunity.offer ? <span className="offer-chip" style={{ "--offer-colour": opportunity.offer.colour } as React.CSSProperties}>{opportunity.offer.name}</span> : null}
          </div>
          <span className="mini-avatar">{initials(task.owner?.name ?? "U")}</span>
        </div>
      )) : <div className="empty-state">{empty}</div>}
    </section>
  );
}

function compareWorkItems(left: WorkItem, right: WorkItem, now: Date, stageById: Map<string, StageSummary>) {
  const score = (item: WorkItem) => {
    const due = new Date(item.task.dueAt).getTime();
    const overdueBoost = due < startOfToday(now).getTime() ? 1_000_000_000_000 : 0;
    const priority = { low: 0, medium: 2, high: 5, critical: 8 }[item.opportunity.priority] * 10_000_000;
    const temperature = { cold: 0, warm: 2, hot: 5, at_risk: 7, unresponsive: 6 }[item.opportunity.temperature] * 1_000_000;
    const progress = (stageById.get(item.opportunity.stageId)?.position ?? 0) * 10_000;
    return overdueBoost + priority + temperature + progress - due;
  };
  return score(right) - score(left) || new Date(left.task.dueAt).getTime() - new Date(right.task.dueAt).getTime();
}

function stageCount(opportunities: OpportunitySummary[], stageById: Map<string, StageSummary>, names: string[]) {
  const accepted = new Set(names);
  return opportunities.filter((opportunity) => accepted.has(stageById.get(opportunity.stageId)?.name ?? "")).length;
}

function attentionReason(opportunity: OpportunitySummary, now: Date) {
  if (opportunity.tasks.every((task) => task.status !== "open")) return "No owned, dated next action";
  if (opportunity.temperature === "at_risk") return "Marked at risk";
  if (opportunity.temperature === "unresponsive") return "Unresponsive — decide whether to vary the route or pause";
  if (opportunity.tasks.some((task) => task.status === "open" && new Date(task.dueAt) < startOfToday(now))) return "An action is overdue";
  return "Review the next move";
}

function statusSentence(overdue: number, conversations: number, noNextAction: number) {
  const parts = [
    overdue ? `${overdue} overdue` : "Nothing overdue",
    `${conversations} live ${conversations === 1 ? "conversation" : "conversations"}`,
    noNextAction ? `${noNextAction} without a next step` : "every opportunity accounted for",
  ];
  return parts.join(" · ");
}

function greeting(now: Date) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function dueLabel(value: string, now: Date) {
  const due = new Date(value);
  if (due < startOfToday(now)) return `Overdue · ${format(due, "d MMM, HH:mm")}`;
  if (sameDay(due, now)) return `Today · ${format(due, "HH:mm")}`;
  return format(due, "EEE d MMM · HH:mm");
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function startOfToday(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}
