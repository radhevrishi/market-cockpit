// zzz883 — ESLint 9 flat config (Next 16 removed `next lint`). Run: npm run lint. Not a CI gate yet (the code base has old
// warnings); new code should be lint-clean.
import next from 'eslint-config-next';
export default [
  ...(Array.isArray(next) ? next : [next]),
  { ignores: ['.next/**', 'node_modules/**', 'public/**', 'scripts/**', 'src/lib/__tests__/fixtures/**'] },
];
