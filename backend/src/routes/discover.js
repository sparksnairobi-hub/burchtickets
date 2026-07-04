const express = require("express");
const { discover } = require("../controllers/discoverController");
const router = express.Router();

router.get("/", discover);

module.exports = router;
