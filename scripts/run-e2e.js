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

const result = spawnSync('npx', ['playwright', 'test', 'e2e/comment-summary-modal.spec.js'], {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
