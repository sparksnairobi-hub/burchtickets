const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { overview } = require("../controllers/dashboardController");
const router = express.Router();

router.get("/overview", requireAuth, overview);

module.exports = router;
