const model = require("../models/roomModels");
require("dotenv").config();

const CreateRoom = async (req, res) => {
  const { name, ownerId } = req.body;

  if (!name || !ownerId) {
    return res.status(400).json({ message: "Name and ownerId are required" });
  }

  try {
    const room = await model.CreateRoom(name, ownerId);
    return res.json({
      message: "Room created successfully",
      link: `https://roomsara.liara.run/Room/${room.roomId}`, // لینک اتاق
      room,
    });
  } catch (error) {
    return res.status(500).send("Internal server error");
  }
};

const GetRoom = async (req, res) => {
  const roomId = req.params.roomId;
  if (!roomId) return res.status(404).send("Please enter the roomID");
  try {
    const result = await model.GetRoom(roomId);
    return res.send(result);
  } catch {
    return res.status(404).send("Error");
  }
};

const DeleteRoom = async (req, res) => {
  const roomId = req.params.roomId;
  const { userId } = req.body; // دریافت userId از بدنه درخواست

  if (!roomId || !userId) {
    return res
      .status(400)
      .json({ message: "Room ID and User ID are required" });
  }

  try {
    // بررسی اینکه کاربر صاحب اتاق است
    const room = await model.GetRoom(roomId);
    if (room && room.owner_id === userId) {
      // حذف اتاق
      await model.DeleteRoom(roomId);
      return res.status(200).json({ message: "Room deleted successfully" });
    }

    return res
      .status(403)
      .json({ message: "Unauthorized: You are not the owner of this room" });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

const GetRoomUsers = async (req, res) => {
  const roomId = req.params.roomId;
  if (!roomId) {
    return res.status(400).json({ message: "Room ID is required" });
  }
  try {
    // بررسی اینکه آیا اتاق وجود دارد
    const room = await model.GetRoom(roomId);
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    // دریافت لیست کاربران
    const users = await model.GetRoomUsers(roomId);
    return res.status(200).json({ roomId, users });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// کنترلر جدید برای میوت/آن‌میوت
const ToggleMuteUser = async (req, res) => {
  const { roomId } = req.params;
  const { targetUserId, mute } = req.body;
  const userId = req.user.id; // از AccessToken می‌گیریم

  try {
    // چک کردن مدیر
    const isAdmin = await model.IsUserAdmin(userId, roomId);
    if (!isAdmin) {
      return res.status(403).json({ message: "فقط مدیر می‌تواند میوت کند" });
    }

    // آپدیت میوت
    const success = await model.ToggleMuteUser(roomId, targetUserId, mute);
    if (!success) {
      return res.status(404).json({ message: "کاربر در اتاق یافت نشد" });
    }

    return res.json({ message: `کاربر ${mute ? "میوت" : "آن‌میوت"} شد` });
  } catch (error) {
    console.error("خطا در میوت/آن‌میوت:", error.message);
    return res.status(500).json({ message: "خطای سرور" });
  }
};

const enablerooms = async (req, res) => {
  const userId = req.params.userId;

  if (!userId) {
    return res.status(400).json({ message: "User ID is required" });
  }

  try {
    // دریافت اتاق‌های متعلق به کاربر
    const rooms = await model.GetUserOwnedRooms(userId);

    // تبدیل خروجی به فرمت خواسته‌شده
    const formattedRooms = rooms.map((room) => ({
      id: room.id.toString(), // تبدیل به رشته برای سازگاری
      name: room.name,
      link: `https://roomsara.liara.run/Room/${room.id}`,
      users: room.users,
    }));

    return res.status(200).json(formattedRooms);
  } catch (error) {
    console.error("خطا در دریافت اتاق‌ها:", error.message);
    return res.status(500).json({ message: "خطای سرور" });
  }
};

module.exports = {
  CreateRoom,
  GetRoom,
  DeleteRoom,
  GetRoomUsers,
  ToggleMuteUser,
  enablerooms,
};
