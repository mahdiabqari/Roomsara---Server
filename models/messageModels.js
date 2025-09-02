const pool = require("../db/MySQL");
const { v4: uuidv4 } = require("uuid");

class MessageModels {
  static async Send(sender_id, receiver_id, message, reply_to = null) {
    const query = `
      INSERT INTO messages (sender_id, receiver_id, message, reply_to, timestamp)
      VALUES (?, ?, ?, ?, NOW());
    `;
    const [result] = await pool.execute(query, [
      sender_id,
      receiver_id,
      message,
      reply_to,
    ]);
    return result;
  }

  static Recive = async (senderId, receiverId, limit = 15, offset = 0) => {
    const [result] = await pool.query(
      `SELECT * FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
      [senderId, receiverId, receiverId, senderId, limit, offset]
    );
    return result;
  };

  static Delete = async (messageId) => {
    const [result] = await pool.query(`DELETE FROM messages WHERE id = ?`, [
      messageId,
    ]);
    return result;
  };

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
    return result;
  };

  static getUnreadMessagesByReceiver = async (receiverId) => {
    const query = `
      SELECT sender_id, COUNT(*) AS count
      FROM messages
      WHERE receiver_id = ? AND is_read = 0
      GROUP BY sender_id
    `;
    const [rows] = await pool.query(query, [receiverId]);
    return rows;
  };

  //

  static getFriendNotes = async (userId, friendIds) => {
    if (!friendIds.length) return [];

    const query = `
      SELECT u.id AS user_id, u.name, u.profile_image, n.note
      FROM notes n
      JOIN users u ON n.user_id = u.id
      WHERE n.user_id IN (?) 
    `;

    const [rows] = await pool.query(query, [friendIds]);
    return rows;
  };

  static upsertNote = async (userId, note) => {
    const query = `
      INSERT INTO notes (user_id, note)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE note = VALUES(note), created_at = CURRENT_TIMESTAMP
    `;
    await pool.query(query, [userId, note]);
  };

  static deleteNoteByUserId = async (userId) => {
    const query = "DELETE FROM notes WHERE user_id = ?";
    const [result] = await pool.query(query, [userId]);
    return result;
  };
}

module.exports = MessageModels;
