type PositionedThought = { x: number; y: number; archived: boolean };

/** Same generous spacing for UI, voice and batch-created notes. Never moves existing notes. */
export function nextThoughtPosition(notes: PositionedThought[], origin = { x: 32, y: 32 }, columns = 3) {
  const left = Math.min(9000, Math.max(0, origin.x));
  const top = Math.min(9000, Math.max(0, origin.y));
  const occupied = notes.filter(note => !note.archived);
  const fits = (x: number, y: number) => !occupied.some(note => Math.abs(note.x - x) < 310 && Math.abs(note.y - y) < 400);
  const lanes = Math.max(1, Math.min(25, columns));
  for (let index = 0; index < 625; index++) {
    const x = left + (index % lanes) * 330, y = top + Math.floor(index / lanes) * 420;
    if (x <= 10000 && y <= 10000 && fits(x, y)) return { x, y };
  }
  // A crowded/scrolled area may be full. Try the rest of the board before giving up.
  for (let y = 32; y <= 10000; y += 420) for (let x = 32; x <= 10000; x += 330) if (fits(x, y)) return { x, y };
  throw new Error("This board is full. Archive a few thoughts before adding more.");
}
