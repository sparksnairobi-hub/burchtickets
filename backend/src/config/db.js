const { Pool } = require("pg");
require("dotenv").config();

// Hosted Postgres (Neon, Supabase, RDS...) generally requires SSL; a local
// dev database usually doesn't support it. Set PGSSL=true when pointing at
// a hosted database. rejectUnauthorized:false is standard for these
// providers' self-signed intermediate certs.
const useSSL = process.env.PGSSL === "true";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error", err);
});

module.exports = pool;
