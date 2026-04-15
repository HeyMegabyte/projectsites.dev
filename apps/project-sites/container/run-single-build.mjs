#!/usr/bin/env node
/**
 * Run a single build through the local agent and wait for completion.
 * Usage: node run-single-build.mjs <category-index>
 *   0 = Nobu (Restaurant)
 *   1 = Vito's (Salon)
 *   2 = Cravath (Legal)
 *   3 = Mayo Clinic (Medical)
 *   4 = Linear (Tech)
 *   5 = Equinox (Fitness)
 *   6 = Compass (Real Estate)
 *   7 = Suffolk (Construction)
 *   8 = Annie Leibovitz (Photography)
 *   9 = White House (Other)
 */

import { BUILDS } from './run-all-categories.mjs';

const index = parseInt(process.argv[2] || '0', 10);
if (index < 0 || index >= BUILDS.length) {
  console.error(`Invalid index: ${index}. Must be 0-${BUILDS.length - 1}`);
  process.exit(1);
}

const build = BUILDS[index];
console.log(`Building: ${build.businessName} (${build.slug})`);
console.log(`Category: ${build.researchData.profile.business_type}`);

const res = await fetch('http://localhost:4400/build', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(build),
});
console.log(`Dispatched: ${await res.text()}`);
console.log(`Monitor the local agent terminal for progress.`);
