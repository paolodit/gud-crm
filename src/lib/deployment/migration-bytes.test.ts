import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Verified against all three production ledgers on 2026-09-16. These historical
// files were deployed with CRLF. Never rewrite the ledgers to fit a new archive.
const deployed = {
  "0000_lowly_ultron": "840eaa6cc4a3f4bfb55187bca83d15a091a8f28c66737722631f784f653a7936",
  "0001_auth_admin": "77c77752ca5191a3d0f61aae4315e9a8dc7b7e7862a87d33b3bd66e3703f38db",
  "0002_charming_morlun": "41576897cc18701d4996e22b6e1e243bcd90f90b677b2c492cfd61bf66d64a24",
  "0003_black_molly_hayes": "a32d23d7ee76234bc0071c0d3413cee2b1be406b333f59aa8c2030d8b181e7f3",
  "0004_ordered_opportunities": "39ff1ffb61db753e4faa8ef2ed77a822683b774e12e797e350d69ea2da83e0d5",
  "0005_research_themes": "e831f5b4c6b30497f4f026045c8021bc3db698cf4926c9ba666ece2fa158dc1a",
  "0006_mature_vivisector": "d7ceebca88ad47871227d140ebfdf463cfb4e0c492633d30f093c078155482dc",
  "0007_pretty_blindfold": "e4408508d52bc9de5c0bfe1c554ceb79ea907d6963916e9ebf4081d3c711d377",
  "0008_simpler_sales_stages": "e2c4b8d1182fade8e3791330345828a46fde6c37e816642226cc1c05f346c6c9",
  "0009_archive_records": "1080a0717fcd529137da791566bf7193a5961ec1ed25af78ae9a2333de4d1fcc",
  "0010_live_delivery": "1c6dff20d83825e39a383d7f526d743632616e68c5682f5d1ce2d33879fd4138",
};

it.each(Object.entries(deployed))("preserves deployed migration bytes: %s", (name, hash) => {
  expect(createHash("sha256").update(readFileSync(`drizzle/${name}.sql`)).digest("hex")).toBe(hash);
});
