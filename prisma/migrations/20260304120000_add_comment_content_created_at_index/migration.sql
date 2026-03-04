-- Improve comment summary aggregation and latest-comment lookup
CREATE INDEX "Comment_contentId_createdAt_idx" ON "Comment"("contentId", "createdAt");
