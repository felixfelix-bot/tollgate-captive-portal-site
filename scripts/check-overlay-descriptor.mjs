#!/usr/bin/env node
//
// Dependency-free pre-flight for the brand overlay. Runs the shared contract in
// scripts/overlay-contract.mjs and prints one line per rule, so the build fails
// BEFORE cloning npm-installing upstream if the overlay cannot satisfy the slot.
//
//     node scripts/check-overlay-descriptor.mjs      # exit 1 on any failure
//
import { validateOverlay } from './overlay-contract.mjs';

const { failures, descriptors } = validateOverlay();

for (const { file, id, descriptor } of descriptors) {
  console.log(`ok   ${file}: id="${descriptor.id}" name="${descriptor.name}" themeColor="${descriptor.themeColor}"`);
}
for (const id of descriptors.map((d) => d.id)) console.log(`ok   overlay descriptor id: ${id}`);
console.log(`ok   ${descriptors.length} descriptor(s) in the slot`);

if (failures.length) {
  console.error(`\nFAILED ${failures.length} overlay contract check(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nPASS: overlay contract holds.');
