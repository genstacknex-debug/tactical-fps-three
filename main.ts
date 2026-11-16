//
// Submission entry point for the three.js FPS (Node 22, standard library only).
//
// The browser game lives in game/ and its preview images in screenshots/, both alongside this
// file. Packaging does three things:
//   1. pick the output folder (/output for the grader, or MAKEFUN_OUTPUT_DIR when set),
//   2. stage game/ and screenshots/ into that folder,
//   3. write dossier.json there via the bundled make.fun helper.
//
// Run it without any build step:
//   node main.ts
//
// Locally, point the output somewhere writable and/or preview with the dev server:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//   node serve.ts            # http://localhost:8080
//

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// Resolve inputs next to this script rather than relative to the process's working directory.
const repositoryDir = fileURLToPath(new URL('.', import.meta.url));

// The grader expects /output; MAKEFUN_OUTPUT_DIR lets us run outside its container.
const dropDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const sources = {
  game: join(repositoryDir, 'game'),
  screenshots: join(repositoryDir, 'screenshots'),
};

const destinations = {
  game: join(dropDir, 'game'),
  screenshots: join(dropDir, 'screenshots'),
};

// Make sure the output root exists before staging anything into it.
mkdirSync(dropDir, { recursive: true });

// The game directory is required; if it is missing, copying fails and the run should fail too.
cpSync(sources.game, destinations.game, { recursive: true });

// Screenshots are optional: create the destination, then copy only when there is something to copy.
mkdirSync(destinations.screenshots, { recursive: true });
if (existsSync(sources.screenshots)) {
  cpSync(sources.screenshots, destinations.screenshots, { recursive: true });
}

// These caps are the scorer's own gate. They shape hashing (text) and prevent us from handing in a
// payload the scorer would refuse (too many screenshots or bytes, too many game files or bytes).
const dossierLimits = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

const dossier = buildDossier(dropDir, dossierLimits);
writeFileSync(join(dropDir, 'dossier.json'), dossier);
