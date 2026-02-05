
// const express = require('express');
// const cors = require('cors');
// const { PrismaClient } = require('@prisma/client');
// const crypto = require('crypto');
// const jwt = require('jsonwebtoken');
// const axios = require('axios');


// const app = express();
// const prisma = new PrismaClient();
// const PORT = process.env.PORT || 5000;
// const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';
// const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '22428374'; // Secured PIN

// app.use(cors({
//     origin: ['http://localhost:3000', 'https://paramkhodiyar.vercel.app'],
//     methods: ['GET', 'POST'],
//     credentials: true
// }));
// app.use(express.json());

// // --- Helper Functions ---

// // Hash IP address for privacy
// const hashIp = (ip) => {
//     return crypto.createHash('sha256').update(ip || 'unknown').digest('hex');
// };

// // Simple User Agent to Device Type (very basic)
// const getDeviceType = (userAgent) => {
//     if (!userAgent) return 'unknown';
//     const ua = userAgent.toLowerCase();
//     if (ua.includes('mobile')) return 'mobile';
//     if (ua.includes('tablet') || (ua.includes('ipad'))) return 'tablet';
//     return 'desktop';
// };

// // --- Middleware ---

// const authenticateToken = (req, res, next) => {
//     const authHeader = req.headers['authorization'];
//     const token = authHeader && authHeader.split(' ')[1];

//     if (!token) return res.sendStatus(401);

//     jwt.verify(token, JWT_SECRET, (err, user) => {
//         if (err) return res.sendStatus(403);
//         req.user = user;
//         next();
//     });
// };

// app.get('/', (req, res) => {
//     res.send('Analytics API is running');
// });

// // Admin Login
// app.post('/api/auth/login', (req, res) => {
//     const { password } = req.body;
//     if (password === ADMIN_PASSWORD) {
//         const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
//         res.json({ token });
//     } else {
//         res.status(401).json({ error: 'Invalid credentials' });
//     }
// });

// // Track Event
// app.post('/api/track', async (req, res) => {
//     const { sessionToken, type, metadata } = req.body;
//     const userAgent = req.headers['user-agent'];
//     const ip = req.ip || req.connection.remoteAddress;
//     const ipHash = hashIp(ip);

//     // Attempt to parse Referer
//     const referrer = req.headers['referer'] || req.body.referrer || null;

//     try {
//         // Find or Create Session
//         let session = await prisma.session.findUnique({
//             where: { sessionToken },
//         });

//         if (!session) {
//             let country = null;
//             let city = null;

//             // Fetch location data if not local
//             if (ip && ip !== '::1' && ip !== '127.0.0.1') {
//                 try {
//                     const geoRes = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,city`);
//                     if (geoRes.data.status === 'success') {
//                         country = geoRes.data.country;
//                         city = geoRes.data.city;
//                     }
//                 } catch (e) {
//                     console.warn('Geo IP lookup failed', e.message);
//                 }
//             }

//             session = await prisma.session.create({
//                 data: {
//                     sessionToken,
//                     ipHash,
//                     userAgent,
//                     referrer,
//                     deviceType: getDeviceType(userAgent),
//                     country: country || req.headers['x-vercel-ip-country'] || null,
//                     city: city || null,
//                 },
//             });
//         }


//         // Record Event
//         await prisma.event.create({
//             data: {
//                 sessionId: session.id,
//                 type,
//                 metadata: metadata || {},
//             },
//         });

//         res.status(200).send('ok');
//     } catch (error) {
//         console.error('Tracking Error:', error);
//         res.status(500).json({ error: 'Failed to track event' });
//     }
// });

// // --- Analytics Dashboard Routes (Protected) ---

// app.get('/api/analytics/stats', authenticateToken, async (req, res) => {
//     const { range } = req.query; // 'today', 'week', 'month', or default 'all'
//     let startDate = null;
//     const now = new Date();

//     if (range === 'today') {
//         startDate = new Date(now.setHours(0, 0, 0, 0));
//     } else if (range === 'week') {
//         startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
//     } else if (range === 'month') {
//         startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
//     }

//     const dateFilter = startDate ? { createdAt: { gte: startDate } } : {};
//     const rawDateFilter = startDate ? `AND "createdAt" >= ${startDate.toISOString()}`.replace('AND', 'WHERE') : '';

//     try {
//         // 1. Total Sessions
//         const totalSessions = await prisma.session.count({ where: dateFilter });

//         // 2. Total Page Views
//         const totalPageViews = await prisma.event.count({
//             where: {
//                 ...dateFilter,
//                 type: 'page_view'
//             },
//         });

//         // 3. Top Sections
//         let topSections = [];
//         try {
//             if (startDate) {
//                 topSections = await prisma.$queryRaw`
//                     SELECT metadata->>'section' as section, COUNT(*) as count 
//                     FROM "Event" 
//                     WHERE type = 'section_view_time' AND "createdAt" >= ${startDate}
//                     GROUP BY metadata->>'section' 
//                     ORDER BY count DESC 
//                 `;
//             } else {
//                 topSections = await prisma.$queryRaw`
//                     SELECT metadata->>'section' as section, COUNT(*) as count 
//                     FROM "Event" 
//                     WHERE type = 'section_view_time' 
//                     GROUP BY metadata->>'section' 
//                     ORDER BY count DESC 
//                 `;
//             }
//             topSections = topSections.map(p => ({ ...p, count: Number(p.count) }));
//         } catch (e) {
//             console.warn("Top sections query failed", e);
//         }

//         // 4. Device Usage
//         const deviceStats = await prisma.session.groupBy({
//             by: ['deviceType'],
//             where: dateFilter,
//             _count: { deviceType: true },
//         });

//         // 5. Visitor Identity (Roles)
//         let visitorRoles = [];
//         try {
//             if (startDate) {
//                 visitorRoles = await prisma.$queryRaw`
//                     SELECT metadata->>'role' as role, COUNT(*) as count
//                     FROM "Event"
//                     WHERE type = 'visitor_identity' AND "createdAt" >= ${startDate}
//                     GROUP BY metadata->>'role'
//                 `;
//             } else {
//                 visitorRoles = await prisma.$queryRaw`
//                     SELECT metadata->>'role' as role, COUNT(*) as count
//                     FROM "Event"
//                     WHERE type = 'visitor_identity'
//                     GROUP BY metadata->>'role'
//                 `;
//             }
//             visitorRoles = visitorRoles.map(p => ({ ...p, count: Number(p.count) }));
//         } catch (e) {
//             console.warn("Role query failed", e);
//         }

//         // 6. Section Engagement (Avg Duration)
//         let sectionEngagement = [];
//         try {
//             if (startDate) {
//                 sectionEngagement = await prisma.$queryRaw`
//                     SELECT metadata->>'section' as section, AVG(CAST(metadata->>'duration' AS FLOAT)) as avg_duration
//                     FROM "Event"
//                     WHERE type = 'section_view_time' AND "createdAt" >= ${startDate}
//                     GROUP BY metadata->>'section'
//                 `;
//             } else {
//                 sectionEngagement = await prisma.$queryRaw`
//                     SELECT metadata->>'section' as section, AVG(CAST(metadata->>'duration' AS FLOAT)) as avg_duration
//                     FROM "Event"
//                     WHERE type = 'section_view_time'
//                     GROUP BY metadata->>'section'
//                 `;
//             }
//             sectionEngagement = sectionEngagement.map(p => ({ ...p, avg_duration: Math.round(p.avg_duration || 0) }));
//         } catch (e) {
//             console.warn("Engagement query failed", e);
//         }

//         // 7. Clicks
//         let clickStats = [];
//         try {
//             if (startDate) {
//                 clickStats = await prisma.$queryRaw`
//                     SELECT metadata->>'element' as element, metadata->>'project' as project, metadata->>'type' as type, COUNT(*) as count
//                     FROM "Event"
//                     WHERE type = 'click' AND "createdAt" >= ${startDate}
//                     GROUP BY metadata->>'element', metadata->>'project', metadata->>'type'
//                     ORDER BY count DESC
//                     LIMIT 20
//                 `;
//             } else {
//                 clickStats = await prisma.$queryRaw`
//                     SELECT metadata->>'element' as element, metadata->>'project' as project, metadata->>'type' as type, COUNT(*) as count
//                     FROM "Event"
//                     WHERE type = 'click'
//                     GROUP BY metadata->>'element', metadata->>'project', metadata->>'type'
//                     ORDER BY count DESC
//                     LIMIT 20
//                 `;
//             }
//             clickStats = clickStats.map(p => ({ ...p, count: Number(p.count) }));
//         } catch (e) {
//             console.warn("Click query failed", e);
//         }

//         // 8. Location Stats
//         const locationStats = await prisma.session.groupBy({
//             by: ['country'],
//             where: {
//                 ...dateFilter,
//                 country: { not: null }
//             },
//             _count: { country: true },
//             orderBy: { _count: { country: 'desc' } },
//             take: 10
//         });

//         // 9. Total Average Session Time (Sum of all section durations per session)
//         let avgTotalTimeResult = [];
//         try {
//             if (startDate) {
//                 avgTotalTimeResult = await prisma.$queryRaw`
//                     SELECT AVG(session_total) as avg_total
//                     FROM (
//                         SELECT "sessionId", SUM(CAST(metadata->>'duration' AS FLOAT)) as session_total
//                         FROM "Event"
//                         WHERE type = 'section_view_time' AND "createdAt" >= ${startDate}
//                         GROUP BY "sessionId"
//                     ) as session_durations
//                 `;
//             } else {
//                 avgTotalTimeResult = await prisma.$queryRaw`
//                     SELECT AVG(session_total) as avg_total
//                     FROM (
//                         SELECT "sessionId", SUM(CAST(metadata->>'duration' AS FLOAT)) as session_total
//                         FROM "Event"
//                         WHERE type = 'section_view_time'
//                         GROUP BY "sessionId"
//                     ) as session_durations
//                 `;
//             }
//         } catch (e) {
//             console.warn("Avg total time query failed", e);
//         }

//         res.json({
//             totalSessions,
//             totalPageViews,
//             topSections,
//             deviceStats,
//             visitorRoles,
//             sectionEngagement,
//             clickStats,
//             locationStats,
//             avgSessionDuration: Math.round(avgTotalTimeResult[0]?.avg_total || 0)
//         });


//     } catch (error) {
//         console.error('Analytics Stats Error:', error);
//         res.status(500).json({ error: 'Failed to fetch stats' });
//     }
// });

// app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
// });


const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '22428374';

app.use(cors({
    origin: ['http://localhost:3000', 'https://paramkhodiyar.vercel.app'],
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());

// --- Helper Functions ---
const hashIp = (ip) => {
    return crypto.createHash('sha256').update(ip || 'unknown').digest('hex');
};

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
    const referrer = req.headers['referer'] || req.body.referrer || null;

    try {
        let session = await prisma.session.findUnique({
            where: { sessionToken },
        });

        if (!session) {
            let country = null;
            let city = null;

            if (ip && ip !== '::1' && ip !== '127.0.0.1') {
                try {
                    const geoRes = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,city`);
                    if (geoRes.data.status === 'success') {
                        country = geoRes.data.country;
                        city = geoRes.data.city;
                    }
                } catch (e) {
                    console.warn('Geo IP lookup failed', e.message);
                }
            }

            session = await prisma.session.create({
                data: {
                    sessionToken,
                    ipHash,
                    userAgent,
                    referrer,
                    deviceType: getDeviceType(userAgent),
                    country: country || req.headers['x-vercel-ip-country'] || null,
                    city: city || null,
                },
            });
        }

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

// --- NEW: Real-time Activity Feed ---
app.get('/api/analytics/activity', authenticateToken, async (req, res) => {
    try {
        const recentEvents = await prisma.event.findMany({
            take: 50,
            orderBy: { createdAt: 'desc' },
            include: {
                session: {
                    select: {
                        country: true,
                        city: true,
                        deviceType: true,
                        createdAt: true,
                    }
                }
            }
        });

        const formattedEvents = recentEvents.map(event => ({
            id: event.id,
            type: event.type,
            metadata: event.metadata,
            timestamp: event.createdAt,
            country: event.session.country,
            city: event.session.city,
            deviceType: event.session.deviceType,
        }));

        res.json({ events: formattedEvents });
    } catch (error) {
        console.error('Activity Error:', error);
        res.status(500).json({ error: 'Failed to fetch activity' });
    }
});

// --- NEW: Trend Data (Time Series) ---
app.get('/api/analytics/trends', authenticateToken, async (req, res) => {
    const { range = 'week' } = req.query;
    let days = 7;
    if (range === 'month') days = 30;
    if (range === 'year') days = 365;

    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get daily session counts
        const dailySessions = await prisma.$queryRaw`
            SELECT DATE("createdAt") as date, COUNT(DISTINCT id) as sessions
            FROM "Session"
            WHERE "createdAt" >= ${startDate}
            GROUP BY DATE("createdAt")
            ORDER BY date ASC
        `;

        // Get daily page views
        const dailyPageViews = await prisma.$queryRaw`
            SELECT DATE("createdAt") as date, COUNT(*) as views
            FROM "Event"
            WHERE "createdAt" >= ${startDate} AND type = 'page_view'
            GROUP BY DATE("createdAt")
            ORDER BY date ASC
        `;

        res.json({
            sessions: dailySessions.map(d => ({
                date: d.date,
                count: Number(d.sessions)
            })),
            pageViews: dailyPageViews.map(d => ({
                date: d.date,
                count: Number(d.views)
            }))
        });
    } catch (error) {
        console.error('Trends Error:', error);
        res.status(500).json({ error: 'Failed to fetch trends' });
    }
});

// --- NEW: User Journey / Funnel Analysis ---
app.get('/api/analytics/journey', authenticateToken, async (req, res) => {
    try {
        // Get most common user paths (sequence of pages)
        const journeys = await prisma.$queryRaw`
            WITH session_paths AS (
                SELECT 
                    "sessionId",
                    STRING_AGG(metadata->>'path', ' -> ' ORDER BY "createdAt") as path
                FROM "Event"
                WHERE type = 'page_view'
                GROUP BY "sessionId"
            )
            SELECT path, COUNT(*) as count
            FROM session_paths
            GROUP BY path
            ORDER BY count DESC
            LIMIT 20
        `;

        res.json({ journeys: journeys.map(j => ({ ...j, count: Number(j.count) })) });
    } catch (error) {
        console.error('Journey Error:', error);
        res.status(500).json({ error: 'Failed to fetch journey data' });
    }
});

// --- NEW: Bounce Rate & Exit Pages ---
app.get('/api/analytics/behavior', authenticateToken, async (req, res) => {
    try {
        // Sessions with only 1 page view = bounced
        const totalSessions = await prisma.session.count();

        const bouncedSessions = await prisma.$queryRaw`
            SELECT COUNT(DISTINCT "sessionId") as bounced
            FROM "Event"
            WHERE type = 'page_view'
            GROUP BY "sessionId"
            HAVING COUNT(*) = 1
        `;

        const bounceRate = totalSessions > 0
            ? ((Number(bouncedSessions[0]?.bounced || 0) / totalSessions) * 100).toFixed(1)
            : 0;

        // Exit pages (last page viewed in sessions)
        const exitPages = await prisma.$queryRaw`
            WITH last_pages AS (
                SELECT DISTINCT ON ("sessionId")
                    "sessionId",
                    metadata->>'path' as page
                FROM "Event"
                WHERE type = 'page_view'
                ORDER BY "sessionId", "createdAt" DESC
            )
            SELECT page, COUNT(*) as exits
            FROM last_pages
            GROUP BY page
            ORDER BY exits DESC
            LIMIT 10
        `;

        res.json({
            bounceRate: Number(bounceRate),
            exitPages: exitPages.map(p => ({ ...p, exits: Number(p.exits) }))
        });
    } catch (error) {
        console.error('Behavior Error:', error);
        res.status(500).json({ error: 'Failed to fetch behavior data' });
    }
});

// --- NEW: Referrer Analysis ---
app.get('/api/analytics/referrers', authenticateToken, async (req, res) => {
    try {
        const referrers = await prisma.session.groupBy({
            by: ['referrer'],
            where: {
                referrer: { not: null }
            },
            _count: { referrer: true },
            orderBy: { _count: { referrer: 'desc' } },
            take: 15
        });

        const categorized = referrers.map(r => {
            let source = 'direct';
            if (r.referrer) {
                try {
                    const url = new URL(r.referrer);
                    const domain = url.hostname.replace('www.', '');

                    if (domain.includes('google')) source = 'Google Search';
                    else if (domain.includes('bing')) source = 'Bing Search';
                    else if (domain.includes('facebook')) source = 'Facebook';
                    else if (domain.includes('twitter') || domain.includes('t.co')) source = 'Twitter';
                    else if (domain.includes('linkedin')) source = 'LinkedIn';
                    else if (domain.includes('github')) source = 'GitHub';
                    else source = domain;
                } catch (e) {
                    source = 'Other';
                }
            }

            return {
                source,
                count: r._count.referrer
            };
        });

        // Aggregate by source
        const aggregated = categorized.reduce((acc, curr) => {
            const existing = acc.find(item => item.source === curr.source);
            if (existing) {
                existing.count += curr.count;
            } else {
                acc.push({ ...curr });
            }
            return acc;
        }, []);

        res.json({ referrers: aggregated.sort((a, b) => b.count - a.count) });
    } catch (error) {
        console.error('Referrer Error:', error);
        res.status(500).json({ error: 'Failed to fetch referrer data' });
    }
});

// --- Enhanced Stats Endpoint ---
app.get('/api/analytics/stats', authenticateToken, async (req, res) => {
    const { range } = req.query;
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

    try {
        const totalSessions = await prisma.session.count({ where: dateFilter });
        const totalPageViews = await prisma.event.count({
            where: { ...dateFilter, type: 'page_view' },
        });

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

        const deviceStats = await prisma.session.groupBy({
            by: ['deviceType'],
            where: dateFilter,
            _count: { deviceType: true },
        });

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

        const locationStats = await prisma.session.groupBy({
            by: ['country'],
            where: { ...dateFilter, country: { not: null } },
            _count: { country: true },
            orderBy: { _count: { country: 'desc' } },
            take: 10
        });

        let avgTotalTimeResult = [];
        try {
            if (startDate) {
                avgTotalTimeResult = await prisma.$queryRaw`
                    SELECT AVG(session_total) as avg_total
                    FROM (
                        SELECT "sessionId", SUM(CAST(metadata->>'duration' AS FLOAT)) as session_total
                        FROM "Event"
                        WHERE type = 'section_view_time' AND "createdAt" >= ${startDate}
                        GROUP BY "sessionId"
                    ) as session_durations
                `;
            } else {
                avgTotalTimeResult = await prisma.$queryRaw`
                    SELECT AVG(session_total) as avg_total
                    FROM (
                        SELECT "sessionId", SUM(CAST(metadata->>'duration' AS FLOAT)) as session_total
                        FROM "Event"
                        WHERE type = 'section_view_time'
                        GROUP BY "sessionId"
                    ) as session_durations
                `;
            }
        } catch (e) {
            console.warn("Avg total time query failed", e);
        }

        // NEW: Scroll depth stats
        let scrollDepthStats = [];
        try {
            if (startDate) {
                scrollDepthStats = await prisma.$queryRaw`
                    SELECT 
                        CASE 
                            WHEN CAST(metadata->>'percentage' AS INTEGER) >= 75 THEN '75-100%'
                            WHEN CAST(metadata->>'percentage' AS INTEGER) >= 50 THEN '50-75%'
                            WHEN CAST(metadata->>'percentage' AS INTEGER) >= 25 THEN '25-50%'
                            ELSE '0-25%'
                        END as depth_range,
                        COUNT(*) as count
                    FROM "Event"
                    WHERE type = 'scroll_depth' AND "createdAt" >= ${startDate}
                    GROUP BY depth_range
                `;
            } else {
                scrollDepthStats = await prisma.$queryRaw`
                    SELECT 
                        CASE 
                            WHEN CAST(metadata->>'percentage' AS INTEGER) >= 75 THEN '75-100%'
                            WHEN CAST(metadata->>'percentage' AS INTEGER) >= 50 THEN '50-75%'
                            WHEN CAST(metadata->>'percentage' AS INTEGER) >= 25 THEN '25-50%'
                            ELSE '0-25%'
                        END as depth_range,
                        COUNT(*) as count
                    FROM "Event"
                    WHERE type = 'scroll_depth'
                    GROUP BY depth_range
                `;
            }
            scrollDepthStats = scrollDepthStats.map(s => ({ ...s, count: Number(s.count) }));
        } catch (e) {
            console.warn("Scroll depth query failed", e);
        }

        res.json({
            totalSessions,
            totalPageViews,
            topSections,
            deviceStats,
            visitorRoles,
            sectionEngagement,
            clickStats,
            locationStats,
            scrollDepthStats,
            avgSessionDuration: Math.round(avgTotalTimeResult[0]?.avg_total || 0)
        });

    } catch (error) {
        console.error('Analytics Stats Error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});