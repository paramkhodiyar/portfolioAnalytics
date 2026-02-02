
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // Simple admin password for now

app.use(cors({
    origin: ['http://localhost:3000', 'https://paramkhodiyar.vercel.app'],
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());

// --- Helper Functions ---

// Hash IP address for privacy
const hashIp = (ip) => {
    return crypto.createHash('sha256').update(ip || 'unknown').digest('hex');
};

// Simple User Agent to Device Type (very basic)
const getDeviceType = (userAgent) => {
    if (!userAgent) return 'unknown';
    const ua = userAgent.toLowerCase();
    if (ua.includes('mobile')) return 'mobile';
    if (ua.includes('tablet') || (ua.includes('ipad'))) return 'tablet';
    return 'desktop';
};

// --- Middleware ---

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- Routes ---

// Health Check
app.get('/', (req, res) => {
    res.send('Analytics API is running');
});

// Admin Login
app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Track Event
app.post('/api/track', async (req, res) => {
    const { sessionToken, type, metadata } = req.body;
    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.connection.remoteAddress;
    const ipHash = hashIp(ip);

    // Attempt to parse Referer
    const referrer = req.headers['referer'] || req.body.referrer || null;

    try {
        // Find or Create Session
        let session = await prisma.session.findUnique({
            where: { sessionToken },
        });

        if (!session) {
            session = await prisma.session.create({
                data: {
                    sessionToken,
                    ipHash,
                    userAgent,
                    referrer,
                    deviceType: getDeviceType(userAgent),
                    // country: req.headers['x-vercel-ip-country'] || null, // Optional if hosted on Vercel
                },
            });
        }

        // Record Event
        await prisma.event.create({
            data: {
                sessionId: session.id,
                type,
                metadata: metadata || {},
            },
        });

        res.status(200).send('ok');
    } catch (error) {
        console.error('Tracking Error:', error);
        res.status(500).json({ error: 'Failed to track event' });
    }
});

// --- Analytics Dashboard Routes (Protected) ---

app.get('/api/analytics/stats', authenticateToken, async (req, res) => {
    try {
        // 1. Total Sessions
        const totalSessions = await prisma.session.count();

        // 2. Total Page Views
        const totalPageViews = await prisma.event.count({
            where: { type: 'page_view' },
        });

        // 3. Top Pages
        // Group by metadata -> path requires raw query or client processing if JSON.
        // Prisma doesn't strictly support groupBy on JSON fields easily.
        // We will fetch recent page_view events and aggregate in memory for simplicity (limiting to last N events for perf)
        // OR using raw SQL for JSONB. Let's do a safe Raw SQL query for Postgres.

        let topPages = [];
        try {
            // Adjust based on your JSON structure. Assuming metadata->>'path'
            topPages = await prisma.$queryRaw`
                SELECT metadata->>'path' as path, COUNT(*) as count 
                FROM "Event" 
                WHERE type = 'page_view' 
                GROUP BY metadata->>'path' 
                ORDER BY count DESC 
                LIMIT 10
            `;
            // Convert BigInt to Number if necessary (Prisma returns BigInt for count)
            topPages = topPages.map(p => ({ ...p, count: Number(p.count) }));
        } catch (e) {
            console.warn("Raw query failed, likely SQLite/Postgres mismatch or JSON structure", e);
        }

        // 4. Device Usage
        const deviceStats = await prisma.session.groupBy({
            by: ['deviceType'],
            _count: { deviceType: true },
        });

        res.json({
            totalSessions,
            totalPageViews,
            topPages,
            deviceStats,
        });

    } catch (error) {
        console.error('Analytics Stats Error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
