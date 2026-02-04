
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '22428374'; // Secured PIN

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
    const { range } = req.query; // 'today', 'week', 'month', or default 'all'
    let startDate = null;
    const now = new Date();

    if (range === 'today') {
        startDate = new Date(now.setHours(0, 0, 0, 0));
    } else if (range === 'week') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === 'month') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const dateFilter = startDate ? { createdAt: { gte: startDate } } : {};
    const rawDateFilter = startDate ? `AND "createdAt" >= ${startDate.toISOString()}`.replace('AND', 'WHERE') : '';

    try {
        // 1. Total Sessions
        const totalSessions = await prisma.session.count({ where: dateFilter });

        // 2. Total Page Views
        const totalPageViews = await prisma.event.count({
            where: {
                ...dateFilter,
                type: 'page_view'
            },
        });

        // 3. Top Sections
        let topSections = [];
        try {
            if (startDate) {
                topSections = await prisma.$queryRaw`
                    SELECT metadata->>'section' as section, COUNT(*) as count 
                    FROM "Event" 
                    WHERE type = 'section_view_time' AND "createdAt" >= ${startDate}
                    GROUP BY metadata->>'section' 
                    ORDER BY count DESC 
                `;
            } else {
                topSections = await prisma.$queryRaw`
                    SELECT metadata->>'section' as section, COUNT(*) as count 
                    FROM "Event" 
                    WHERE type = 'section_view_time' 
                    GROUP BY metadata->>'section' 
                    ORDER BY count DESC 
                `;
            }
            topSections = topSections.map(p => ({ ...p, count: Number(p.count) }));
        } catch (e) {
            console.warn("Top sections query failed", e);
        }

        // 4. Device Usage
        const deviceStats = await prisma.session.groupBy({
            by: ['deviceType'],
            where: dateFilter,
            _count: { deviceType: true },
        });

        // 5. Visitor Identity (Roles)
        let visitorRoles = [];
        try {
            if (startDate) {
                visitorRoles = await prisma.$queryRaw`
                    SELECT metadata->>'role' as role, COUNT(*) as count
                    FROM "Event"
                    WHERE type = 'visitor_identity' AND "createdAt" >= ${startDate}
                    GROUP BY metadata->>'role'
                `;
            } else {
                visitorRoles = await prisma.$queryRaw`
                    SELECT metadata->>'role' as role, COUNT(*) as count
                    FROM "Event"
                    WHERE type = 'visitor_identity'
                    GROUP BY metadata->>'role'
                `;
            }
            visitorRoles = visitorRoles.map(p => ({ ...p, count: Number(p.count) }));
        } catch (e) {
            console.warn("Role query failed", e);
        }

        // 6. Section Engagement (Avg Duration)
        let sectionEngagement = [];
        try {
            if (startDate) {
                sectionEngagement = await prisma.$queryRaw`
                    SELECT metadata->>'section' as section, AVG(CAST(metadata->>'duration' AS FLOAT)) as avg_duration
                    FROM "Event"
                    WHERE type = 'section_view_time' AND "createdAt" >= ${startDate}
                    GROUP BY metadata->>'section'
                `;
            } else {
                sectionEngagement = await prisma.$queryRaw`
                    SELECT metadata->>'section' as section, AVG(CAST(metadata->>'duration' AS FLOAT)) as avg_duration
                    FROM "Event"
                    WHERE type = 'section_view_time'
                    GROUP BY metadata->>'section'
                `;
            }
            sectionEngagement = sectionEngagement.map(p => ({ ...p, avg_duration: Math.round(p.avg_duration || 0) }));
        } catch (e) {
            console.warn("Engagement query failed", e);
        }

        // 7. Clicks
        let clickStats = [];
        try {
            if (startDate) {
                clickStats = await prisma.$queryRaw`
                    SELECT metadata->>'element' as element, metadata->>'project' as project, metadata->>'type' as type, COUNT(*) as count
                    FROM "Event"
                    WHERE type = 'click' AND "createdAt" >= ${startDate}
                    GROUP BY metadata->>'element', metadata->>'project', metadata->>'type'
                    ORDER BY count DESC
                    LIMIT 20
                `;
            } else {
                clickStats = await prisma.$queryRaw`
                    SELECT metadata->>'element' as element, metadata->>'project' as project, metadata->>'type' as type, COUNT(*) as count
                    FROM "Event"
                    WHERE type = 'click'
                    GROUP BY metadata->>'element', metadata->>'project', metadata->>'type'
                    ORDER BY count DESC
                    LIMIT 20
                `;
            }
            clickStats = clickStats.map(p => ({ ...p, count: Number(p.count) }));
        } catch (e) {
            console.warn("Click query failed", e);
        }

        res.json({
            totalSessions,
            totalPageViews,
            topSections,
            deviceStats,
            visitorRoles,
            sectionEngagement,
            clickStats
        });

    } catch (error) {
        console.error('Analytics Stats Error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
