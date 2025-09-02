const model = require("../models/messageModels");
require("dotenv").config();

const Sendmessage = async (req, res) => {
  const { sender_id, receiver_id, message, reply_to } = req.body;

  try {
    const result = await pool.query(
      "INSERT INTO messages (sender_id, receiver_id, message, reply_to) VALUES (?, ?, ?, ?)",
      [sender_id, receiver_id, message, reply_to || null]
    );

    res.status(201).json({
      id: result.insertId,
      sender_id,
      receiver_id,
      message,
      reply_to,
      timestamp: new Date(),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to save message" });
  }
};

const DeleteMessage = async (req, res) => {
  const { messageId } = req.body;

  try {
    const result = await model.Delete(messageId);
    if (result.affectedRows > 0) {
      return res.status(200).send("Message deleted successfully");
    } else {
      return res.status(404).send("Message not found");
    }
  } catch (error) {
    return res.status(500).send("Internal server error");
  }
};

const Recivemessage = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 15;
    const offset = parseInt(req.query.offset) || 0;

    const result = await model.Recive(
      req.params.senderId,
      req.params.receiverId,
      limit,
      offset
    );

    if (result.length > 0) {
      return res.json(result);
    } else {
      return res.status(404).send("No messages found");
    }
  } catch (error) {
    return res.status(500).send("Internal server error");
  }
};

const getUnreadMessages = async (req, res) => {
  try {
    const { userId } = req.params;

    const unreadMessages = await model.getUnreadMessagesByReceiver(userId);

    const result = {};
    unreadMessages.forEach((row) => {
      result[row.sender_id] = row.count;
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
};

//

const getFriendNotes = async (req, res) => {
  try {
    const { userId } = req.params;

    // فرض بر اینه که لیست دوستان از کلاینت فرستاده بشه (از کش)
    const { friendIds } = req.body;

    if (!Array.isArray(friendIds) || !friendIds.length)
      return res.status(400).json({ error: "No friends provided" });

    const notes = await model.getFriendNotes(userId, friendIds);
    res.status(200).json(notes);
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const createOrUpdateNote = async (req, res) => {
  try {
    const { userId } = req.params;
    const { note } = req.body;

    if (!note || !note.trim()) {
      return res.status(400).json({ error: "Note cannot be empty." });
    }

    await model.upsertNote(userId, note);

    res.status(200).json({ message: "Note saved successfully." });
  } catch (error) {
    res.status(500).json({ error: "Internal server error." });
  }
};

const deleteNote = async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await model.deleteNoteByUserId(userId);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Note not found" });
    }

    res.json({ message: "Note deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = {
  Sendmessage,
  Recivemessage,
  DeleteMessage,
  getUnreadMessages,
  getFriendNotes,
  createOrUpdateNote,
  deleteNote,
};
