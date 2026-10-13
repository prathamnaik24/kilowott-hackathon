const { env } = await import('file:///D:/kilowott%20hackathon/server/src/config/env.ts');
const { prisma } = await import('file:///D:/kilowott%20hackathon/server/src/lib/db.ts');
await prisma.$connect();
console.log('env.JWT_SECRET used by app =', env.JWT_SECRET);
console.log('process.env.JWT_SECRET after Prisma connect =', process.env.JWT_SECRET ?? '(unset)');
await prisma.$disconnect();
