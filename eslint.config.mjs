// Lint: recomendações do JavaScript e do TypeScript, mais as regras de hooks do React (dependências
// esquecidas em useEffect/useCallback/useMemo e hooks chamados fora de ordem). Sem regras de estilo:
// a formatação segue o código existente.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/**', 'release/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,mjs,cjs,js}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Parâmetros e variáveis começados com _ são ignorados de propósito.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // CommonJS de verdade (scripts .cjs): require é o jeito certo de importar aqui.
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
