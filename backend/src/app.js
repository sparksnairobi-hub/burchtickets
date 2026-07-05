const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { rawBodySaver } = require("./middleware/webhook");
const authRoutes = require("./routes/auth");
const eventRoutes = require("./routes/events");
const checkoutRoutes = require("./routes/checkout");
const paymentRoutes = require("./routes/payments");
const dashboardRoutes = require("./routes/dashboard");
const ticketRoutes = require("./routes/tickets");
const discoverRoutes = require("./routes/discover");
const buyerAuthRoutes = require("./routes/buyerAuth");
const buyerRoutes = require("./routes/buyer");
const strategyCallRoutes = require("./routes/strategyCall");
const aiRoutes = require("./routes/ai");
const rateLimiter = require("./middleware/rateLimiter");

const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
app.use(express.json({ verify: rawBodySaver, limit: "4mb" }));

// global rate limiter (lightweight) — uses Redis if REDIS_URL set, otherwise in-memory
app.use(rateLimiter);

app.get("/api/health", (req, res) => res.json({ ok: true, service: "burchtickets-backend" }));

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/discover", discoverRoutes);
app.use("/api/buyer-auth", buyerAuthRoutes);
app.use("/api/buyer", buyerRoutes);
app.use("/api/strategy-call", strategyCallRoutes);
app.use("/api/ai", aiRoutes);

app.use((req, res) => res.status(404).json({ ok: false, error: "NOT_FOUND" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
});

module.exports = app;
