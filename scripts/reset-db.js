const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Starting database reset...');
    // Delete Events first, then Sessions
    await prisma.$transaction([
        prisma.event.deleteMany(),
        prisma.session.deleteMany(),
    ]);
    console.log('Database reset successfully! All analytics data has been cleared.');
}

main()
    .catch((e) => {
        console.error('Error resetting database:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });