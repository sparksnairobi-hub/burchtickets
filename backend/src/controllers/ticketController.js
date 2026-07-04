const pool = require("../config/db");
const { buildTicketPdf } = require("../services/ticketPdf");

async function downloadTicketPdf(req, res) {
  const { code } = req.params;

  const result = await pool.query(
    `SELECT
       t.ticket_code, t.holder_name, t.holder_email,
       tt.name AS tier_name, tt.price AS tier_price,
       o.id AS order_id, o.status AS order_status, o.currency,
       e.title AS event_title, e.venue_name, e.venue_city, e.start_at,
       c.name AS company_name
     FROM tickets t
     JOIN order_items oi ON oi.id = t.order_item_id
     JOIN ticket_tiers tt ON tt.id = oi.ticket_tier_id
     JOIN orders o ON o.id = oi.order_id
     JOIN events e ON e.id = o.event_id
     JOIN companies c ON c.id = e.company_id
     WHERE t.ticket_code = $1`,
    [code]
  );

  if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "TICKET_NOT_FOUND" });
  const row = result.rows[0];
  if (row.order_status !== "paid") return res.status(403).json({ ok: false, error: "ORDER_NOT_PAID" });

  const pdfBuffer = await buildTicketPdf({
    ticket: { ticketCode: row.ticket_code, holderName: row.holder_name, holderEmail: row.holder_email },
    event: { title: row.event_title, venueName: row.venue_name, venueCity: row.venue_city, startAt: row.start_at },
    tier: { name: row.tier_name, price: row.tier_price, currency: row.currency },
    order: { id: row.order_id },
    companyName: row.company_name,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="burchtickets-${row.ticket_code}.pdf"`);
  res.send(pdfBuffer);
}

module.exports = { downloadTicketPdf };
