export type PositionedThought = { x: number; y: number; archived: boolean; height?: number; title?: string; body?: string; checklist?: unknown[] };

export const thoughtCardHeight = (note: PositionedThought) => note.height ?? (note.body !== undefined ? Math.min(440, 110 + Math.ceil(note.body.length / 34) * 20 + Math.min(3, note.checklist?.length ?? 0) * 24 + (note.title ? 28 : 0)) : 400);

/** Same generous spacing for UI, voice and batch-created notes. Never moves existing notes. */
export function nextThoughtPosition(notes: PositionedThought[], origin = { x: 32, y: 32 }, columns = 3) {
  const left = Math.min(9000, Math.max(0, origin.x));
  const top = Math.min(9000, Math.max(0, origin.y));
  const occupied = notes.filter(note => !note.archived);
  const noteHeight = thoughtCardHeight;
  const fits = (x: number, y: number) => !occupied.some(note => x < note.x + 310 && x + 310 > note.x && y < note.y + noteHeight(note) + 20 && y + 200 > note.y);
  const lanes = Math.max(1, Math.min(25, columns));
  // Try the actual bottom edges first, not a fixed 420px grid. Short notes no
  // longer reserve a tall empty row; measured client heights handle wrapping.
  const rows = [...new Set([top, ...occupied.map(note => note.y + noteHeight(note) + 20)])].filter(y => y >= top && y <= 10000).sort((a, b) => a - b);
  for (const y of rows) for (let lane = 0; lane < lanes; lane++) {
    const x = left + lane * 330;
    if (x <= 10000 && fits(x, y)) return { x, y };
  }
  for (let index = 0; index < 625; index++) {
    const x = left + (index % lanes) * 330, y = top + Math.floor(index / lanes) * 420;
    if (x <= 10000 && y <= 10000 && fits(x, y)) return { x, y };
  }
  // A crowded/scrolled area may be full. Try the rest of the board before giving up.
  for (let y = 32; y <= 10000; y += 420) for (let x = 32; x <= 10000; x += 330) if (fits(x, y)) return { x, y };
  throw new Error("This board is full. Archive a few thoughts before adding more.");
}
