const express = require("express");
const { downloadTicketPdf } = require("../controllers/ticketController");
const router = express.Router();

router.get("/:code/pdf", downloadTicketPdf);

module.exports = router;
