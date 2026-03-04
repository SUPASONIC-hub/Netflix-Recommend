const { test, expect } = require('@playwright/test');

test('comment summary modal opens and has navigable items', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: '댓글 현황 열기' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#commentSummarySort')).toBeVisible();

  const firstItem = page.locator('#commentSummaryList [data-comment-item]').first();
  if (await firstItem.count()) {
    await firstItem.click();
    await expect(page).toHaveURL(/\/content\//);
  }
});
