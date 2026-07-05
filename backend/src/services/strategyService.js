const pool = require('../config/db');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Creates a strategy call record and notifies admin via email.
async function createStrategyCall({ name, email, phone, company, preferredDate, message, source }){
  const client = await pool.connect();
  try{
    const insertSql = `INSERT INTO strategy_calls
      (name, email, phone, company, preferred_date, message, source)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`;
    const vals = [name, email, phone || null, company || null, preferredDate || null, message || null, source || null];
    const r = await client.query(insertSql, vals);
    const id = r.rows[0].id;

    // send notification email to admin (if configured)
    const admin = process.env.STRATEGY_ADMIN_EMAIL;
    const from = process.env.STRATEGY_FROM_EMAIL || process.env.SMTP_FROM || `no-reply@${process.env.FRONTEND_ORIGIN || 'burchtickets.local'}`;
    if (admin && process.env.SMTP_HOST){
      try{
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        });
        const html = `
          <p>New strategy call request</p>
          <p><strong>Name:</strong> ${escapeHtml(name)}<br/>
          <strong>Email:</strong> ${escapeHtml(email)}<br/>
          <strong>Phone:</strong> ${escapeHtml(phone || '')}<br/>
          <strong>Company:</strong> ${escapeHtml(company || '')}</p>
          <p><strong>Preferred:</strong> ${escapeHtml(preferredDate || '')}</p>
          <p><strong>Message:</strong><br/>${escapeHtml(message || '')}</p>
          <p><small>Source: ${escapeHtml(source || 'website')}</small></p>
        `;
        await transporter.sendMail({ from, to: admin, subject: `Strategy call request — ${name}`, html });
      }catch(mailErr){
        // don't fail the whole request if mail fails — log and continue
        console.warn('Strategy call email failed', mailErr.message || mailErr);
      }
    }

    return id;
  }finally{
    client.release();
  }
}

function escapeHtml(s){
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

module.exports = { createStrategyCall };
