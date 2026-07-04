const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

function signBuyerToken(buyerId) {
  return jwt.sign({ buyerId, role: "buyer" }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

async function register(req, res) {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }

  const existing = await pool.query(`SELECT id FROM buyers WHERE email = $1`, [email]);
  if (existing.rowCount > 0) {
    return res.status(409).json({ ok: false, error: "EMAIL_ALREADY_REGISTERED" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO buyers (name, email, phone, password_hash, created_at, updated_at)
     VALUES ($1,$2,$3,$4,NOW(),NOW()) RETURNING id`,
    [name, email, phone || null, passwordHash]
  );
  const buyerId = result.rows[0].id;

  const token = signBuyerToken(buyerId);
  return res.status(201).json({ ok: true, token, buyerId, name, email, phone: phone || null });
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });

  const result = await pool.query(
    `SELECT id, name, email, phone, password_hash FROM buyers WHERE email = $1`,
    [email]
  );
  if (result.rowCount === 0) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });

  const buyer = result.rows[0];
  const valid = await bcrypt.compare(password, buyer.password_hash);
  if (!valid) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });

  await pool.query(`UPDATE buyers SET last_login_at = NOW() WHERE id = $1`, [buyer.id]);

  const token = signBuyerToken(buyer.id);
  return res.json({ ok: true, token, buyerId: buyer.id, name: buyer.name, email: buyer.email, phone: buyer.phone });
}

module.exports = { register, login };
