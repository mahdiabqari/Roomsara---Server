const express = require("express");
const router = express.Router();
const controller = require("../controller/roomController"); // کنترلر ایجاد اتاق
const pool = require("../db/MySQL");
const AccessToken = require("../middlewares/auth");

// مسیر ایجاد حذف و اطلاعات اتاق
router.post("/create", AccessToken, controller.CreateRoom);
router.get("/:roomId", AccessToken, controller.GetRoom);
router.delete("/:roomId", AccessToken, controller.DeleteRoom);
router.get("/enablerooms/:userId", AccessToken, controller.enablerooms);

//کاربر ها
router.get("/:roomId/users", AccessToken, controller.GetRoomUsers);

//گرفتن پیام های اتاق هــــا
router.get("/:roomId/messages", AccessToken, async (req, res) => {
  const roomId = req.params.roomId;

  try {
    const [messages] = await pool.query(
      "SELECT id, room_id, sender_id, sender_name, message,image, sent_at FROM room_messages WHERE room_id = ? ORDER BY sent_at ASC",
      [roomId]
    );

    return res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    return res.status(500).json({ message: "Failed to fetch messages" });
  }
});

// مسیر جدید برای میوت/آن‌میوت
router.post("/:roomId/mute", AccessToken, controller.ToggleMuteUser);

module.exports = router;
