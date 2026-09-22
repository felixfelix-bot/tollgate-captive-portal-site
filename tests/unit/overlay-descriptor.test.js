// Contract tests for the brand overlay this repo contributes to the upstream
// theme layer. The overlay is the ONLY branding this repo owns; if it drifts
// from the upstream slot contract, a branded build silently falls back to the
// generic default skin -- a branded manifest and icon with a generic UI.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  ASSET_DIR, BRAND_DIR, ID_ALPHABET, SLOT_ASSETS,
  isPng, readDescriptors, validateDescriptor,
} from '../../scripts/overlay-contract.mjs';

const descriptors = readDescriptors();

describe('brand overlay: descriptor', () => {
  it('ships exactly one descriptor (one build ships one skin)', () => {
    expect(descriptors.map((d) => d.file)).toHaveLength(1);
  });

  it('satisfies the upstream descriptor contract', () => {
    for (const entry of descriptors) {
      expect(validateDescriptor(entry), `${entry.file} contract failures`).toEqual([]);
    }
  });

  it('names the descriptor file after the descriptor id', () => {
    for (const { file, id, descriptor } of descriptors) {
      expect(file.toLowerCase()).toBe(`${id}.json`);
      expect(String(descriptor.id).toLowerCase()).toBe(id);
      expect(descriptor.id).toMatch(ID_ALPHABET);
    }
  });

  it('declares the session storage keys the upstream portal reads', () => {
    for (const { descriptor } of descriptors) {
      expect(descriptor.sessionKey.startsWith(descriptor.id)).toBe(true);
      expect(descriptor.sessionUser.startsWith(descriptor.id)).toBe(true);
    }
  });
});

describe('brand overlay: asset slot', () => {
  it('carries exactly the four slot files, all present and non-empty', () => {
    const present = readdirSync(ASSET_DIR).sort();
    expect(present).toEqual([...SLOT_ASSETS].sort());
    for (const asset of SLOT_ASSETS) {
      const p = path.join(ASSET_DIR, asset);
      expect(existsSync(p)).toBe(true);
      expect(statSync(p).size).toBeGreaterThan(0);
    }
  });

  it('carries real PNG files, not renamed placeholders', () => {
    for (const asset of SLOT_ASSETS) expect(isPng(path.join(ASSET_DIR, asset)), asset).toBe(true);
  });

  it('keeps the brand slot directory free of stray descriptors', () => {
    expect(readdirSync(BRAND_DIR).filter((f) => !f.toLowerCase().endsWith('.json'))).toEqual([]);
  });
});
