#!/usr/bin/env node
//
// Generate public/manifest.json FROM THE BRAND DESCRIPTOR.
//
// The PWA manifest used to be a hand-written file with the brand name and theme
// colour typed into it -- a second, silently-drifting copy of the identity the
// brand slot already owns. It is now derived: the descriptor is the only place
// the brand name and theme colour live, and tests/unit/single-source-brand.test.js
// asserts the committed file is exactly this generator's output.
//
//     node scripts/gen-manifest.mjs [--check]     # --check: verify, do not write
//
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, readDescriptors } from './overlay-contract.mjs';

export const MANIFEST_PATH = path.join(REPO_ROOT, 'public', 'manifest.json');

/** The manifest for a descriptor, byte-stable (2-space JSON + trailing newline). */
export const generateManifest = (descriptor) => ({
  short_name: descriptor.name,
  name: descriptor.name,
  icons: [{ src: 'favicon.ico', sizes: '72x72', type: 'image/x-icon' }],
  start_url: '.',
  display: 'standalone',
  theme_color: descriptor.themeColor,
  background_color: '#ffffff',
});

export const serialize = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

const main = () => {
  const descriptors = readDescriptors();
  if (descriptors.length !== 1) {
    console.error(`FATAL: exactly one descriptor must ship, found ${descriptors.length}`);
    process.exit(1);
  }
  const wanted = serialize(generateManifest(descriptors[0].descriptor));
  const checkOnly = process.argv.includes('--check');
  const current = readFileSync(MANIFEST_PATH, 'utf8');

  if (current === wanted) {
    console.log('manifest.json is up to date with the descriptor.');
    return;
  }
  if (checkOnly) {
    console.error('FATAL: public/manifest.json does not match the brand descriptor.');
    console.error('       run: node scripts/gen-manifest.mjs');
    process.exit(1);
  }
  writeFileSync(MANIFEST_PATH, wanted);
  console.log('manifest.json regenerated from the brand descriptor.');
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
