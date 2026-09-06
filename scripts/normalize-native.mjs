import { readFile, writeFile } from 'node:fs/promises';
const file = 'apps/mobile/ios/App/CapApp-SPM/Package.swift';
const source = await readFile(file, 'utf8');
// Capacitor on Windows can emit backslashes in Swift local package paths.
const normalized = source.replace(
  /(path:\s*")([^"]+)(")/g,
  (_, before, path, after) => before + path.replaceAll('\\', '/') + after,
);
await writeFile(file, normalized.replaceAll('\r\n', '\n'));
