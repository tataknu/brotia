/**
 * Node-only test helper: loads the normative contract fixtures (contracts/v1/fixtures/*.json).
 * Import it from *.test.ts files only (it uses node:fs; never import it from app code).
 *
 *   const portfolio = loadFixture<Portfolio>('portfolio-sample.json');
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const CONTRACT_DIR = fileURLToPath(new URL('../../../../contracts/v1/', import.meta.url));
export const FIXTURES_DIR = join(CONTRACT_DIR, 'fixtures');

export function fixtureNames(): string[] {
  return readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json')).sort();
}

export function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as T;
}
