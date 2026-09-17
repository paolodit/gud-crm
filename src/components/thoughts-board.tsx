"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useSensor, useSensors } from "@dnd-kit/core";
import { Archive, Check, Circle, Grip, Library, LockKeyhole, Maximize2, Mic, Minimize2, Plus, RefreshCw, Search, Sparkles, Square, StickyNote, X } from "lucide-react";
import { exploreThoughtAction, loadThoughtsAction, saveThoughtAction } from "@/app/actions/thoughts";
import { thoughtColours, thoughtFromSpeech, thoughtLabel, type Thought, type ThoughtContent, type ThoughtExploration } from "@/lib/domain/thoughts";
import { ProjectTaskList } from "./project-task-list";
import { useBoardPan } from "./use-board-pan";
import { useDialogFocus } from "./use-dialog-focus";
import { useSpeechCapture } from "./use-speech-capture";
import { ThoughtBodyEditor } from "./thought-body-editor";
import { ThoughtText } from "./thought-text";
import { ThoughtDictation } from "./thought-dictation";
import { nextThoughtPosition } from "@/lib/domain/thought-placement";
import { useSearchParams } from "next/navigation";

type BoardData = Extract<Awaited<ReturnType<typeof loadThoughtsAction>>, { ok: true }>;
const contentOf = (note: Thought): ThoughtContent => ({ title: note.title, body: note.body, checklist: note.checklist, colour: note.colour, category: note.category, x: note.x, y: note.y });

export function ThoughtsBoard({ initial }: { initial: BoardData }) {
  const searchParams = useSearchParams();
  const selectedThoughtId = searchParams.get("thought");
  const [notes, setNotes] = useState(initial.thoughts);
  const [explorations, setExplorations] = useState(initial.explorations);
  const [compact, setCompact] = useState(false);
  const [lanes, setLanes] = useState(false);
  const [dots, setDots] = useState(true);
  const [dateSort, setDateSort] = useState(false);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [draft, setDraft] = useState("");
  const [editor, setEditor] = useState<Thought | "new" | null>(null);
  const [editorVoice, setEditorVoice] = useState(false);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("gud:thought-context", { detail: typeof editor === "object" && editor ? editor.id : selectedThoughtId }));
  }, [editor, selectedThoughtId]);
  useEffect(() => {
    if (selectedThoughtId) document.querySelector(`[data-thought-id="${CSS.escape(selectedThoughtId)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedThoughtId]);
  const [newDraft, setNewDraft] = useState<ThoughtContent>({ title: "", body: "", checklist: [], colour: "butter", category: "", x: 32, y: 32 });
  const [panel, setPanel] = useState<string | "all" | null>(null);
  const [voice, setVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const id = useId();
  const pan = useBoardPan();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try { const value = JSON.parse(localStorage.getItem(initial.preferencesKey) ?? "null"); if (value) { setCompact(value.compact === true); setLanes(value.lanes === true); setDots(value.dots !== false); } } catch { /* Preferences are optional; no note content is stored here. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [initial.preferencesKey]);
  function viewPreference(nextCompact: boolean, nextLanes: boolean, nextDots = dots) {
    setCompact(nextCompact); setLanes(nextLanes); setDots(nextDots);
    try { localStorage.setItem(initial.preferencesKey, JSON.stringify({ compact: nextCompact, lanes: nextLanes, dots: nextDots })); } catch { /* Board still works without browser storage. */ }
  }
  useEffect(() => {
    const open = () => setVoice(true);
    window.addEventListener("gud:thought-voice", open);
    return () => window.removeEventListener("gud:thought-voice", open);
  }, []);
  const categories = [...new Set(notes.map((note) => note.category).filter(Boolean))];
  const shown = notes.filter((note) => note.archived === archived && `${note.title} ${note.body} ${note.category} ${note.checklist.map((item) => item.text).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  if (dateSort) shown.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const width = Math.max(1400, ...shown.map((note) => note.x + 340));
  const height = Math.max(1000, ...shown.map((note) => note.y + 360));
  function newContent(text = ""): ThoughtContent {
    const left = (viewport.current?.scrollLeft ?? 0) + 32, top = (viewport.current?.scrollTop ?? 0) + 32;
    const columns = Math.max(1, Math.floor(((viewport.current?.clientWidth ?? 1000) - 64) / 330));
    const { x, y } = nextThoughtPosition(notes, { x: left, y: top }, columns);
    return { title: "", body: text, checklist: [], colour: "butter", category: "", x, y };
  }
  async function save(content: ThoughtContent, current?: Thought, archive = current?.archived ?? false, optimistic = false) {
    if (busyRef.current) return null;
    busyRef.current = true; setBusy(true); setError("");
    if (optimistic && current) setNotes(items => items.map(item => item.id === current.id ? { ...item, ...content } : item));
    const rollback = () => { if (optimistic && current) setNotes(items => items.map(item => item.id === current.id ? current : item)); };
    try {
      const result = await saveThoughtAction({ content, ...(current ? { id: current.id, version: current.version } : {}), archived: archive });
      if (!result.ok) { rollback(); setError(result.error); return null; }
      setNotes((items) => items.some(item => item.id === result.thought.id) ? items.map(item => item.id === result.thought.id ? result.thought : item) : [...items, result.thought]);
      setStatus("Thought saved privately.");
      return result.thought;
    } catch { rollback(); setError("Could not confirm the save. Your draft is still here. Reload to check before retrying."); return null; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function quickAdd() { if (draft.trim() && await save(newContent(draft))) setDraft(""); }
  const reload = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const result = await loadThoughtsAction();
      if (!result.ok) { setError(result.error); return; }
      setNotes(result.thoughts); setExplorations(result.explorations); setError(""); setStatus("Board reloaded. Open drafts are unchanged.");
    } catch { setError("Could not reload your board. Please try again."); } finally { busyRef.current = false; setBusy(false); }
  }, []);
  useEffect(() => {
    const saved = () => { if (!document.querySelector('.thought-editor[data-gud-navigation-safe="false"]')) setEditor(null); void reload(); };
    const navigate = () => { if (!document.querySelector('.thought-editor[data-gud-navigation-safe="false"]')) setEditor(null); };
    window.addEventListener("gud:conversation-saved", saved);
    window.addEventListener("gud:conversation-navigation", navigate);
    return () => { window.removeEventListener("gud:conversation-saved", saved); window.removeEventListener("gud:conversation-navigation", navigate); };
  }, [reload]);
  return <div className="thoughts-page">
    <header className="page-header pipeline-page-header thoughts-header"><div className="page-title"><h1>Thoughts</h1><span className="thoughts-private"><LockKeyhole size={12} /> Only you</span></div><button type="button" className="btn btn-secondary" onClick={() => setPanel("all")}><Library size={16} />Explorations <span>{explorations.length}</span></button></header>
    <section className="thoughts-capture" aria-label="Capture a thought"><StickyNote size={20} /><textarea aria-label="New thought" placeholder="An idea, a question, a maybe…" value={draft} maxLength={20000} rows={1} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void quickAdd(); } }} /><button className="icon-button" type="button" aria-label="Speak a thought" onClick={() => setVoice(true)}><Mic size={18} /></button><button type="button" className="btn btn-primary" disabled={busy || !draft.trim()} onClick={() => void quickAdd()}><Plus size={16} />Add thought</button></section>
    <div className="thoughts-toolbar"><label className="thoughts-search"><Search size={14} /><input aria-label="Search private thoughts" placeholder="Find a thought" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button type="button" className="btn btn-quiet" onClick={() => { setNewDraft(newContent()); setEditor("new"); }}><Plus size={14} />Compose</button><label className="thoughts-guide"><input type="checkbox" checked={lanes} onChange={(event) => viewPreference(compact, event.target.checked)} />Lane guides</label><label className="thoughts-guide"><input type="checkbox" checked={dots} onChange={event => viewPreference(compact, lanes, event.target.checked)} />Dots</label><button type="button" className="btn btn-quiet" aria-pressed={archived} onClick={() => setArchived(!archived)}><Archive size={14} />Archive</button><div className="view-toggle"><button type="button" aria-pressed={!compact} onClick={() => viewPreference(false, lanes)}>Comfortable</button><button type="button" aria-pressed={compact} onClick={() => viewPreference(true, lanes)}>Compact</button></div><button type="button" className="icon-button" disabled={busy} aria-label="Reload private board" onClick={() => void reload()}><RefreshCw size={15} /></button><div className="thoughts-sort" role="group" aria-label="Arrange thoughts"><button type="button" aria-pressed={!dateSort} onClick={() => setDateSort(false)}>Free sort</button><button type="button" aria-pressed={dateSort} onClick={() => setDateSort(true)}>Sort by date</button>{dateSort ? <small>Newest first · your free arrangement is kept</small> : null}</div></div>
    {error ? <p className="thoughts-error" role="alert">{error}</p> : null}<span className="sr-only" role="status">{busy ? "Saving…" : status}</span>
    <div className="thoughts-workspace"><div ref={viewport} className="thoughts-viewport" {...pan}>
      <DndContext id={id} sensors={sensors} onDragEnd={({ active, delta }) => {
        const note = notes.find((item) => item.id === active.id); if (!note || dateSort || busy || (!delta.x && !delta.y)) return;
        const x = Math.max(0, Math.min(10000, Math.round(note.x + delta.x)));
        void save({ ...contentOf(note), x: lanes ? Math.min(9900, Math.round(x / 330) * 330 + 16) : x, y: Math.max(0, Math.min(10000, Math.round(note.y + delta.y))) }, note, note.archived, true);
      }}><div className="thoughts-canvas" data-sort={dateSort ? "date" : "free"} data-compact={compact} data-lanes={lanes} data-dots={dots} style={dateSort ? undefined : { width, height }} aria-label="Private thought board">
        {!shown.length ? <div className="thoughts-empty"><StickyNote size={40} /><h2>{query ? "Nothing here matches yet" : archived ? "No archived thoughts" : "It doesn’t have to be a plan."}</h2><p>{query ? "Try a different word." : "Drop a thought here. Move it around. Come back when it’s ready."}</p></div> : null}
        {shown.map((note) => <ThoughtNote key={note.id} note={note} disabled={busy} explorationCount={explorations.filter((item) => item.thoughtId === note.id).length} onOpen={() => { setEditorVoice(false); setEditor(note); }} onVoice={() => { setEditorVoice(true); setEditor(note); }} onExplore={() => setPanel(note.id)} onColour={colour => void save({ ...contentOf(note), colour }, note, note.archived, true)} onCheck={(taskId) => void save({ ...contentOf(note), checklist: note.checklist.map((item) => item.id === taskId ? { ...item, done: !item.done } : item) }, note)} />)}
      </div></DndContext>
    </div>{panel ? <ExplorationPanel selection={panel} notes={notes} explorations={explorations} aiEnabled={initial.aiEnabled} onSelect={setPanel} onClose={() => setPanel(null)} onArchive={async (note) => { await save(contentOf(note), note, !note.archived); }} onCreated={(document) => setExplorations((items) => [document, ...items])} /> : null}</div>
    <footer className="thoughts-footnote"><LockKeyhole size={12} /><span>{initial.local ? "Local single-user storage: anyone with access to this local installation can use this account." : "Private to your account. Not included in shared Ideas, CRM search, reports or exports."} Drag a note’s grip to move it; keyboard: Space, arrows, Space.</span></footer>
    {editor ? <ThoughtEditor key={typeof editor === "string" ? editor : `${editor.id}:${editor.version}`} initialVoice={editorVoice && editor !== "new"} initial={editor === "new" ? newDraft : contentOf(editor)} existing={editor === "new" ? undefined : editor} categories={categories} notes={notes} busy={busy} error={error} onClose={() => setEditor(null)} onSave={async (value, archive, explore) => { const saved = editor !== "new" && explore && JSON.stringify(value) === JSON.stringify(contentOf(editor)) ? editor : await save(value, editor === "new" ? undefined : editor, archive); if (saved) { setEditor(null); if (explore) setPanel(saved.id); } }} /> : null}
    {voice ? <ThoughtVoice onClose={() => setVoice(false)} onSave={async (spoken) => { const parsed = thoughtFromSpeech(spoken); const saved = await save({ ...newContent(parsed.body), checklist: parsed.checklist }); if (saved) { setVoice(false); if (parsed.explore) setPanel(saved.id); } }} busy={busy} error={error} /> : null}
  </div>;
}

function ThoughtNote({ note, disabled, explorationCount, onOpen, onVoice, onExplore, onColour, onCheck }: { note: Thought; disabled: boolean; explorationCount: number; onOpen: () => void; onVoice: () => void; onExplore: () => void; onColour: (colour: ThoughtContent["colour"]) => void; onCheck: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: note.id, disabled });
  const [coloursOpen, setColoursOpen] = useState(false);
  const colourRef = useRef<HTMLDivElement>(null), colourButton = useRef<HTMLButtonElement>(null);
  const pickerId = useId();
  useEffect(() => {
    if (!coloursOpen) return;
    const outside = (event: PointerEvent) => { if (!colourRef.current?.contains(event.target as Node)) setColoursOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [coloursOpen]);
  return <article ref={setNodeRef} className="thought-note" data-colour={note.colour} data-dragging={isDragging} data-thought-id={note.id} style={{ left: note.x, top: note.y, transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, zIndex: isDragging ? 100 : undefined }}>
    <button type="button" className="thought-note-open" disabled={disabled} aria-label={`Edit thought ${thoughtLabel(note)}`} onClick={onOpen}>{note.title ? <h2>{note.title}</h2> : null}{note.category && note.title ? <span className="thought-note-category">{note.category}</span> : null}<p><ThoughtText text={note.body} links={false} /></p>{note.category && !note.title ? <span className="thought-note-category">{note.category}</span> : null}</button>
    <div className="thought-note-actions"><button type="button" className="thought-grip thought-mic" disabled={disabled} aria-label={`Voice edit thought ${thoughtLabel(note)}`} title="Voice edit" onClick={onVoice}><Mic size={14} /></button><button type="button" className="thought-grip thought-explore" aria-label="Explore this idea" title={`Explore this idea${explorationCount ? ` · ${explorationCount} explorations` : ""}`} onClick={onExplore}><Sparkles size={14} />{explorationCount ? <span className="thought-explore-count">{explorationCount}</span> : null}</button><button type="button" className="thought-grip" disabled={disabled} aria-label={`Move thought ${thoughtLabel(note)}`} {...attributes} {...listeners}><Grip size={16} /></button></div>
    {note.checklist.length ? <div className="thought-note-checks">{note.checklist.slice(0, 3).map((item) => <button key={item.id} type="button" disabled={disabled} aria-pressed={item.done} onClick={() => onCheck(item.id)}>{item.done ? <Check size={15} /> : <Circle size={15} />}<span data-done={item.done}>{item.text}</span></button>)}<small>{note.checklist.filter((item) => item.done).length}/{note.checklist.length} done</small></div> : null}
    <div className="thought-quick-colour" ref={colourRef} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setColoursOpen(false); colourButton.current?.focus(); } }}><button ref={colourButton} type="button" className="thought-colour-toggle" aria-label={`Change colour of ${thoughtLabel(note)}`} title="Note colour" aria-expanded={coloursOpen} aria-controls={pickerId} disabled={disabled} onClick={() => setColoursOpen(!coloursOpen)}><span aria-hidden="true" /></button>{coloursOpen ? <fieldset id={pickerId} className="thought-colours thought-colour-popover"><legend>Note colour</legend>{thoughtColours.map(colour => <button key={colour} type="button" data-colour={colour} aria-label={`${colour} note`} aria-pressed={colour === note.colour} onClick={() => { setColoursOpen(false); colourButton.current?.focus(); onColour(colour); }}>{colour === note.colour ? <Check size={14} /> : null}</button>)}</fieldset> : null}</div>
  </article>;
}

function ThoughtEditor({ initial, initialVoice, existing, categories, notes, busy, error, onClose, onSave }: { initial: ThoughtContent; initialVoice: boolean; existing?: Thought; categories: string[]; notes: Thought[]; busy: boolean; error: string; onClose: () => void; onSave: (content: ThoughtContent, archive: boolean, explore?: boolean) => Promise<void> }) {
  const [value, setValue] = useState(initial);
  const [dictating, setDictating] = useState(initialVoice);
  const dirty = JSON.stringify(initial) !== JSON.stringify(value);
  const close = () => { if (!busy && ((!dirty && !dictating) || window.confirm("Discard the unsaved changes to this thought?"))) onClose(); };
  const focus = useDialogFocus(close);
  const [categoryQuery, setCategoryQuery] = useState("");
  function chooseCategory(category: string) { const match = notes.find(note => note.category.toLowerCase() === category.toLowerCase()); setValue({ ...value, category: match?.category ?? category, colour: match?.colour ?? value.colour }); setCategoryQuery(""); }
  return <div className="dialog-backdrop thoughts-modal"><section ref={focus} className="dialog-card thought-editor" data-gud-navigation-safe={!dirty && !dictating && !busy} role="dialog" aria-modal="true" aria-labelledby="thought-editor-title" tabIndex={-1}><header><h2 id="thought-editor-title" className="thought-editor-heading"><StickyNote size={18} />{existing ? "Edit thought" : "New thought"}</h2><button type="button" className="icon-button" aria-label="Close thought editor" onClick={close} disabled={busy}><X size={18} /></button></header><form onSubmit={(event) => { event.preventDefault(); if (!dictating) void onSave(value, existing?.archived ?? false); }}>
    <div className="thought-title-row"><input className="thought-title-input" aria-label="Title" placeholder="Add a title…" autoComplete="off" maxLength={160} value={value.title} onChange={(event) => setValue({ ...value, title: event.target.value })} disabled={busy} /><button type="button" className="icon-button" aria-label="Voice edit thought" title="Voice edit" onClick={() => setDictating(true)} disabled={busy || dictating}><Mic size={18} /></button></div>
    {dictating ? <ThoughtDictation disabled={busy} onClose={() => setDictating(false)} onApply={(text, replace) => { const parsed = thoughtFromSpeech(text); setValue({ ...value, body: (replace ? parsed.body : [value.body, parsed.body].filter(Boolean).join("\n")).slice(0, 20000), checklist: [...value.checklist, ...parsed.checklist].slice(0, 100) }); setDictating(false); }} /> : null}
    <ThoughtBodyEditor value={value.body} onChange={body => setValue({ ...value, body })} disabled={busy} />
    <ProjectTaskList personal tasks={value.checklist.map(({ done, ...item }) => ({ ...item, completed: done }))} disabled={busy} onChange={(items) => setValue({ ...value, checklist: items.map(({ completed, ...item }) => ({ ...item, done: completed })) })} />
    <fieldset className="thought-colours"><legend>Note colour</legend>{thoughtColours.map((colour) => <button key={colour} type="button" data-colour={colour} disabled={busy} aria-label={`${colour} note`} aria-pressed={value.colour === colour} onClick={() => setValue({ ...value, colour })}>{value.colour === colour ? <Check size={16} /> : null}</button>)}</fieldset>
<section className="thought-category-picker" aria-label="Thought category"><label className="field-label"><span>Category <small className="muted">optional</small></span><input aria-label="Find or create category" placeholder="Find a category or type a new one…" maxLength={60} disabled={busy} value={categoryQuery} onChange={event => setCategoryQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && categoryQuery.trim()) { event.preventDefault(); chooseCategory(categoryQuery.trim()); } }} /></label><div className="thought-category-options"><button type="button" aria-pressed={!value.category} disabled={busy} onClick={() => chooseCategory("")}>No category</button>{[...new Set([value.category, ...categories])].filter(category => category && (!categoryQuery || category.toLowerCase().includes(categoryQuery.toLowerCase()))).map(category => <button key={category} type="button" aria-pressed={value.category === category} disabled={busy} onClick={() => chooseCategory(category)}>{value.category === category ? <Check size={13} /> : null}{category}</button>)}{categoryQuery.trim() && !categories.some(category => category.toLowerCase() === categoryQuery.trim().toLowerCase()) ? <button type="button" disabled={busy} onClick={() => chooseCategory(categoryQuery.trim())}><Plus size={13} />Create “{categoryQuery.trim()}”</button> : null}</div><small>{value.category ? `Selected: ${value.category}` : "Choose a category above, or create one. It is saved with your thought."}</small></section>
    {error ? <p role="alert" className="thoughts-error">{error}</p> : null}<footer>{existing ? <button type="button" className="btn btn-quiet" disabled={busy || dictating} onClick={() => void onSave(value, !existing.archived)}><Archive size={14} />{existing.archived ? "Restore thought" : "Archive thought"}</button> : <span />}<button type="button" className="btn btn-quiet" disabled={busy || dictating || !(value.title.trim() || value.body.trim() || value.checklist.length)} title={dirty || !existing ? "Save this thought and open exploration" : "Open exploration"} onClick={() => void onSave(value, existing?.archived ?? false, true)}><Sparkles size={14} />Explore this idea</button><button type="submit" className="btn btn-primary" disabled={busy || dictating || !(value.title.trim() || value.body.trim() || value.checklist.length)}>{busy ? "Saving…" : "Save thought"}</button></footer>
  </form></section></div>;
}

function ThoughtVoice({ onClose, onSave, busy, error }: { onClose: () => void; onSave: (transcript: string) => Promise<void>; busy: boolean; error: string }) {
  const [transcript, setTranscript] = useState("");
  const speech = useSpeechCapture(setTranscript);
  const close = () => { if (!busy && (!transcript.trim() || window.confirm("Discard this unsaved voice draft?"))) { speech.stop(); onClose(); } };
  const focus = useDialogFocus(close);
return <div className="dialog-backdrop thoughts-modal"><section ref={focus} className="dialog-card thought-editor" role="dialog" aria-modal="true" aria-labelledby="thought-voice-title"><header><h2 id="thought-voice-title">Talk through a thought</h2><button type="button" className="icon-button" aria-label="Close thought voice" disabled={busy} onClick={close}><X size={18} /></button></header><p>“Gud, new thought…” — keep talking. Say “bullet” or “to-do” for a new item, and “explore that” to open an exploration after saving.</p><p className="muted">Recording uses your browser’s speech service, which may process audio externally. GUD does not store the audio. Nothing goes to the workspace AI during capture.</p><button type="button" className="btn btn-secondary" disabled={busy || !speech.supported} onClick={() => speech.state === "listening" ? speech.stop() : speech.start(transcript)}>{speech.state === "listening" ? <Square size={15} /> : <Mic size={15} />}{speech.state === "listening" ? "Stop recording" : "Start recording"}</button>{!speech.supported ? <p>Speech is unavailable in this browser. You can type below.</p> : null}{speech.error ? <p role="alert">{speech.error}</p> : null}<label className="field-label">Your words<textarea data-autofocus rows={8} value={transcript} maxLength={12000} disabled={busy} onChange={(event) => setTranscript(event.target.value)} /></label><small>Review before saving. Voice commands can be corrected here.</small>{error ? <p role="alert" className="thoughts-error">{error}</p> : null}<footer><span>Only your personal board</span><button type="button" className="btn btn-primary" disabled={busy || !transcript.trim() || speech.state !== "idle"} onClick={() => void onSave(transcript)}>Save thought</button></footer></section></div>;
}

function ExplorationPanel({ selection, notes, explorations, aiEnabled, onSelect, onClose, onArchive, onCreated }: { selection: string; notes: Thought[]; explorations: ThoughtExploration[]; aiEnabled: boolean; onSelect: (id: string) => void; onClose: () => void; onArchive: (note: Thought) => Promise<void>; onCreated: (document: ThoughtExploration) => void }) {
  const [wide, setWide] = useState(false);
  const [panelWidth, setPanelWidth] = useState(470);
  const [research, setResearch] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [directions, setDirections] = useState<Record<string, string>>({});
  const [dictating, setDictating] = useState<string | null>(null);
  const direction = directions[selection] ?? "";
  const setDirection = (text: string) => setDirections(values => ({ ...values, [selection]: text.slice(0, 4000) }));
  const section = useRef<HTMLElement>(null);
  const note = notes.find((item) => item.id === selection);
  const documents = explorations.filter((item) => selection === "all" || item.thoughtId === selection);
  const active = documents.find((item) => item.id === activeId) ?? documents[0];
  useEffect(() => { section.current?.focus(); }, []);
  async function explore(mode: "ai" | "outline") {
    if (!note || pending) return;
    setPending(true); setError("");
    try {
      const result = await exploreThoughtAction({ id: note.id, mode, research: mode === "ai" && research, direction });
      if (!result.ok) { setError(result.error); return; }
      onCreated(result.exploration); setActiveId(result.exploration.id);
    } catch { setError("Could not confirm this exploration. Reload the board to check before trying again."); } finally { setPending(false); }
  }
  return <aside ref={section} tabIndex={-1} className="thought-exploration-panel" data-wide={wide} aria-label="Private explorations" style={{ "--thought-panel-width": `${panelWidth}px` } as CSSProperties} onKeyDown={(event) => { if (event.key === "Escape" && !pending) onClose(); }}>
    <div className="thought-panel-resize" role="separator" aria-label="Resize exploration panel" aria-orientation="vertical" aria-valuemin={340} aria-valuemax={1000} aria-valuenow={panelWidth} tabIndex={0} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); setPanelWidth((value) => Math.max(340, Math.min(1000, value + (event.key === "ArrowLeft" ? 40 : -40)))); } }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.startX = String(event.clientX); event.currentTarget.dataset.startWidth = String(panelWidth); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setPanelWidth(Math.max(340, Math.min(1000, Number(event.currentTarget.dataset.startWidth) + Number(event.currentTarget.dataset.startX) - event.clientX))); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
    <header><div><span className="thoughts-private"><LockKeyhole size={12} /> Private library</span><h2>{note ? "Explore this idea" : "All explorations"}</h2></div><button type="button" className="icon-button" aria-label={wide ? "Dock exploration panel" : "Pull out exploration panel"} onClick={() => setWide(!wide)}>{wide ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button><button type="button" className="icon-button" disabled={pending} aria-label="Close explorations" onClick={onClose}><X size={18} /></button></header>
    <div className="thought-panel-body"><div className="thought-panel-tabs"><button type="button" className="btn btn-quiet" disabled={pending} onClick={() => onSelect("all")}><Library size={14} />All ideas</button>{note ? <span>{thoughtLabel(note)}</span> : null}</div>
    {note ? <section className="thought-explore-controls"><div className="thought-direction-heading"><h3>Where would you like to take this?</h3><button className="icon-button" type="button" aria-label="Speak exploration direction" disabled={pending} onClick={() => setDictating(dictating === selection ? null : selection)}><Mic size={17} /></button></div><textarea aria-label="Exploration direction" rows={3} placeholder="An angle to research, a question to answer, a constraint…" maxLength={4000} value={direction} onChange={e => setDirection(e.target.value)} disabled={pending} />{dictating === selection ? <ThoughtDictation key={selection} disabled={pending} onClose={() => setDictating(null)} onApply={(text, replace) => { setDirection(replace ? text : [direction, text].filter(Boolean).join("\n")); setDictating(null); }} /> : null}<p>Optional. Each exploration is a new document; your note stays unchanged.</p>{aiEnabled ? <><p className="thought-ai-notice">Generate sends only this thought, its list and your direction to the configured OpenAI provider. Provider retention policies apply. No other Thoughts are included.</p><label className="thought-research"><input type="checkbox" checked={research} onChange={(event) => setResearch(event.target.checked)} disabled={pending} />Include web research</label>{research ? <small>Search queries may be shared with search providers. Avoid this for sensitive ideas.</small> : null}<button type="button" className="btn btn-primary" disabled={pending || dictating === selection} onClick={() => void explore("ai")}><Sparkles size={15} />{pending ? "Exploring…" : "Generate exploration"}</button></> : <p>AI exploration is not configured. You can still create an offline thinking outline.</p>}<button type="button" className="btn btn-quiet" disabled={pending || dictating === selection} onClick={() => void explore("outline")}>Create thinking outline · no AI</button><button type="button" className="btn btn-quiet" disabled={pending} onClick={async () => { setPending(true); try { await onArchive(note); } finally { setPending(false); } }}><Archive size={14} />{note.archived ? "Restore thought" : "Archive thought"}</button><small>Archiving keeps all exploration history.</small></section> : null}
    {error ? <p role="alert" className="thoughts-error">{error}</p> : null}<p className="sr-only" role="status">{pending ? "Preparing your private exploration" : ""}</p>
    {documents.length ? <><label className="field-label">{selection === "all" ? "Explore your library" : "Exploration history"}<select value={active?.id ?? ""} onChange={(event) => setActiveId(event.target.value)}>{documents.map((document) => <option key={document.id} value={document.id}>{document.thoughtTitle.slice(0, 60)} · {new Date(document.createdAt).toLocaleString("en-GB")} · {document.origin}</option>)}</select></label>{active ? <article className="thought-document"><h2>{active.title}</h2><p className="thought-document-meta">{new Date(active.createdAt).toLocaleString("en-GB")} · Thought version {active.thoughtVersion} · {active.origin === "outline" ? "Thinking template · not AI research" : active.origin === "mcp" ? "External assistant · verify its claims" : active.researched ? "AI exploration with cited sources · verify key claims" : "AI exploration · no cited web research"}</p>{selection === "all" ? <button type="button" className="btn btn-quiet" onClick={() => onSelect(active.thoughtId)}>Open this idea’s explorations</button> : null}<ExplorationText document={active} /></article> : null}</> : <div className="thoughts-empty-library"><Library size={28} /><p>No explorations yet. Choose “Explore this idea” on any thought to begin.</p></div>}
    </div>
  </aside>;
}

/** Plain text only; URL annotations become visible inline links. Never render provider HTML. */
function ExplorationText({ document }: { document: ThoughtExploration }) {
  const lines = document.body.split("\n");
  const starts = lines.reduce<number[]>((items, line, index) => [...items, index ? items[index - 1] + lines[index - 1].length + 1 : 0], []);
  return <div className="thought-document-text">{lines.map((line, lineIndex) => {
    const start = starts[lineIndex], offset = start + line.length + 1;
    const sources = document.sources.filter((source) => source.start >= start && source.start < offset && source.end <= offset && source.end > source.start && /^https?:\/\//i.test(source.url)).sort((a, b) => a.start - b.start);
    const parts: ReactNode[] = []; let cursor = 0;
    for (const source of sources) { const localStart = source.start - start, localEnd = source.end - start; if (localStart < cursor) continue; parts.push(<ThoughtText key={`text:${cursor}`} text={line.slice(cursor, localStart)} />); parts.push(<a key={`${source.url}:${source.start}`} href={source.url} target="_blank" rel="noopener noreferrer">[{source.title || "Source"}]</a>); cursor = localEnd; }
    parts.push(<ThoughtText key={`text:${cursor}`} text={line.slice(cursor)} />);
    if (!sources.length && /^#{1,3} /.test(line)) return <h3 key={lineIndex}>{line.replace(/^#{1,3} /, "")}</h3>;
    return <p key={lineIndex}>{parts.length ? parts : "\u00a0"}</p>;
  })}{document.sources.length ? <div className="thought-sources"><h3>Sources</h3>{[...new Map(document.sources.map((source) => [source.url, source])).values()].map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a>)}</div> : null}</div>;
}
