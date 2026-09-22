#!/usr/bin/env node
//
// Shared contract for the brand overlay this repo contributes to the upstream
// theme layer (upstream contract: admin/brand/README.md).
//
// The overlay must satisfy that contract, or a branded build silently falls back
// to the generic default skin -- which is exactly the failure this repo must
// never ship. `scripts/check-overlay-descriptor.mjs` (build pre-flight) and
// `tests/unit/overlay-descriptor.test.js` (CI) both call in here so the contract
// is written down exactly once.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BRAND_DIR = path.join(REPO_ROOT, 'overlay', 'brand');
export const ASSET_DIR = path.join(REPO_ROOT, 'overlay', 'assets');

// Mirrors upstream admin/src/brand-core.ts (REQUIRED_DESCRIPTOR_FIELDS).
export const REQUIRED_FIELDS = [
  'id', 'name', 'domain', 'tagline', 'poweredBy',
  'website', 'version', 'themeColor', 'sessionKey', 'sessionUser',
];
// Mirrors upstream scripts/brand-id.mjs.
export const ID_ALPHABET = /^[a-z0-9][a-z0-9._-]*$/;
// The files the upstream slot expects under
// admin/public/assets/brand/<id>/ (path convention derived from the id).
export const SLOT_ASSETS = ['logo-colour.png', 'logo-white.png', 'icon-colour.png', 'icon-white.png'];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const isPng = (file) => {
  const head = readFileSync(file).subarray(0, 8);
  return head.equals(PNG_MAGIC);
};

/** Every descriptor in the slot, with the id the file name implies. */
export const readDescriptors = (brandDir = BRAND_DIR) => {
  if (!existsSync(brandDir)) return [];
  return readdirSync(brandDir)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .map((file) => {
      const descriptor = JSON.parse(readFileSync(path.join(brandDir, file), 'utf8'));
      return { file, id: file.replace(/\.json$/i, '').toLowerCase(), descriptor };
    });
};

/** Contract failures for one descriptor + its asset slot ([] == valid). */
export const validateDescriptor = (entry, { assetDir = ASSET_DIR, slotAssets = SLOT_ASSETS } = {}) => {
  const { file, id, descriptor } = entry;
  const failures = [];

  for (const field of REQUIRED_FIELDS) {
    const value = descriptor[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      failures.push(`${file}: ${field} must be a non-empty string`);
    }
  }
  if (String(descriptor.id || '').toLowerCase() !== id) {
    failures.push(`${file}: id ("${descriptor.id}") must match the file name case-insensitively (expected "${id}")`);
  }
  if (!ID_ALPHABET.test(String(descriptor.id || ''))) {
    failures.push(`${file}: id must be inside the upstream alphabet ${ID_ALPHABET}`);
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(String(descriptor.themeColor || ''))) {
    failures.push(`${file}: themeColor ("${descriptor.themeColor}") must be a 6-digit hex colour`);
  }
  if (!/^https?:\/\//.test(String(descriptor.website || ''))) {
    failures.push(`${file}: website ("${descriptor.website}") must be an absolute http(s) URL`);
  }
  if (String(descriptor.sessionKey || '').toLowerCase() === String(descriptor.sessionUser || '').toLowerCase()) {
    failures.push(`${file}: sessionKey and sessionUser must differ (the upstream migration depends on it)`);
  }

  for (const asset of slotAssets) {
    const p = path.join(assetDir, asset);
    if (!existsSync(p) || statSync(p).size === 0) {
      failures.push(`${file}: logo/icon slot file overlay/assets/${asset} is missing or empty`);
    } else if (!isPng(p)) {
      failures.push(`${file}: overlay/assets/${asset} does not start with the PNG magic bytes`);
    }
  }
  return failures;
};

/** Whole-overlay verdict: { failures: string[], descriptors: [...] }. */
export const validateOverlay = () => {
  const descriptors = readDescriptors();
  const failures = validateDescriptor === undefined ? [] : [];
  if (descriptors.length !== 1) {
    failures.push(`exactly one descriptor must ship (one build ships one skin) -- found: ${descriptors.map((d) => d.file).join(', ') || 'none'}`);
  }
  for (const entry of descriptors) failures.push(...validateDescriptor(entry));
  return { failures, descriptors };
};
