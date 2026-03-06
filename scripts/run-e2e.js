const { spawnSync } = require('node:child_process');

let hasPlaywright = true;
try {
  require.resolve('@playwright/test');
} catch {
  hasPlaywright = false;
}

if (!hasPlaywright) {
  console.log('Skipping e2e tests: @playwright/test is not installed.');
  process.exit(0);
}

if (!process.env.E2E_BASE_URL && !process.env.DATABASE_URL) {
  console.log(
    'Skipping e2e tests: set E2E_BASE_URL to an existing server or set DATABASE_URL to start local webServer.'
  );
  process.exit(0);
}

const result = spawnSync(
  'npx',
  ['playwright', 'test', '--config=playwright.config.js', 'e2e/comment-summary-modal.spec.js'],
  {
  stdio: 'inherit',
  shell: true,
  }
);

process.exit(result.status ?? 1);
