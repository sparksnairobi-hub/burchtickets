const express = require("express");
const { requireAuth } = require("../middleware/auth");
const {
  createEvent, publishEvent, listMyEvents, listPublicEvents, getPublicEvent, addTier,
} = require("../controllers/eventController");
const router = express.Router();

router.get("/", listPublicEvents);
router.get("/:slug/public", getPublicEvent);

router.post("/", requireAuth, createEvent);
router.get("/mine", requireAuth, listMyEvents);
router.patch("/:eventId/publish", requireAuth, publishEvent);
router.post("/:eventId/tiers", requireAuth, addTier);

module.exports = router;
