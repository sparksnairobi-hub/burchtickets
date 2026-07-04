const pool = require("../config/db");

function slugify(title) {
  return (
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") + "-" + Math.random().toString(36).slice(2, 7)
  );
}

async function createEvent(req, res) {
  const { companyId } = req.auth;
  const { title, description, venueName, venueCity, startAt, endAt, capacity, coverImageBase64 } = req.body;

  if (!title || !venueName || !venueCity || !startAt || !endAt) {
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }

  // coverImageBase64 arrives as a data URL (e.g. "data:image/jpeg;base64,...").
  // Stored directly in banner_url for MVP simplicity; swap for object storage
  // (S3/Cloudinary) + a real URL once traffic justifies it.
  if (coverImageBase64 && coverImageBase64.length > 3_000_000) {
    return res.status(400).json({ ok: false, error: "IMAGE_TOO_LARGE" });
  }

  const slug = slugify(title);
  const result = await pool.query(
    `INSERT INTO events (company_id, title, slug, description, venue_name, venue_city, start_at, end_at, status, capacity, banner_url, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,NOW(),NOW())
     RETURNING id, slug`,
    [companyId, title, slug, description || null, venueName, venueCity, startAt, endAt, capacity || null, coverImageBase64 || null]
  );

  return res.status(201).json({ ok: true, eventId: result.rows[0].id, slug: result.rows[0].slug });
}

async function publishEvent(req, res) {
  const { companyId } = req.auth;
  const { eventId } = req.params;

  const ownsEvent = await pool.query(`SELECT id FROM events WHERE id=$1 AND company_id=$2`, [eventId, companyId]);
  if (ownsEvent.rowCount === 0) return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });

  const tierCheck = await pool.query(
    `SELECT COUNT(*)::int AS c FROM ticket_tiers WHERE event_id=$1 AND active=TRUE`,
    [eventId]
  );
  if (tierCheck.rows[0].c === 0) {
    return res.status(400).json({ ok: false, error: "NO_TICKET_TIERS" });
  }

  const result = await pool.query(
    `UPDATE events SET status='published', updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING id`,
    [eventId, companyId]
  );
  if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });
  return res.json({ ok: true });
}

async function listMyEvents(req, res) {
  const { companyId } = req.auth;
  const result = await pool.query(
    `SELECT e.*, COALESCE(SUM(tt.quantity_sold),0) AS tickets_sold
     FROM events e LEFT JOIN ticket_tiers tt ON tt.event_id = e.id
     WHERE e.company_id = $1
     GROUP BY e.id ORDER BY e.created_at DESC`,
    [companyId]
  );
  return res.json({ ok: true, events: result.rows });
}

async function listPublicEvents(req, res) {
  const result = await pool.query(
    `SELECT id, title, slug, venue_name, venue_city, start_at, banner_url AS cover_image_url
     FROM events WHERE status = 'published' ORDER BY start_at ASC LIMIT 50`
  );
  return res.json({ ok: true, events: result.rows });
}

async function getPublicEvent(req, res) {
  const { slug } = req.params;
  const eventRes = await pool.query(
    `SELECT id, company_id, title, description, venue_name, venue_city, start_at, end_at, currency, status, banner_url AS cover_image_url
     FROM events WHERE slug = $1`,
    [slug]
  );
  if (eventRes.rowCount === 0) return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });

  const event = eventRes.rows[0];
  const tiersRes = await pool.query(
    `SELECT id, name, description, price, currency, quantity_total, quantity_sold, max_per_order
     FROM ticket_tiers WHERE event_id = $1 AND active = TRUE ORDER BY price ASC`,
    [event.id]
  );

  return res.json({ ok: true, event, tiers: tiersRes.rows });
}

async function addTier(req, res) {
  const { companyId } = req.auth;
  const { eventId } = req.params;
  const { name, description, price, quantityTotal, maxPerOrder } = req.body;

  const ownsEvent = await pool.query(`SELECT id FROM events WHERE id=$1 AND company_id=$2`, [eventId, companyId]);
  if (ownsEvent.rowCount === 0) return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });

  const result = await pool.query(
    `INSERT INTO ticket_tiers (event_id, name, description, price, quantity_total, max_per_order, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING id`,
    [eventId, name, description || null, price, quantityTotal, maxPerOrder || 10]
  );

  return res.status(201).json({ ok: true, tierId: result.rows[0].id });
}

module.exports = { createEvent, publishEvent, listMyEvents, listPublicEvents, getPublicEvent, addTier };
