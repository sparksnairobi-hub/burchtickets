const pool = require("../config/db");
const { discoverEvents } = require("../services/eventAggregator");

async function discover(req, res) {
  const city = (req.query.city || "Nairobi").toString();

  const [ownEventsRes, externalEvents] = await Promise.all([
    pool.query(
      `SELECT id, title, slug, venue_name, venue_city, start_at, banner_url AS cover_image_url
       FROM events
       WHERE status = 'published' AND venue_city ILIKE $1
       ORDER BY start_at ASC LIMIT 20`,
      [`%${city}%`]
    ).catch(() => ({ rows: [] })),
    discoverEvents(city),
  ]);

  const ownEvents = ownEventsRes.rows.map((ev) => ({
    id: `own:${ev.id}`,
    source: "burchtickets",
    sourceLabel: "BurchTickets",
    title: ev.title,
    venue: ev.venue_name,
    city: ev.venue_city,
    startAt: ev.start_at,
    url: null, // frontend routes internally via slug instead
    slug: ev.slug,
    image: ev.cover_image_url || null,
  }));

  const combined = [...ownEvents, ...externalEvents].sort(
    (a, b) => new Date(a.startAt || 0) - new Date(b.startAt || 0)
  );

  return res.json({ ok: true, city, events: combined, updatedAt: new Date().toISOString() });
}

module.exports = { discover };
