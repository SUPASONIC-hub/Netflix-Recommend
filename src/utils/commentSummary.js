function toTimestamp(value) {
  return new Date(value || 0).getTime();
}

function sortCommentSummaryItems(items, sortBy = 'count') {
  const normalized = Array.isArray(items) ? [...items] : [];
  normalized.sort((a, b) => {
    const aCount = Number(a.count || 0);
    const bCount = Number(b.count || 0);
    const aLatest = toTimestamp(a.latestCommentAt);
    const bLatest = toTimestamp(b.latestCommentAt);
    if (sortBy === 'latest') {
      if (bLatest !== aLatest) return bLatest - aLatest;
      return bCount - aCount;
    }
    if (bCount !== aCount) return bCount - aCount;
    return bLatest - aLatest;
  });
  return normalized;
}

function buildCommentSummaryList(commentGroups, contentTitleMap) {
  const titleMap =
    contentTitleMap instanceof Map ? contentTitleMap : new Map(contentTitleMap);
  const groups = Array.isArray(commentGroups) ? commentGroups : [];
  const items = groups.map((group) => ({
    contentId: group.contentId,
    title: titleMap.get(group.contentId) || '제목 없음',
    count: group._count?._all || 0,
    latestCommentAt: group._max?.createdAt || null,
  }));
  return sortCommentSummaryItems(items, 'count');
}

function formatRelativeTimeLabel(latestTs, nowTs = Date.now()) {
  if (!latestTs) return '';
  const elapsedMs = Math.max(0, nowTs - Number(latestTs));
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const weekMs = 7 * dayMs;
  if (elapsedMs < 5 * minuteMs) {
    return '방금 전';
  }
  if (elapsedMs < hourMs) {
    const minutes = Math.max(1, Math.floor(elapsedMs / minuteMs));
    return `${minutes}\uBD84 \uC804`;
  }
  if (elapsedMs < dayMs) {
    const hours = Math.max(1, Math.floor(elapsedMs / hourMs));
    return `${hours}\uC2DC\uAC04 \uC804`;
  }
  if (elapsedMs < 2 * dayMs) {
    return '어제';
  }
  if (elapsedMs < weekMs) {
    const days = Math.max(1, Math.floor(elapsedMs / dayMs));
    return `${days}\uC77C \uC804`;
  }
  const weeks = Math.max(1, Math.floor(elapsedMs / weekMs));
  return `${weeks}\uC8FC \uC804`;
}

module.exports = {
  buildCommentSummaryList,
  sortCommentSummaryItems,
  formatRelativeTimeLabel,
};
