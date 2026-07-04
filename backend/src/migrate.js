const fs = require("fs");
const path = require("path");
const pool = require("./config/db");

async function migrate() {
  const file = path.join(__dirname, "migrations", "001_init.sql");
  const sql = fs.readFileSync(file, "utf8");
  console.log("Running migration:", file);
  await pool.query(sql);
  console.log("Migration complete.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
