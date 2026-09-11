// Generate the four exterior moodboard images (garden pilot G1b).
//
// The interior 24 were generated once and copied into public/moodboards/ as
// `<style-key>-<room>.png`, 1024x1024 PNG. These are the same asset in the same
// place with the same naming, so loadMoodboardDataUri finds them with no
// special case — two exterior directions x two segments (garden, structure).
//
// Idempotent: a file that already exists is left alone. Pass --force to redraw.
//
//   REPLICATE_API_TOKEN=... node scripts/generate-garden-moodboards.mjs
//
// Not wired into any build. Moodboard art is a one-off asset, and regenerating
// it on every deploy would quietly change what every garden render is grounded
// against.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "public", "moodboards");
const MODEL = "black-forest-labs/flux-1.1-pro";
const FORCE = process.argv.includes("--force");

function loadEnv() {
  if (process.env.REPLICATE_API_TOKEN) return process.env.REPLICATE_API_TOKEN;
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
      if (line.trim().startsWith("#") || !line.includes("=")) continue;
      const k = line.slice(0, line.indexOf("=")).trim();
      if (k === "REPLICATE_API_TOKEN") return line.slice(line.indexOf("=") + 1).trim();
    }
  } catch {
    /* no .env.local */
  }
  return null;
}

// A moodboard is a MATERIAL reference, not a scene: it is handed to the edit
// model alongside the room being restyled, so anything architectural in it
// competes with the real geometry. These read as flat-lay boards for that
// reason — the interior 24 do the same.
const BOARDS = [
  {
    file: "desert-modern-garden.png",
    prompt:
      "Landscape design moodboard flat lay, overhead, on warm off-white paper. Samples of large-format honed buff sandstone paving, a swatch of clipped fine lawn, weathered corten steel sheet, pale limestone gravel, a sprig of blue agave and architectural grass, a brushed bronze light fitting. Muted buff, sage green and warm grey palette. Soft even daylight, editorial composition, no text, no labels, no people, no rendering of a building.",
  },
  {
    file: "desert-modern-structure.png",
    prompt:
      "Landscape structure moodboard flat lay, overhead, on warm off-white paper. Samples of smoked oak slat batten, powder-coated dark bronze steel section, woven outdoor rope, pale limestone, a fragment of tensioned cream shade fabric, a recessed bronze uplight. Muted buff, charcoal and sage palette. Soft even daylight, editorial composition, no text, no labels, no people, no rendering of a building.",
  },
  {
    file: "courtyard-majlis-garden.png",
    prompt:
      "Gulf courtyard garden moodboard flat lay, overhead, on warm sand-coloured paper. Samples of patterned encaustic cement tile in ochre and deep green, honed limestone border, lime-rendered wall fragment, a hammered brass water spout, date palm frond, terracotta pot shard, a woven cushion in ochre and burgundy. Warm ochre, brass, deep green and terracotta palette. Soft even daylight, editorial composition, no text, no labels, no people, no rendering of a building.",
  },
  {
    file: "courtyard-majlis-structure.png",
    prompt:
      "Gulf pergola and majlis moodboard flat lay, overhead, on warm sand-coloured paper. Samples of rough-sawn timber beam, carved mashrabiya lattice fragment, woven palm-frond shading, burgundy and ochre floor cushion fabric, brass lantern, patterned cement tile, natural jute rope. Warm ochre, timber brown, brass and deep red palette. Soft even daylight, editorial composition, no text, no labels, no people, no rendering of a building.",
  },
];

const urlFrom = (out) => {
  if (typeof out === "string") return out;
  if (Array.isArray(out)) return urlFrom(out[0]);
  if (out && typeof out === "object") {
    if (typeof out.url === "function") return out.url().toString();
    if (typeof out.url === "string") return out.url;
  }
  throw new Error(`Unexpected Replicate output: ${JSON.stringify(out).slice(0, 200)}`);
};

const main = async () => {
  const token = loadEnv();
  if (!token) {
    console.error("REPLICATE_API_TOKEN is not set (env or .env.local).");
    process.exit(1);
  }
  const { default: Replicate } = await import("replicate");
  const replicate = new Replicate({ auth: token });

  for (const board of BOARDS) {
    const dest = join(OUT_DIR, board.file);
    if (existsSync(dest) && !FORCE) {
      console.log(`skip  ${board.file} (exists — pass --force to redraw)`);
      continue;
    }
    process.stdout.write(`draw  ${board.file} … `);
    const output = await replicate.run(MODEL, {
      input: {
        prompt: board.prompt,
        aspect_ratio: "1:1",
        output_format: "png",
        safety_tolerance: 2,
        prompt_upsampling: false,
      },
    });
    const res = await fetch(urlFrom(output));
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, bytes);
    const w = bytes.readUInt32BE(16);
    const h = bytes.readUInt32BE(20);
    console.log(`${w}x${h}, ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
  }
  console.log("done");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
