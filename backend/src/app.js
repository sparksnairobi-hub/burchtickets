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

const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
// verify: rawBodySaver keeps the exact bytes on req.rawBody, needed if you
// add HMAC signature verification in front of any webhook route later.
// limit raised from the 100kb default so base64-encoded event flyers
// (see createEvent's coverImageBase64) fit in a single request.
app.use(express.json({ verify: rawBodySaver, limit: "4mb" }));

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

app.use((req, res) => res.status(404).json({ ok: false, error: "NOT_FOUND" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
});

module.exports = app;
