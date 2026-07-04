const { Queue, Worker } = require("bullmq");
const nodemailer = require("nodemailer");
const pool = require("../config/db");
const { buildTicketPdf } = require("./ticketPdf");

// Redis (and therefore the async confirmation-email worker) is optional.
// Set REDIS_HOST or REDIS_URL to enable it. Without it, checkout and
// payment confirmation still work — confirmation emails are just skipped,
// and buyers can still download their PDF ticket directly from the app.
const REDIS_ENABLED = !!(process.env.REDIS_HOST || process.env.REDIS_URL);

const connection = process.env.REDIS_URL
  ? process.env.REDIS_URL
  : { host: process.env.REDIS_HOST || "localhost", port: Number(process.env.REDIS_PORT || 6379) };

const emailQueue = REDIS_ENABLED ? new Queue("email-confirmations", { connection }) : null;
if (emailQueue) emailQueue.on("error", (err) => console.warn("Email queue Redis error:", err.message));

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function enqueueConfirmationEmail({ companyId, orderId, ticketId = null, recipientEmail, recipientName, templateKey = "payment_confirmation" }) {
  if (!emailQueue) {
    console.warn(`Redis not configured — skipping confirmation email for order ${orderId}.`);
    return { duplicate: false, skipped: true };
  }

  const idempotencyKey = `email:confirmation:order:${orderId}:recipient:${recipientEmail}`;

  const insert = await pool.query(
    `INSERT INTO email_jobs (company_id, order_id, ticket_id, recipient_email, recipient_name, template_key, idempotency_key, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',NOW())
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [companyId, orderId, ticketId, recipientEmail, recipientName, templateKey, idempotencyKey]
  );

  if (insert.rowCount === 0) return { duplicate: true };

  await emailQueue.add(
    "send-confirmation",
    { emailJobId: insert.rows[0].id },
    { attempts: 5, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: true }
  );

  return { duplicate: false };
}

// Only start the worker in the main server process (see server.js).
// Throws clearly if Redis isn't configured, so the caller's try/catch can
// report it without crashing the app.
function startEmailWorker() {
  if (!REDIS_ENABLED) {
    throw new Error("REDIS_HOST/REDIS_URL not set — async confirmation emails are disabled.");
  }
  return new Worker(
    "email-confirmations",
    async (job) => {
      const { emailJobId } = job.data;
      const jobRes = await pool.query(
        `SELECT ej.*, o.buyer_name, o.total_amount, o.currency, e.title AS event_title,
                e.venue_name, e.venue_city, e.start_at, c.name AS company_name
         FROM email_jobs ej
         JOIN orders o ON o.id = ej.order_id
         JOIN events e ON e.id = o.event_id
         JOIN companies c ON c.id = e.company_id
         WHERE ej.id = $1`,
        [emailJobId]
      );
      if (jobRes.rowCount === 0) return;
      const j = jobRes.rows[0];
      if (j.status === "sent") return;

      await pool.query(`UPDATE email_jobs SET status='sending' WHERE id=$1`, [emailJobId]);

      try {
        const ticketRes = await pool.query(
          `SELECT t.ticket_code, t.holder_name, t.holder_email, tt.name AS tier_name, tt.price AS tier_price
           FROM tickets t
           JOIN order_items oi ON oi.id = t.order_item_id
           WHERE oi.order_id = $1
           ORDER BY t.id`,
          [j.order_id]
        );

        const attachments = await Promise.all(
          ticketRes.rows.map(async (row, i) => ({
            filename: `burchtickets-${row.ticket_code}.pdf`,
            content: await buildTicketPdf({
              ticket: { ticketCode: row.ticket_code, holderName: row.holder_name, holderEmail: row.holder_email },
              event: { title: j.event_title, venueName: j.venue_name, venueCity: j.venue_city, startAt: j.start_at },
              tier: { name: row.tier_name, price: row.tier_price, currency: j.currency },
              order: { id: j.order_id },
              companyName: j.company_name,
            }),
          }))
        );

        const info = await transporter.sendMail({
          from: process.env.MAIL_FROM,
          to: j.recipient_email,
          subject: `Your ticket${attachments.length > 1 ? "s" : ""} for ${j.event_title} — BurchTickets`,
          html: `<p>Hi ${j.recipient_name || j.buyer_name},</p>
                 <p>Payment received — you're confirmed for <strong>${j.event_title}</strong>.</p>
                 <p>Amount charged: ${j.currency} ${j.total_amount}</p>
                 <p>Your ${attachments.length > 1 ? "tickets are" : "ticket is"} attached as PDF${attachments.length > 1 ? "s" : ""}. Bring it up on your phone or print it — either works at the door.</p>
                 <p style="color:#5B564C;font-size:12px;">BurchTickets · booked with ${j.company_name}</p>`,
          attachments,
        });

        await pool.query(
          `UPDATE email_jobs SET status='sent', provider_message_id=$2, sent_at=NOW(), attempts=attempts+1 WHERE id=$1`,
          [emailJobId, info.messageId || null]
        );
      } catch (err) {
        await pool.query(
          `UPDATE email_jobs SET status='failed', last_error=$2, attempts=attempts+1 WHERE id=$1`,
          [emailJobId, err.message]
        );
        throw err;
      }
    },
    { connection }
  );
}

module.exports = { enqueueConfirmationEmail, emailQueue, startEmailWorker };
