const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

function signToken({ userId, companyId, role }) {
  return jwt.sign({ userId, companyId, role }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

async function register(req, res) {
  const { companyName, email, password, businessType, mpesaPaybill } = req.body;
  if (!companyName || !email || !password) {
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "EMAIL_ALREADY_REGISTERED" });
    }

    const companyRes = await client.query(
      `INSERT INTO companies (name, email, business_type, mpesa_paybill, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'pending',NOW(),NOW()) RETURNING id`,
      [companyName, email, businessType || "events", mpesaPaybill || null]
    );
    const companyId = companyRes.rows[0].id;

    const passwordHash = await bcrypt.hash(password, 10);
    const userRes = await client.query(
      `INSERT INTO users (company_id, name, email, password_hash, role, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'owner',NOW(),NOW()) RETURNING id`,
      [companyId, companyName, email, passwordHash]
    );

    await client.query("COMMIT");

    const token = signToken({ userId: userRes.rows[0].id, companyId, role: "owner" });
    return res.status(201).json({ ok: true, token, companyId, companyName });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ ok: false, error: "REGISTRATION_FAILED" });
  } finally {
    client.release();
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });

  const userRes = await pool.query(
    `SELECT u.id, u.company_id, u.password_hash, u.role, c.name AS company_name
     FROM users u JOIN companies c ON c.id = u.company_id
     WHERE u.email = $1`,
    [email]
  );
  if (userRes.rowCount === 0) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });

  const user = userRes.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });

  await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

  const token = signToken({ userId: user.id, companyId: user.company_id, role: user.role });
  return res.json({ ok: true, token, companyId: user.company_id, companyName: user.company_name });
}

module.exports = { register, login };
