# Netflix Recommend

Netflix Recommend

## Render Deployment
- Build Command: `npm install && npx prisma migrate deploy`
- Start Command: `npm start`
- Node Version: `20.x` (pinned in `package.json`)

### Environment Variables (Render)
Required:
- `ADMIN_PASSWORD`
- `TMDB_API_KEY`
- `DATABASE_URL`

Recommended:
- `NODE_ENV=production`

## Local DB Setup
1. `npm install`
2. `npx prisma migrate dev --name init`
3. (Optional seed) `node prisma/seed.js`
