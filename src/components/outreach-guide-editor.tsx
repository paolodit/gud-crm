"use client";

import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent, type RefObject } from "react";

import { draftOutreachCopyAction, saveOutreachGuideAction } from "@/app/actions/outreach";
import { outreachScriptFields, type OutreachGuide } from "@/lib/domain/outreach";

export function OutreachGuideEditor({ guide, revision, aiEnabled, onClose }: {
  guide: OutreachGuide;
  revision: string;
  aiEnabled: boolean;
  onClose: () => void;
}) {
  const [objections, setObjections] = useState(() => guide.objections.map((objection, index) => ({ ...objection, id: String(index) })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const direction = useRef<HTMLInputElement>(null);
  const initialRevision = useRef(revision);
  const scriptFields = Object.keys(outreachScriptFields) as Array<keyof typeof outreachScriptFields>;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    const fields = new FormData(event.currentTarget);
    function read(name: string) { return String(fields.get(name) ?? ""); }
    try {
      const result = await saveOutreachGuideAction({
        revision: initialRevision.current,
        guide: {
          opener: read("opener"), gatekeeper: read("gatekeeper"), decisionMaker: read("decisionMaker"), voicemail: read("voicemail"),
          objections: objections.map(({ id }) => ({ label: read(`label-${id}`), reply: read(`reply-${id}`) })),
        },
      });
      if (!result.ok) { setError(result.error); return; }
      onClose();
    } catch {
      setError("Could not save the call guide. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="surface outreach-panel outreach-guide-editor" aria-labelledby="edit-outreach-guide">
    <div>
      <h2 id="edit-outreach-guide">Edit shared call guide</h2>
      <p>Saved wording is used across this workspace.</p>
    </div>
    <form className="outreach-result-form" onSubmit={save}>
      {aiEnabled && <label className="field-label">AI direction (optional)
        <input ref={direction} className="field" maxLength={500} placeholder="e.g. Make it shorter and more conversational" />
        <small>Draft with AI sends the chosen wording and this direction to OpenAI for a suggestion.</small>
      </label>}
      <div className="outreach-contact-fields">
        {scriptFields.map((field) => <GuideText key={field} name={field} label={outreachScriptFields[field]} value={guide[field]} aiEnabled={aiEnabled} direction={direction} />)}
      </div>
      <h3>Common objections</h3>
      {objections.map((objection, index) => <fieldset className="outreach-objection-edit" key={objection.id}>
        <legend>Objection {index + 1}</legend>
        <label className="field-label">What the prospect says
          <input className="field" name={`label-${objection.id}`} defaultValue={objection.label} maxLength={120} required />
        </label>
        <GuideText name={`reply-${objection.id}`} label="Suggested reply" value={objection.reply} aiEnabled={aiEnabled}
          direction={direction} objectionField={`label-${objection.id}`} />
        <button className="btn btn-quiet btn-compact" type="button" aria-label={`Remove objection ${index + 1}`} onClick={() => setObjections((items) => items.filter((item) => item.id !== objection.id))}>
          <Trash2 size={14} aria-hidden="true" />Remove
        </button>
      </fieldset>)}
      {objections.length < 12 && <button className="btn btn-quiet" type="button" onClick={() => setObjections((items) => [...items, { id: crypto.randomUUID(), label: "", reply: "" }])}>
        <Plus size={15} aria-hidden="true" />Add objection
      </button>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="outreach-guide-options">
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save call guide"}</button>
        <button className="btn btn-quiet" type="button" onClick={onClose} disabled={saving}>Cancel</button>
      </div>
    </form>
  </section>;
}

function GuideText({ name, label, value, aiEnabled, direction, objectionField }: {
  name: string;
  label: string;
  value: string;
  aiEnabled: boolean;
  direction: RefObject<HTMLInputElement | null>;
  objectionField?: string;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [error, setError] = useState("");

  async function draft() {
    const input = field.current;
    if (!input) return;
    const objection = objectionField ? input.form?.elements.namedItem(objectionField) : null;
    const editLabel = objection instanceof HTMLInputElement && objection.value.trim() ? `Reply to: ${objection.value.trim()}` : label;
    setPending(true);
    setError("");
    setSuggestion("");
    try {
      const result = await draftOutreachCopyAction({ field: editLabel, text: input.value, direction: direction.current?.value ?? "" });
      if (!result.ok) { setError(result.error); return; }
      setSuggestion(result.suggestion);
    } catch {
      setError("Could not draft wording. Try again.");
    } finally {
      setPending(false);
    }
  }

  return <div className="outreach-guide-text">
    <label className="field-label">{label}
      <textarea ref={field} className="field textarea" name={name} rows={3} autoFocus={name === "opener"} defaultValue={value} maxLength={2_000} required readOnly={pending} />
    </label>
    {aiEnabled && <button type="button" className="btn btn-quiet btn-compact" aria-label={`Draft ${label.toLowerCase()} with AI`} disabled={pending} onClick={() => void draft()}>
      <Sparkles size={14} aria-hidden="true" />{pending ? "Drafting…" : "Draft with AI"}
    </button>}
    {suggestion && <div className="outreach-suggestion">
      <p>{suggestion}</p>
      <div className="outreach-guide-options">
        <button type="button" className="btn btn-quiet btn-compact" onClick={() => {
          if (field.current) { field.current.value = suggestion; field.current.focus(); }
          setSuggestion("");
        }}>Use draft</button>
        <button type="button" className="btn btn-quiet btn-compact" onClick={() => setSuggestion("")}>Dismiss</button>
      </div>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
