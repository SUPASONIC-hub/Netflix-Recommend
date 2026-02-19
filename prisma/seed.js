const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function run() {
  const contentId = 'seed-content-1';
  await prisma.content.upsert({
    where: { id: contentId },
    update: {},
    create: {
      id: contentId,
      tmdbId: 'demo-1',
      title: 'Sample Recommendation',
      name: '',
      overview: 'Seed data for local development.',
      releaseDate: '2024-01-01',
      firstAirDate: '',
      posterPath: '',
      posterUrl: '',
      backdropPath: '',
      genreIds: [18],
      popularity: 1.0,
      voteAverage: 7.5,
      voteCount: 10,
      adult: false,
      mediaType: 'movie',
      year: '2024',
      type: 'movie',
      myNote: 'Great starter content.',
      myRating: 4.5,
      tags: ['seed', 'demo'],
    },
  });

  await prisma.comment.upsert({
    where: { id: 'seed-comment-1' },
    update: {},
    create: {
      id: 'seed-comment-1',
      contentId,
      nickname: 'Seeder',
      text: 'Looks good!',
    },
  });
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
