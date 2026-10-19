// src/core/ must run unchanged on a game server: no Three.js, no browser APIs, no hidden randomness.
import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const dir = new URL('../src/core/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.js'));

test.each(files)('core/%s imports only other core modules and uses no browser APIs', file => {
  const code = readFileSync(new URL(file, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const [, from] of code.matchAll(/^import .* from '([^']+)';/gm)) expect(from).toMatch(/^\.\/[\w-]+\.js$/);
  expect(code).not.toMatch(/\b(THREE|window|document|localStorage|sessionStorage|navigator|performance|requestAnimationFrame|setTimeout)\b/);
  // randomness is passed in (see launchShot), so a seeded run is repeatable
  expect(code).not.toMatch(/Math\.random/);
});
