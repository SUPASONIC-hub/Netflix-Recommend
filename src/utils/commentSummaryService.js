const { buildCommentSummaryList } = require('./commentSummary');

async function getCommentSummary(prisma) {
  const commentGroups = await prisma.comment.groupBy({
    by: ['contentId'],
    _count: { _all: true },
    _max: { createdAt: true },
  });

  const groupedContentIds = commentGroups.map((group) => group.contentId);
  const groupedContents = groupedContentIds.length
    ? await prisma.content.findMany({
        where: { id: { in: groupedContentIds } },
        select: { id: true, title: true, name: true },
      })
    : [];

  const contentTitleMap = new Map(
    groupedContents.map((content) => [content.id, content.title || content.name || '제목 없음'])
  );

  const commentSummaryList = buildCommentSummaryList(commentGroups, contentTitleMap);
  const totalCommentCount = commentSummaryList.reduce((sum, item) => sum + item.count, 0);

  return { commentSummaryList, totalCommentCount };
}

module.exports = {
  getCommentSummary,
};
