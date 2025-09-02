const pool = require("../db/MySQL");
const { v4: uuidv4 } = require("uuid");

class RoomModels {
  static CreateRoom = async (name, ownerId) => {
    const roomId = uuidv4(); // تولید یک UUID منحصر به فرد
    const [result] = await pool.query(
      "INSERT INTO rooms (id, name, owner_id) VALUES (?, ?, ?)",
      [roomId, name, ownerId]
    );
    return { roomId, name, ownerId };
  };

  static GetRoom = async (roomId) => {
    const [result] = await pool.query("Select * from rooms where id = ?", [
      roomId,
    ]);
    return result[0];
  };

  static DeleteRoom = async (roomId) => {
    try {
      // حذف پیام‌های مرتبط (در صورت وجود)
      await pool.query("DELETE FROM room_messages WHERE room_id = ?", [roomId]);

      // حذف کاربران مرتبط (در صورت وجود)
      await pool.query("DELETE FROM room_users WHERE room_id = ?", [roomId]);

      // حذف اتاق
      const [result] = await pool.query("DELETE FROM rooms WHERE id = ?", [
        roomId,
      ]);

      if (result.affectedRows === 0) {
        throw new Error("Room not found or already deleted");
      }
    } catch (error) {
      console.error("Error deleting room:", error);
      throw error;
    }
  };

  static CheckUserExists = async (userId) => {
    const [result] = await pool.query("SELECT * FROM users WHERE id = ?", [
      userId,
    ]);
    return result.length > 0; // اگر نتیجه‌ای وجود داشته باشد، کاربر موجود است
  };

  static GetRoomUsers = async (roomId) => {
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.email, u.profile_image
       FROM room_users ru
       JOIN users u ON ru.user_id = u.id
       WHERE ru.room_id = ?`,
      [roomId]
    );
    return users;
  };

  // چک کردن مدیر
  static IsUserAdmin = async (userId, roomId) => {
    const [rows] = await pool.query(
      "SELECT role FROM room_users WHERE user_id = ? AND room_id = ?",
      [userId, roomId]
    );
    return rows.length > 0 && rows[0].is_admin;
  };

  // آپدیت وضعیت میوت
  static ToggleMuteUser = async (roomId, targetUserId, mute) => {
    const [result] = await pool.query(
      "UPDATE room_users SET is_muted = ? WHERE user_id = ? AND room_id = ?",
      [mute, targetUserId, roomId]
    );
    return result.affectedRows > 0;
  };

  // گرفتن وضعیت میوت کاربر
  static GetUserMuteStatus = async (userId, roomId) => {
    const [rows] = await pool.query(
      "SELECT is_muted FROM room_users WHERE user_id = ? AND room_id = ?",
      [userId, roomId]
    );
    return rows.length > 0 ? rows[0].is_muted : false;
  };

  static GetUserOwnedRooms = async (userId) => {
    const [rows] = await pool.query(
      `SELECT r.id, r.name, COUNT(ru.user_id) AS user_count
       FROM rooms r
       LEFT JOIN room_users ru ON r.id = ru.room_id
       WHERE r.owner_id = ?
       GROUP BY r.id, r.name`,
      [userId]
    );

    const roomsWithUsers = rows.map((row) => ({
      id: row.id,
      name: row.name,
      users: row.user_count,
    }));

    return roomsWithUsers;
  };
}

module.exports = RoomModels;
