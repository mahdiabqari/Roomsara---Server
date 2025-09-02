const express = require("express");
const Router = express.Router();
const MessageController = require("../controller/messageController");
const AccessToken = require("../middlewares/auth");

Router.post("/send", AccessToken, MessageController.Sendmessage);
Router.get(
  "/get/:senderId/:receiverId",
  AccessToken,
  MessageController.Recivemessage
);
Router.delete("/delete", AccessToken, MessageController.DeleteMessage);

Router.get("/unread/:userId", AccessToken, MessageController.getUnreadMessages);

Router.post(
  "/take-note/:userId",
  AccessToken,
  MessageController.createOrUpdateNote
);

Router.delete("/delete-note/:userId", MessageController.deleteNote);

Router.post(
  "/friends-notes/:userId",
  AccessToken,
  MessageController.getFriendNotes
);

module.exports = Router;
