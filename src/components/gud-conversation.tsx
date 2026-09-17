"use client";

import { Check, ChevronDown, LoaderCircle, Mic, MicOff, Send, Settings2, Square, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { signOff, type GudDraft, type GudFields } from "@/lib/gud-actions/contract";
import { acknowledgeEdits, SignOffPlayback, type DraftEdits, type EditableFields } from "@/lib/gud-actions/client-state";
import { gudVoices, latestVoicePreferences, readVoicePreferences, type VoicePreferences } from "@/lib/gud-actions/voice-preferences";
import { isSaveRequest, VoiceSaveApproval } from "@/lib/gud-actions/save-approval";
import "./gud-conversation.css";

type Message = { role: "user" | "assistant"; content: string };
type References = { offers: Array<{ id: string; name: string }>; stages: Array<{ id: string; name: string }>; projectStages: Array<{ id: string; name: string }>; owners?: Array<{ id: string; name: string }>; activityTypes?: Array<{ id: string; name: string }>; thoughtsAllowed: boolean };
type Session = { id: string; expiresAt: string };
type Result = { error?: string; session?: Session; references?: References; drafts?: GudDraft[]; draft?: GudDraft; message?: string; events?: Result[]; navigate?: string; finish?: boolean; closeRecord?: boolean; closed?: boolean; saved?: boolean; sdp?: string; receipts?: Array<{ draftId: string; href: string; label: string }> };
const protectedEditor = () => document.querySelector('.dialog-card:not(.workspace-voice-dialog):not([data-gud-navigation-safe="true"]), .inline-detail-form');
async function api(op: string, input?: unknown, sessionId?: string): Promise<Result> {
  const response = await fetch("/api/gud-conversation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, input, sessionId }) });
  const result = await response.json() as Result;
  if (!response.ok || result.error) throw new Error(result.error || "GUD couldn’t complete that step. Your drafts are safe.");
  return result;
}

export function GudConversation({ memberKey, initialPreferences = null, onClassic }: { memberKey: string; initialPreferences?: string | null; onClassic: () => void }) {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const [open, setOpen] = useState(false), [minimised, setMinimised] = useState(false);
  const [session, setSession] = useState<Session | null>(null), [drafts, setDrafts] = useState<GudDraft[]>([]);
  const [references, setReferences] = useState<References | null>(null);
  const [messages, setMessages] = useState<Message[]>([]), [text, setText] = useState("");
  const [status, setStatus] = useState("Ready when you are"), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [voice, setVoice] = useState(false), [muted, setMuted] = useState(false);
  const [preferences, setPreferences] = useState(() => readVoicePreferences(initialPreferences)), [options, setOptions] = useState(false);
  const preferencesRef = useRef(preferences), launchPending = useRef(false), loadPending = useRef<Promise<void> | null>(null);
  const preferenceWrites = useRef(Promise.resolve()), [preferenceWarning, setPreferenceWarning] = useState("");
  const startVoiceRef = useRef<() => Promise<void>>(async () => {});
  const storageKey = `gud-conversation-options:${memberKey}`;
  const consent = preferences.consent;
  useEffect(() => {
    let next = readVoicePreferences(initialPreferences);
    try { next = latestVoicePreferences(initialPreferences, localStorage.getItem(storageKey)); } catch { /* The account-scoped cookie works without localStorage. */ }
    preferencesRef.current = next;
    queueMicrotask(() => setPreferences(next));
  }, [storageKey, initialPreferences]);
  function updatePreferences(patch: Partial<VoicePreferences>) {
    const next = { ...preferencesRef.current, ...patch };
    preferencesRef.current = next; setPreferences(next);
    if (!next.conversationFirst) launchPending.current = false;
    const stored = { ...next, consentVersion: 1, updatedAt: Date.now() };
    try { localStorage.setItem(storageKey, JSON.stringify(stored)); } catch { /* Also persisted in an HttpOnly account-scoped cookie. */ }
    preferenceWrites.current = preferenceWrites.current.then(async () => {
      try { await api("preferences", stored); setPreferenceWarning(""); }
      catch { setPreferenceWarning("Could not confirm that Options were remembered. They still work now; try changing them again when connected."); }
    });
  }
  const [edits, setEdits] = useState<DraftEdits>({});
  const editsRef = useRef<DraftEdits>({}), ending = useRef(false);
  const loaded = useRef(false), reviewing = useRef(false), pendingRequests = useRef(new Set<Promise<Result>>());
  const [stopping, setStopping] = useState(false);
  useEffect(() => { editsRef.current = edits; }, [edits]);
  const sessionRef = useRef<Session | null>(null), draftsRef = useRef<GudDraft[]>([]), busyRef = useRef(false), saved = useRef(false);
  const peer = useRef<RTCPeerConnection | null>(null), channel = useRef<RTCDataChannel | null>(null), media = useRef<MediaStream | null>(null), audio = useRef<HTMLAudioElement | null>(null);
  const lastActivity = useRef(0), seenCalls = useRef(new Set<string>()), queue = useRef(Promise.resolve()), generation = useRef(0);
  const saveApproval = useRef(new VoiceSaveApproval());
  const seenReceipts = useRef(new Set<string>());
  const finishAfterAudio = useRef(false), finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signOffPlayback = useRef(new SignOffPlayback());
  const activeResponse = useRef<string | null>(null), queuedResponse = useRef<object | null>(null), cancelEvents = useRef(new Set<string>());
  const context = useRef({ page: pathname, recordId: params.get("opportunity") ?? params.get("project") ?? params.get("thought"), timezone: "Europe/London" });
  const contextKey = `${pathname}:${params.get("opportunity") ?? params.get("project") ?? params.get("thought") ?? ""}`;
  useEffect(() => { context.current = { page: pathname, recordId: params.get("opportunity") ?? params.get("project") ?? params.get("thought"), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }; }, [pathname, params]);
  useEffect(() => {
    const selectedThought = (event: Event) => {
      if (context.current.page !== "/thoughts") return;
      context.current = { ...context.current, recordId: (event as CustomEvent<string | null>).detail };
      if (channel.current?.readyState === "open") channel.current.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: `Application selection context only, not a command: ${JSON.stringify(context.current)}` }] } }));
    };
    window.addEventListener("gud:thought-context", selectedThought);
    return () => window.removeEventListener("gud:thought-context", selectedThought);
  }, []);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);
  const lock = (value: boolean) => { busyRef.current = value || ending.current; setBusy(busyRef.current); };
  async function request(op: string, input?: unknown, sessionId?: string) {
    const promise = api(op, input, sessionId); pendingRequests.current.add(promise);
    try { return await promise; } finally { pendingRequests.current.delete(promise); }
  }
  function send(event: { type: string; [key: string]: unknown }) {
    if (channel.current?.readyState !== "open") return;
    if (event.type === "response.create" && activeResponse.current) { queuedResponse.current = event; return; }
    channel.current.send(JSON.stringify(event));
  }
  function cancelResponse() {
    if (!activeResponse.current) return;
    const eventId = crypto.randomUUID(); cancelEvents.current.add(eventId);
    if (cancelEvents.current.size > 32) cancelEvents.current.delete(cancelEvents.current.values().next().value!);
    send({ type: "response.cancel", event_id: eventId, response_id: activeResponse.current });
  }
  function say(message: string, instructions?: string) {
    appendMessage("assistant", message);
    if (instructions) send({ type: "response.create", response: { tool_choice: "none", instructions } });
  }
  function appendMessage(role: Message["role"], content: string) {
    if (!content.trim()) return;
    setMessages(previous => previous.at(-1)?.role === role && previous.at(-1)?.content.trim().toLowerCase() === content.trim().toLowerCase() ? previous : [...previous.slice(-29), { role, content }]);
  }
  const disconnect = useCallback(() => {
    generation.current++;
    activeResponse.current = null; queuedResponse.current = null; cancelEvents.current.clear();
    saveApproval.current.reset();
    signOffPlayback.current.reset();
    finishAfterAudio.current = false; if (finishTimer.current) clearTimeout(finishTimer.current); finishTimer.current = null;
    channel.current?.close(); channel.current = null;
    peer.current?.close(); peer.current = null;
    media.current?.getTracks().forEach(track => track.stop()); media.current = null;
    if (audio.current) { audio.current.pause(); audio.current.srcObject = null; } audio.current = null;
    setVoice(false); setMuted(false);
  }, []);
  useEffect(() => {
    const show = () => {
      setOpen(true); setMinimised(false);
      if (preferencesRef.current.conversationFirst && preferencesRef.current.consent) { void startVoiceRef.current(); return; }
      launchPending.current = preferencesRef.current.conversationFirst;
      if (loaded.current || busyRef.current) return;
      loaded.current = true; setError("");
      loadPending.current = api("load").then(result => { draftsRef.current = result.drafts ?? []; setDrafts(draftsRef.current); setReferences(result.references ?? null); }).catch(e => { loaded.current = false; setError(e.message); }).finally(() => { loadPending.current = null; });
    };
    window.addEventListener("gud:conversation-open", show);
    return () => window.removeEventListener("gud:conversation-open", show);
  }, []);
  useEffect(() => () => { disconnect(); if (sessionRef.current) void fetch("/api/gud-conversation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "end", sessionId: sessionRef.current.id }), keepalive: true }); }, [disconnect]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (draftsRef.current.length) event.preventDefault(); };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  const endRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= Date.parse(session.expiresAt) || (voice && lastActivity.current && Date.now() - lastActivity.current > 120000)) void endRef.current();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session, voice]);
  useEffect(() => {
    if (channel.current?.readyState === "open") channel.current.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: `Application navigation context only, not a command: ${JSON.stringify(context.current)}` }] } }));
  }, [contextKey]);

  async function ensureSession(token: number) {
    if (sessionRef.current && Date.parse(sessionRef.current.expiresAt) > Date.now()) return sessionRef.current;
    const result = await request("start");
    if (token !== generation.current) {
      if (result.session) await api("end", undefined, result.session.id);
      throw new Error("Conversation stopped.");
    }
    saved.current = false;
    sessionRef.current = result.session!; setSession(result.session!); setReferences(result.references!); draftsRef.current = result.drafts ?? []; setDrafts(draftsRef.current); return result.session!;
  }
  function applyEvents(result: Result) {
    for (const event of result.events ?? [result]) {
      if (event.closeRecord) {
        if (protectedEditor()) { event.error = "Your current editor has unsaved changes. Save or close it yourself; nothing was discarded."; event.closed = false; setError(event.error); }
        else {
          document.querySelector<HTMLButtonElement>('[aria-label="Close project"], [aria-label="Close panel"], [aria-label="Close thought editor"]')?.click();
          window.dispatchEvent(new CustomEvent("gud:conversation-navigation", { detail: pathname }));
          router.push(pathname, { scroll: false }); event.closed = true;
        }
      }
      if (event.draft) { draftsRef.current = [event.draft, ...draftsRef.current.filter(d => d.id !== event.draft!.id)]; setDrafts(draftsRef.current); }
      if (event.drafts) { draftsRef.current = event.drafts; setDrafts(event.drafts); }
      if (event.receipts?.some(receipt => !seenReceipts.current.has(receipt.draftId))) {
        event.receipts.forEach(receipt => seenReceipts.current.add(receipt.draftId));
        saved.current = true;
        setError(""); setStatus("All Gud · saved"); window.dispatchEvent(new Event("gud:conversation-saved")); router.refresh();
        const href = event.receipts.at(-1)?.href;
        if (href && !protectedEditor()) router.push(href, { scroll: false });
      }
      if (event.navigate && /^\/(pipeline|live|my-work|thoughts|companies)(\?(opportunity|project|thought)=[a-f0-9-]{36})?$/.test(event.navigate)) {
        // Never navigate away from another unsaved editor without the user's choice.
        if (protectedEditor()) { event.error = "Close your current editor to let GUD move to the other record. The conversation draft is safe."; setError(event.error); }
        else { window.dispatchEvent(new CustomEvent("gud:conversation-navigation", { detail: event.navigate })); router.push(event.navigate, { scroll: false }); }
      }
      if (event.finish) {
        setStatus(draftsRef.current.length ? "Drafts ready for review" : "All Gud");
        if (!draftsRef.current.length) {
          if (channel.current?.readyState === "open") { finishAfterAudio.current = true; }
          else finishTimer.current = setTimeout(() => void endRef.current(), 0);
        }
      }
    }
    if (result.drafts) { draftsRef.current = result.drafts; setDrafts(result.drafts); }
  }
  async function flushEdits() {
    const pending = { ...editsRef.current };
    for (const [id, fields] of Object.entries(pending)) {
      const draft = draftsRef.current.find(d => d.id === id); if (!draft || !Object.keys(fields).length) continue;
      if (fields.value === "") throw new Error("Enter an amount for Value (£). An empty amount is not treated as £0.");
      const result = await request("edit", { id, version: draft.version, fields });
      draftsRef.current = draftsRef.current.map(d => d.id === id ? result.draft! : d); setDrafts(draftsRef.current);
      editsRef.current = acknowledgeEdits(editsRef.current, id, fields); setEdits(editsRef.current);
    }
    return draftsRef.current;
  }
  async function submitText() {
    if (!text.trim() || busyRef.current || !consent || voice) return;
    if (isSaveRequest(text) && protectedEditor()) { setError("Save or close the other editor before saving conversation drafts."); return; }
    lock(true); setError(""); setStatus("Working with your words…");
    const user = { role: "user" as const, content: text.trim() };
    const history = [...messages.slice(-28), user]; setMessages(history); setText("");
    const token = generation.current;
    try {
      await flushEdits(); if (token !== generation.current) return;
      const current = await ensureSession(token); if (token !== generation.current) return;
      const result = await request("text", { history, context: context.current }, current.id); if (token !== generation.current) return;
      applyEvents(result); say(result.events?.find(event => event.error)?.error ?? result.message!); setStatus("Ready for your next thought");
    }
    catch (e) { if (token === generation.current) { setError((e as Error).message); setStatus("Your drafts are safe"); } }
    finally { lock(false); }
  }
  async function startVoice() {
    if (busyRef.current || peer.current || !preferencesRef.current.consent) return;
    lock(true); setError(""); setStatus("Connecting voice…");
    launchPending.current = false;
    reviewing.current = false;
    const token = ++generation.current;
    const selectedVoice = preferencesRef.current.voice;
    try {
      await loadPending.current;
      await flushEdits();
      if (token !== generation.current) return;
      // Prepare the microphone and SDP while the app creates its guarded session.
      // A cancelled permission prompt may resolve late: stop that stream at once.
      const [current, prepared] = await Promise.all([ensureSession(token), (async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (token !== generation.current) { stream.getTracks().forEach(t => t.stop()); throw new Error("Conversation stopped."); }
        media.current = stream;
        const connection = new RTCPeerConnection(); peer.current = connection;
        stream.getTracks().forEach(track => connection.addTrack(track, stream));
        const dc = connection.createDataChannel("oai-events"); channel.current = dc;
        const offer = await connection.createOffer();
        if (token !== generation.current) throw new Error("Conversation stopped.");
        await connection.setLocalDescription(offer);
        return { connection, dc, offer };
      })()]);
      if (token !== generation.current) return;
      const { connection, dc, offer } = prepared;
      const output = new Audio(); output.autoplay = true; audio.current = output;
      connection.ontrack = event => { if (token !== generation.current) return; output.srcObject = event.streams[0]; void output.play().catch(() => { if (token === generation.current) setError("Use Play voice to allow GUD’s audio in this browser."); }); };
      seenCalls.current.clear();
      dc.onopen = () => { if (token === generation.current) {
        setVoice(true); setStatus("Listening"); lastActivity.current = Date.now();
        send({ type: "response.create", response: { tool_choice: "none", instructions: "Greet the user briefly: Hi, what are we working on? Then listen. Do not call tools or read CRM details aloud." } });
      } };
      const disconnected = () => { if (token === generation.current) { void endRef.current(); setError("Voice disconnected. Your drafts are safe. Reconnect or continue typing once the call has ended."); } };
      connection.onconnectionstatechange = () => { if (["failed", "disconnected", "closed"].includes(connection.connectionState)) disconnected(); };
      connection.oniceconnectionstatechange = () => { if (["failed", "disconnected", "closed"].includes(connection.iceConnectionState)) disconnected(); };
      media.current?.getAudioTracks().forEach(track => { track.onended = disconnected; });
      dc.onclose = () => { if (token === generation.current) { void endRef.current(); setError("Voice disconnected. Your drafts are safe."); } };
      dc.onmessage = event => {
        if (token !== generation.current) return;
        let value: Record<string, unknown>; try { value = JSON.parse(event.data); } catch { return; }
        if (value.type === "input_audio_buffer.speech_started") {
          if (reviewing.current || !media.current?.getAudioTracks().some(track => track.enabled && track.readyState !== "ended")) return;
          lastActivity.current = Date.now(); setStatus("Listening…");
          saveApproval.current.begin(String(value.item_id ?? ""), draftsRef.current.map(({ id, version }) => ({ id, version })));
          // Speaking again interrupts the sign-off, not just its audio.
          finishAfterAudio.current = false; signOffPlayback.current.reset();
          if (finishTimer.current) clearTimeout(finishTimer.current); finishTimer.current = null;
        }
        if (value.type === "response.created") { activeResponse.current = (value.response as { id?: string })?.id ?? null; setStatus("GUD is thinking…"); }
        if (value.type === "response.output_audio.delta" || value.type === "output_audio_buffer.started") setStatus("GUD is speaking…");
        if (value.type === "output_audio_buffer.stopped") setStatus(reviewing.current ? saved.current ? "All Gud · saved · microphone paused" : "Drafts ready · microphone paused" : media.current?.getAudioTracks().some(track => track.enabled && track.readyState !== "ended") ? "Listening" : "Microphone paused");
        if (signOffPlayback.current.observe(value)) { void endRef.current(); return; }
        if (value.type === "conversation.item.input_audio_transcription.completed" && typeof value.transcript === "string") {
          appendMessage("user", value.transcript);
          saveApproval.current.complete(String(value.item_id ?? ""), value.transcript);
        }
        if (value.type === "response.output_audio_transcript.done" && typeof value.transcript === "string") appendMessage("assistant", value.transcript);
        if (value.type === "error") {
          const detail = value.error as { code?: string; event_id?: string } | undefined;
          // A response can complete between our cancellation and the server receiving it.
          // Ignore only that known race, correlated to a cancellation we actually sent.
          const harmlessCancel = detail?.code === "response_cancel_not_active" && Boolean(detail.event_id && cancelEvents.current.delete(detail.event_id));
          if (!harmlessCancel) { setError("GUD couldn’t finish its spoken reply. Check the draft or save confirmation below; reconnect if needed."); setStatus("Voice reply interrupted · drafts are safe"); }
        }
        if (value.type === "response.done") {
          const responseId = (value.response as { id?: string })?.id;
          if (!responseId || responseId === activeResponse.current) activeResponse.current = null;
          if (!activeResponse.current && queuedResponse.current) { const next = queuedResponse.current; queuedResponse.current = null; send(next as { type: string }); }
          const response = value.response as { status?: string; output?: Array<{ type: string; name: string; arguments: string; call_id: string }>; usage?: { input_tokens: number; output_tokens: number } } | undefined;
          if (response?.usage) void api("usage", { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }, current.id).catch(() => {});
          if (response?.status && response.status !== "completed") return;
          const calls = response?.output?.filter(item => item.type === "function_call") ?? [];
          if (!calls.length) return;
          // A response already in flight must not change the review after Save.
          if (reviewing.current) {
            for (const call of calls.slice(0, 8)) {
              seenCalls.current.add(call.call_id);
              send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ error: "Not executed: the user is reviewing/saving. Wait until they resume the microphone." }) } });
            }
            return;
          }
          queue.current = queue.current.then(async () => {
            if (token !== generation.current || reviewing.current) return;
            lock(true); setStatus("Preparing your changes…");
            try {
              await flushEdits();
              for (const call of calls.slice(0, 8)) {
                if (token !== generation.current) return;
                if (seenCalls.current.has(call.call_id)) continue;
                seenCalls.current.add(call.call_id);
                let result: Result;
                try {
                  if (call.name === "save_changes" && protectedEditor()) throw new Error("Save or close the other editor first. Conversation drafts have not been saved.");
                  const approval = call.name === "save_changes" ? await saveApproval.current.wait() : undefined;
                  if (token !== generation.current) return;
                  result = await request("tool", { name: call.name, arguments: JSON.parse(call.arguments), context: context.current, ...(approval ? { approval } : {}) }, current.id);
                  if (token !== generation.current) return; applyEvents(result);
                  if (result.saved) saveApproval.current.reset();
                }
                catch (e) { if (token !== generation.current) return; result = { error: (e as Error).message }; setError(result.error!); }
                send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) } });
              }
              if (token !== generation.current) return;
              if (finishAfterAudio.current && !draftsRef.current.length) {
                const marker = crypto.randomUUID(); signOffPlayback.current.arm(marker);
                send({ type: "response.create", response: { metadata: { gud_finish: marker }, tool_choice: "none", instructions: "The user has finished and no unsaved drafts remain. Say exactly: All Gud." } });
                finishTimer.current = setTimeout(() => void endRef.current(), 15000);
              } else send({ type: "response.create" });
            } finally { lock(false); }
          }).catch(() => { lock(false); if (token === generation.current) setError("That action was interrupted. Review your drafts before retrying."); });
        }
      };
      if (token !== generation.current) return;
      const result = await request("voice", { sdp: offer.sdp, context: context.current, voice: selectedVoice, pace: preferencesRef.current.pace }, current.id);
      if (token !== generation.current) return;
      await connection.setRemoteDescription({ type: "answer", sdp: result.sdp! });
    } catch (e) { if (token === generation.current) { await end(); setError((e as Error).message || "Voice could not connect. Typing still works."); setStatus("Ready to type"); } }
    finally { if (token === generation.current) lock(false); }
  }
  useEffect(() => { startVoiceRef.current = startVoice; });
  async function end() {
    if (ending.current) return false;
    ending.current = true; setStopping(true); lock(true);
    const current = sessionRef.current;
    launchPending.current = false; disconnect(); setStatus("Microphone stopped · finishing up…");
    try {
      if (current) { await api("end", undefined, current.id); sessionRef.current = null; setSession(null); }
      // A tool may already have staged a private draft. Wait for it, then reload
      // authoritative drafts without applying its late navigation or speech.
      await loadPending.current; await Promise.allSettled([...pendingRequests.current]); await queue.current;
      const restored = await api("load"); draftsRef.current = restored.drafts ?? []; setDrafts(draftsRef.current);
      await flushEdits();
      reviewing.current = false; setStatus("Conversation ended");
      say(signOff(saved.current, draftsRef.current.length));
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { ending.current = false; setStopping(false); lock(false); }
  }
  useEffect(() => { endRef.current = async () => { await end(); }; });
  async function save() {
    if (busyRef.current) return;
    if (protectedEditor()) { setError("Save or close the other editor before applying your conversation drafts."); return; }
    lock(true); reviewing.current = true; setError(""); setStatus("Saving reviewed changes…");
    // Pause input while the user commits the visible review.
    media.current?.getAudioTracks().forEach(track => { track.enabled = false; }); setMuted(voice);
    cancelResponse();
    try {
      const reviewed = await flushEdits();
      const result = await request("save", reviewed.map(d => ({ id: d.id, version: d.version })));
      applyEvents(result); saved.current = true;
      const message = signOff(true, draftsRef.current.length);
      say(message, `The application confirms the reviewed changes were saved successfully. Say exactly: ${message}`);
      setStatus("All Gud · saved");
    } catch (e) { setError((e as Error).message); setStatus("Not saved · review needed"); }
    finally { lock(false); }
  }
  async function cancel(draft: GudDraft) {
    if (busyRef.current) return; lock(true); setError("");
    try { const result = await request("cancel", { id: draft.id, version: draft.version }); draftsRef.current = result.drafts ?? []; setDrafts(draftsRef.current); const next = { ...editsRef.current }; delete next[draft.id]; editsRef.current = next; setEdits(next); }
    catch (e) { setError((e as Error).message); } finally { lock(false); }
  }
  if (!open) return null;
  return createPortal(<aside className={`gud-conversation ${minimised ? "is-minimised" : ""}`} aria-label="GUD conversation preview">
    <header><div><strong>Talk to GUD</strong><small>Conversation preview</small></div><button type="button" className="icon-button" aria-label={minimised ? "Expand conversation" : "Minimise conversation"} onClick={() => setMinimised(!minimised)}><ChevronDown size={17} /></button><button type="button" className="icon-button" aria-label="Close conversation" onClick={() => { void end().then(ended => { if (ended) { loaded.current = false; setOpen(false); document.querySelector<HTMLButtonElement>(".workspace-voice-launch")?.focus(); } }); }} disabled={stopping || (busy && reviewing.current)}><X size={17} /></button></header>
    <div className="gud-conversation-status" role="status">{busy ? <LoaderCircle className="spin" size={15} /> : voice ? <Mic size={15} /> : <Check size={15} />}{status}{drafts.length ? <span>{drafts.length} unsaved</span> : null}</div>
    {!minimised ? <>
      <div className="gud-conversation-scroll">
        {!consent ? <div className="gud-conversation-intro"><p>Tell GUD what happened. It will find the right screen and prepare changes for you to review.</p><label><input type="checkbox" checked={consent} onChange={e => { updatePreferences({ consent: e.target.checked }); if (e.target.checked && launchPending.current) void startVoiceRef.current(); }} />Allow my conversation and relevant CRM details to be sent to OpenAI. Remember for my account on this browser.</label><small>{preferences.conversationFirst ? "Allowing this starts the conversation you just requested. Future clicks on Talk to GUD start voice directly." : "Voice uses my microphone only after I start it."} No CRM changes until you ask to save or click Save. Voice stops after 2 minutes idle or 10 minutes total. GUD’s voice is AI-generated. Change these choices in Options.</small></div> : null}
        {consent ? <details className="gud-privacy"><summary title="Your permission is remembered for this account on this browser. Click for details.">Voice & privacy · permission remembered</summary><p>Voice starts only when you ask. Your conversation and relevant CRM details go to OpenAI. GUD’s voice is AI-generated. Changes stay in draft until you ask GUD to save or click Save. The microphone stops after 2 minutes idle or 10 minutes total. Change or revoke permission in Options.</p></details> : null}
        {preferenceWarning ? <p className="form-error" role="alert">{preferenceWarning}</p> : null}
        {options ? <section className="gud-conversation-options" aria-label="Conversation options">
          <label className="gud-conversation-toggle"><input type="checkbox" checked={preferences.conversationFirst} onChange={e => updatePreferences({ conversationFirst: e.target.checked })} />Conversation first</label>
          <small>Start voice when you press Talk to GUD. Switch off to open the panel for typing first. Never starts on page load.</small>
          <label>Voice<select aria-label="GUD voice" value={preferences.voice} disabled={voice || busy} onChange={e => updatePreferences({ voice: e.target.value as VoicePreferences["voice"] })}>{gudVoices.map(name => <option key={name} value={name}>{name[0].toUpperCase() + name.slice(1)}{name === "marin" ? " · default" : ""}</option>)}</select></label>
          <small>{voice ? "End the conversation to change voice." : "Used for your next conversation."} Options are saved for your account on this browser.</small>
          <label>Response pace<select aria-label="Response pace" value={preferences.pace} disabled={voice || busy} onChange={e => updatePreferences({ pace: e.target.value as VoicePreferences["pace"] })}><option value="quick">Quick</option><option value="relaxed">Relaxed</option></select></label><small>Quick responds sooner. Choose Relaxed if you like more time to pause and think. Applies to your next conversation.</small>
          {consent ? <button type="button" className="gud-classic" disabled={voice || busy} onClick={() => updatePreferences({ consent: false })}>Ask my permission again next time</button> : null}
        </section> : null}
        {messages.length ? <div className="gud-conversation-messages" aria-live="polite">{messages.slice(-2).map((message, i) => <p key={`${messages.length}-${i}`} data-role={message.role}><small>{message.role === "user" ? "You" : "GUD"}</small>{message.content}</p>)}{messages.length > 2 ? <details><summary>Conversation history</summary>{messages.slice(0, -2).map((m, i) => <p key={i}><small>{m.role === "user" ? "You" : "GUD"}</small>{m.content}</p>)}</details> : null}</div> : null}
        {drafts.map(draft => <DraftCard key={draft.id} draft={draft} fields={{ ...draft.fields, ...edits[draft.id] }} references={references} busy={busy} onEdit={(key, value) => { editsRef.current = { ...editsRef.current, [draft.id]: { ...editsRef.current[draft.id], [key]: value } }; setEdits(editsRef.current); }} onCancel={() => void cancel(draft)} />)}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
      <footer>
        {drafts.length ? <button type="button" className="btn btn-primary gud-save" onClick={() => void save()} disabled={busy}>Save {drafts.length === 1 ? "changes" : `all ${drafts.length} drafts`}</button> : null}
        <form onSubmit={event => { event.preventDefault(); void submitText(); }}><textarea aria-label="Message GUD" placeholder="What are you working on?" maxLength={12000} value={text} onChange={e => setText(e.target.value)} disabled={busy || voice} rows={2} /><button type="submit" className="icon-button" aria-label="Send message to GUD" disabled={!text.trim() || busy || !consent || voice}><Send size={17} /></button></form>
        <div className="gud-conversation-controls">{!voice ? <button type="button" className="btn btn-voice" onClick={() => void startVoice()} disabled={busy || !consent}><Mic size={15} />Start conversation</button> : <><button type="button" className="btn btn-quiet" disabled={busy} onClick={() => { media.current?.getAudioTracks().forEach(track => { track.enabled = muted; }); if (muted) reviewing.current = false; setMuted(!muted); setStatus(muted ? "Listening" : "Microphone paused"); }}><MicOff size={15} />{muted ? "Resume mic" : "Mute"}</button><button type="button" className="btn btn-quiet" onClick={() => void audio.current?.play()}>Play voice</button></>}{session || busy ? <button type="button" className="btn btn-quiet" onClick={() => void end()} disabled={stopping || (busy && reviewing.current)}><Square size={13} />End</button> : null}</div>
        <div className="gud-conversation-links"><button className="gud-classic" type="button" disabled={voice || busy} onClick={() => { void end().then(ended => { if (ended) { loaded.current = false; setOpen(false); onClassic(); } }); }}>Use classic voice review</button><button type="button" className="gud-options-button" aria-expanded={options} onClick={() => setOptions(!options)}><Settings2 size={14} />Options</button></div>
      </footer>
    </> : null}
  </aside>, document.body);
}

const fieldLabels: Partial<Record<keyof GudFields, string>> = { company: "Company", title: "Title", contact: "Contact name", value: "Value (£)", note: "Append note", task: "Follow-up task", dueDate: "Due date", dueTime: "Time", body: "Private thought", category: "Category", colour: "Note colour", priority: "Priority", temperature: "Temperature", probability: "Probability (%)", expectedCloseDate: "Expected close", outreachAngle: "Outreach angle", fitScore: "Company fit (1–5)", qualificationNote: "Qualification note", contactEmail: "Contact email", contactPhone: "Contact phone", contactTitle: "Contact role", activityOutcome: "Activity outcome", occurredAt: "Activity time (ISO with time zone)", nextMilestone: "Next milestone" };
function DraftCard({ draft, fields, references, busy, onEdit, onCancel }: { draft: GudDraft; fields: EditableFields; references: References | null; busy: boolean; onEdit: (key: keyof GudFields, value: unknown) => void; onCancel: () => void }) {
  const keys: Array<keyof GudFields> = draft.kind === "thought" ? ["title", "body"] : draft.kind === "lead" ? [...(!draft.targetId ? ["company", "title", "contact"] as const : fields.title !== undefined ? ["title"] as const : []), ...(fields.value !== undefined ? ["value"] as const : []), "note", "task", ...(fields.task ? ["dueDate", "dueTime"] as const : [])] : [...(!draft.targetId || fields.company !== undefined ? ["company"] as const : []), ...(!draft.targetId || fields.title !== undefined ? ["title"] as const : []), ...(fields.value !== undefined ? ["value"] as const : []), "note", "task", ...(fields.dueDate ? ["dueDate"] as const : [])];
  for (const key of Object.keys(fieldLabels) as Array<keyof GudFields>) if (fields[key] !== undefined && !keys.includes(key)) keys.push(key);
  const choices: Partial<Record<keyof GudFields, string[]>> = { colour: ["butter", "rose", "sage", "sky", "lilac", "peach"], priority: ["low", "medium", "high", "critical"], temperature: ["cold", "warm", "hot", "at_risk", "unresponsive"] };
  return <section className="gud-draft" aria-label={`Draft ${draft.label}`}><div className="gud-draft-heading"><span>Draft · {draft.kind === "thought" ? "private" : draft.kind}</span><button type="button" aria-label={`Cancel draft ${draft.label}`} className="icon-button" onClick={onCancel} disabled={busy}><X size={14} /></button></div><strong>{draft.label}</strong>
    {keys.map(key => <label key={key}>{key === "task" && draft.kind === "project" ? "Add to project list" : key === "dueDate" && draft.kind === "project" ? "Project milestone date" : fieldLabels[key]}{choices[key] ? <select aria-label={fieldLabels[key]} value={String(fields[key] ?? "")} onChange={e => onEdit(key, e.target.value)} disabled={busy}>{choices[key]!.map(option => <option key={option} value={option}>{option}</option>)}</select> : key === "note" || key === "body" || key === "outreachAngle" || key === "qualificationNote" ? <textarea aria-label={fieldLabels[key]} rows={key === "body" ? 4 : 2} maxLength={key === "body" ? 20000 : 5000} value={String(fields[key] ?? "")} onChange={e => onEdit(key, e.target.value)} disabled={busy} /> : <input aria-label={fieldLabels[key]} type={["value", "probability", "fitScore"].includes(key) ? "number" : key === "dueDate" || key === "expectedCloseDate" ? "date" : key === "dueTime" ? "time" : "text"} min={key === "value" ? "0" : undefined} step={key === "value" ? "0.01" : undefined} value={String(fields[key] ?? "")} onChange={e => onEdit(key, ["value", "probability", "fitScore"].includes(key) && e.target.value !== "" ? Number(e.target.value) : e.target.value)} disabled={busy} />}</label>)}
    {fields.addTasks ? <label>Add checklist items<textarea aria-label="Add checklist items" value={fields.addTasks.join("\n")} onChange={e => onEdit("addTasks", e.target.value.split("\n"))} disabled={busy} /><small>One task per line</small></label> : null}
    {fields.ownerId !== undefined ? <label>Owner<select aria-label="Draft owner" value={fields.ownerId} onChange={e => onEdit("ownerId", e.target.value)} disabled={busy}>{references?.owners?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label> : null}
    {fields.activityTypeId !== undefined ? <label>Activity type<select aria-label="Draft activity type" value={fields.activityTypeId} onChange={e => onEdit("activityTypeId", e.target.value)} disabled={busy}>{references?.activityTypes?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label> : null}
{draft.kind !== "thought" && (!draft.targetId || fields.offerId) ? <label>Offer<select aria-label="Draft offer" value={fields.offerId ?? ""} onChange={e => onEdit("offerId", e.target.value)} disabled={busy}><option value="">Choose offer</option>{references?.offers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label> : null}
    {draft.kind !== "thought" && (fields.stageId || !draft.targetId) ? <label>Stage<select aria-label="Draft stage" value={fields.stageId ?? ""} onChange={e => onEdit("stageId", e.target.value)} disabled={busy}><option value="">Choose stage</option>{(draft.kind === "lead" ? references?.stages : references?.projectStages)?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label> : null}
    {fields.completeTaskIds?.length ? <div><small>Mark complete</small>{fields.completeTaskIds.map(id => <p key={id}><Check size={13} />{draft.taskOptions?.find(t => t.id === id)?.title ?? "Selected task"}</p>)}</div> : null}
    {fields.dueTime ? <small>Time zone: {draft.timezone}</small> : null}
    {draft.warnings.map(w => <small className="gud-draft-warning" key={w}>{w}</small>)}
    <small>Nothing changes in the CRM until you save.</small>
  </section>;
}
