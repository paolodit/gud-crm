"use client";

import { Mail } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { enrichOutreachContactAction } from "@/app/actions/research";
import { extractDomain } from "@/lib/domain/normalise";
import { hasOutreachContactFullName, type OutreachCandidate } from "@/lib/domain/outreach";

const workEmail = z.email();

export function OutreachWorkEmail({ candidate, contactId, configured }: {
  candidate: OutreachCandidate;
  contactId: string;
  configured: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  const lookupRunning = useRef(false);
  const contact = candidate.emailContacts.find((person) => person.id === contactId);
  if (!contact) return null;
  const { name, email, id } = contact;
  const emailAddress = workEmail.safeParse(email);
  const unavailable = !hasOutreachContactFullName(name) ? "Add the contact’s full name first."
    : !extractDomain(candidate.websiteUrl ?? "") ? "Save the company website first." : null;

  async function find() {
    if (!configured || unavailable || lookupRunning.current) return;
    lookupRunning.current = true;
    setPending(true);
    setFeedback(undefined);
    try {
      const result = await enrichOutreachContactAction({ opportunityId: candidate.id, contactId: id });
      setFeedback(result.ok ? {
        error: false, text: result.provider === "Existing record" ? "Email already saved in CRM." : `Work email saved from ${result.provider}.`,
      } : { error: true, text: result.error });
    } catch {
      setFeedback({ error: true, text: "Could not find a work email. Try again." });
    } finally {
      lookupRunning.current = false;
      setPending(false);
    }
  }

  if (!emailAddress.success && !configured) return null;
  return <div className="outreach-work-email">
    {emailAddress.success ? <a className="btn btn-quiet btn-compact" href={`mailto:${encodeURIComponent(emailAddress.data).replace("%40", "@")}`} title={emailAddress.data}>
      <Mail size={14} aria-hidden="true" />Email {name}
    </a> : <button className="btn btn-quiet btn-compact" type="button" aria-label={`Find work email for ${name}`}
      disabled={pending || Boolean(unavailable)} title={unavailable ?? `Find and save a work email for ${name}`} onClick={() => void find()}>
      <Mail size={14} aria-hidden="true" />{pending ? "Finding work email…" : "Find work email"}
    </button>}
    {!emailAddress.success && !feedback && <small>{unavailable ?? name}</small>}
    {feedback && <small className={feedback.error ? "outreach-email-error" : undefined} role={feedback.error ? "alert" : "status"}>{feedback.text}</small>}
  </div>;
}
