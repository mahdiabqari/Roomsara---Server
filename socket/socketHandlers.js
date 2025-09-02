require("dotenv").config();
const onlineUsers = new Map();
const secretKey = process.env.SECRET_KEY;
const jwt = require("jsonwebtoken");
const pool = require("./../db/MySQL");
const sharp = require("sharp");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const express = require("express");
const { sendPushNotification } = require("./pushService");
const s3 = new S3Client({
  region: "us-east-1", // منطقه شما (بر اساس منطقه‌ای که فضای ابری خود را در آن دارید)
  endpoint: "https://storage.c2.liara.space", // API endpoint لیارا
  credentials: {
    accessKeyId: process.env.LIARA_ACCESS_KEY, // کلید دسترسی لیارا
    secretAccessKey: process.env.LIARA_SECRET_KEY, // کلید مخفی لیارا
  },
});

const rooms = {};

module.exports = (socket, io) => {
  //Authorization ------------------------------------------------------------------------------
  try {
    // 1️⃣ Get Token
    const rawToken = socket.handshake.auth.token;
    if (!rawToken) {
      return socket.disconnect(true);
    }

    // 2️⃣ Remove "Bearer " if exists
    const token = rawToken.startsWith("Bearer ")
      ? rawToken.split(" ")[1]
      : rawToken;

    // 3️⃣ Verify Token
    const decoded = jwt.verify(token, secretKey);
    socket.user = decoded; // Store user info

    // 4️⃣ Handle Messages
    socket.on("send_message", async (data) => {});
  } catch (error) {
    socket.disconnect(true);
  }
  //-----------------------------------------------------------------------------------------------

  // ثبت شناسه کاربر هنگام اتصال
  const userId = socket.handshake.query.userId; // شناسه کاربر از کلاینت
  if (userId && typeof userId === "string") {
    onlineUsers.set(userId, socket.id);

    // ارسال وضعیت آنلاین بودن به سایر کاربران (به‌جز خود کاربر)
    socket.broadcast.emit("user_online_status", { userId, status: "online" });

    // مدیریت قطع اتصال
    socket.on("disconnect", () => {
      onlineUsers.delete(userId); // حذف کاربر از لیست آنلاین‌ها

      // اعلام آفلاین شدن به سایر کاربران
      socket.broadcast.emit("user_online_status", {
        userId,
        status: "offline",
      });
    });
  } else {
  }

  socket.on("join", (userId) => {
    if (userId) {
      socket.join(userId); // اضافه کردن کاربر به اتاق مختص به خودش
      onlineUsers.set(userId, socket.id);
    }
  });

  socket.on("mark_message_as_read", async ({ messageId, receiver_id }) => {
    try {
      const [result] = await pool.query(
        "UPDATE messages SET is_read = 1 WHERE id = ? AND receiver_id = ?",
        [messageId, receiver_id]
      );

      if (result.affectedRows > 0) {
        // در صورت نیاز، می‌توانید به فرستنده نیز اطلاع دهید
        io.to(receiver_id).emit("message_read", { messageId });
      } else {
      }
    } catch (error) {}
  });

  socket.on("mark_all_messages_as_read", async ({ sender_id, receiver_id }) => {
    try {
      // به‌روزرسانی تمام پیام‌ها از sender_id به receiver_id که هنوز خوانده نشده‌اند
      const [result] = await pool.query(
        "UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0",
        [sender_id, receiver_id]
      );

      if (result.affectedRows > 0) {
        // ارسال رویداد برای فرستنده یا گیرنده در صورت نیاز
        io.to(receiver_id).emit("all_messages_read", {
          sender_id,
          receiver_id,
        });
      } else {
      }
    } catch (error) {}
  });

  // دریافت پیام و ارسال آن به گیرنده و فرستنده
  const moment = require("moment-timezone");

  socket.on("send_message", async (data) => {
    const { sender_id, receiver_id, message, reply_to } = data;

    try {
      const iranTime = moment().tz("Asia/Tehran").format("YYYY-MM-DD HH:mm:ss");

      let reply_to_text = null;
      if (reply_to) {
        const [replyMsg] = await pool.query(
          "SELECT message FROM messages WHERE id = ? LIMIT 1",
          [reply_to]
        );
        if (replyMsg.length) {
          reply_to_text = replyMsg[0].message.substring(0, 255);
        }
      }

      const [result] = await pool.query(
        "INSERT INTO messages (sender_id, receiver_id, message, reply_to, reply_to_text, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        [
          sender_id,
          receiver_id,
          message,
          reply_to || null,
          reply_to_text || null,
          iranTime,
        ]
      );

      const [newMessage] = await pool.query(
        `
  SELECT messages.*, users.profile_image, users.name
  FROM messages
  JOIN users ON messages.sender_id = users.id
  WHERE messages.id = ?
        `,
        [result.insertId]
      );

      io.to(sender_id).to(receiver_id).emit("receive_message", newMessage[0]);

      io.to(sender_id).to(receiver_id).emit("friend_meta_update", {
        friendId: sender_id,
        lastMessage: newMessage[0].message,
        timestamp: newMessage[0].timestamp,
      });

      const [receiver] = await pool.query(
        "SELECT device_token FROM users WHERE id = ?",
        [receiver_id]
      );

      if (receiver[0]?.device_token) {
        await sendPushNotification({
          token: receiver[0].device_token,
          title: "پیام جدید",
          body: `${newMessage[0].name}: ${message.substring(0, 50)}...`,
          data: { senderId: sender_id },
        });
      }
    } catch (error) {
      console.error(error);
    }
  });

  socket.on("delete_message", async ({ messageId, sender_id }) => {
    try {
      // دریافت اطلاعات پیام از دیتابیس
      const [messages] = await pool.query(
        "SELECT receiver_id FROM messages WHERE id = ?",
        [messageId]
      );

      if (messages.length === 0) {
        return;
      }

      const receiver_id = messages[0].receiver_id;

      const [result] = await pool.query("DELETE FROM messages WHERE id = ?", [
        messageId,
      ]);

      if (result.affectedRows > 0) {
        // ارسال حذف پیام به هر دو کاربر
        io.to(sender_id).emit("message_deleted", { messageId });
        io.to(receiver_id).emit("message_deleted", { messageId });
      } else {
      }
    } catch (error) {}
  });

  // مدیریت قطع اتصال کاربر
  socket.on("disconnect", () => {
    let userId = null;

    // پیدا کردن کاربری که این socket.id به او تعلق دارد
    for (let [key, value] of onlineUsers.entries()) {
      if (value === socket.id) {
        userId = key;
        onlineUsers.delete(key);
        break;
      }
    }

    if (userId) {
      // اعلام آفلاین بودن به سایر کاربران
      io.emit("user_online_status", { userId, status: "offline" });
    }
  });

  ////Room
  socket.on("join_room", async ({ roomId, userId, options = {} }) => {
    try {
      if (!roomId || !userId) {
        return socket.emit("user_joined", {
          success: false,
          message: "Room ID or User ID is missing",
        });
      }

      const { isManager = false, isAudio = false } = options;

      // بررسی وجود کاربر در دیتابیس
      const [[{ count }]] = await pool.query(
        "SELECT COUNT(*) as count FROM room_users WHERE room_id = ? AND user_id = ?",
        [roomId, userId]
      );

      let userInfo;
      if (count === 0) {
        // دریافت اطلاعات کاربر از دیتابیس
        const [userQuery] = await pool.query(
          "SELECT id, name, email, profile_image FROM users WHERE id = ?",
          [userId]
        );

        if (userQuery.length === 0) {
          return socket.emit("user_joined", {
            success: false,
            message: "User not found",
          });
        }

        userInfo = userQuery[0];

        // اضافه کردن کاربر به جدول room_users
        const [result] = await pool.query(
          "INSERT INTO room_users (room_id, user_id) VALUES (?, ?)",
          [roomId, userId]
        );

        if (result.affectedRows === 0) {
          return socket.emit("user_joined", {
            success: false,
            message: "Failed to add user",
          });
        }
      } else {
      }

      // مقداردهی اولیه اتاق در حافظه اگر وجود نداشته باشد
      if (!rooms[roomId]) {
        const [roomInfo] = await pool.query(
          "SELECT owner_id FROM rooms WHERE id = ?",
          [roomId]
        );

        if (roomInfo.length === 0) {
          return socket.emit("user_joined", {
            success: false,
            message: "Room does not exist",
          });
        }

        rooms[roomId] = {
          users: [],
          managerId: roomInfo[0].owner_id,
          timer: null,
        };
      }

      // بررسی و بروزرسانی اطلاعات کاربر در حافظه
      const existingUserIndex = rooms[roomId].users.findIndex(
        (user) => user.userId === userId
      );

      if (existingUserIndex !== -1) {
        // اگر کاربر از قبل در لیست کاربران بود، فقط `socketId` را بروزرسانی کن
        rooms[roomId].users[existingUserIndex].socketId = socket.id;
      } else {
        // اگر کاربر جدید است، اضافه کن
        rooms[roomId].users.push({ userId, socketId: socket.id, isManager });
      }

      // اگر کاربر مدیر باشد، بروزرسانی مدیر اتاق
      if (isManager) {
        rooms[roomId].managerId = userId;
      }

      // اگر تایمر حذف فعال بود، لغو کن
      if (rooms[roomId].timer) {
        clearTimeout(rooms[roomId].timer);
        rooms[roomId].timer = null;
      }

      // پیوستن کاربر به سوکت
      socket.join(roomId);

      // دریافت اطلاعات کاربر از دیتابیس در صورتی که قبلاً وجود نداشت
      if (!userInfo) {
        const [userQuery] = await pool.query(
          "SELECT id, name, profile_image FROM users WHERE id = ?",
          [userId]
        );
        userInfo = userQuery[0];
      }

      // اطلاع‌رسانی به سایر کاربران که کاربر جدید وارد شده است
      io.to(roomId).emit("user_joined", userInfo);

      socket.emit("user_joined", { success: true });
    } catch (error) {
      socket.emit("user_joined", {
        success: false,
        message: "Error joining room",
      });
    }
  });

  socket.on("leave_room", async (roomId, userId) => {
    try {
      const [roomInfo] = await pool.query(
        "SELECT owner_id FROM rooms WHERE id = ?",
        [roomId]
      );

      if (roomInfo.length === 0) {
        return;
      }

      const ownerId = roomInfo[0].owner_id;

      socket.leave(roomId);

      if (rooms[roomId]) {
        rooms[roomId].users = rooms[roomId].users.filter((id) => id !== userId);

        await pool.query(
          "DELETE FROM room_users WHERE room_id = ? AND user_id = ?",
          [roomId, userId]
        );

        io.emit("user_left", { userId });

        if (rooms[roomId].users.length === 0) {
          startRoomDeletionTimer(roomId);
        }
      } else {
      }
    } catch (error) {}
  });

  socket.on("upload", async (fileInfo) => {
    try {
      // چک کردن حجم فایل (حداکثر 10MB)
      const maxSize = 30 * 1024 * 1024; // 10MB
      if (fileInfo.data.length > maxSize) {
        socket.emit("upload_error", {
          message:
            "حجم تصویر بیش از 30 مگابایت است! لطفاً تصویر کوچکتری انتخاب کنید.",
        });
        return;
      }

      // گرفتن فرمت فایل و اعتبارسنجی
      const fileExtension = fileInfo.name.split(".").pop().toLowerCase();
      const supportedFormats = ["jpg", "jpeg", "png", "webp"];
      if (!supportedFormats.includes(fileExtension)) {
        socket.emit("upload_error", {
          message: "فرمت تصویر پشتیبانی نمی‌شود! فقط JPG، PNG و WebP مجاز است.",
        });
        return;
      }

      // ساخت نام یکتا برای فایل
      const uniqueFileName = `room-images/${Date.now()}-${fileInfo.name}`;

      // تبدیل داده باینری به Buffer
      const fileBuffer = Buffer.from(fileInfo.data);

      // پردازش تصویر با حفظ فرمت
      let resizedImageBuffer;
      try {
        resizedImageBuffer = await sharp(fileBuffer)
          .resize({
            width: 300,
            height: 300,
            fit: "contain", // حفظ نسبت تصویر
            withoutEnlargement: true, // جلوگیری از بزرگ کردن تصاویر کوچک
          })
          .toFormat(fileExtension, {
            quality: fileExtension === "png" ? undefined : 85, // برای PNG کیفیت تغییر نمی‌کنه
          })
          .toBuffer();
      } catch (sharpError) {
        socket.emit("upload_error", {
          message: "خطا در پردازش تصویر! لطفاً تصویر دیگری امتحان کنید.",
        });
        return;
      }

      // آپلود به Liara Object Storage
      const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: uniqueFileName,
        Body: resizedImageBuffer,
        ContentType: `image/${
          fileExtension === "png"
            ? "png"
            : fileExtension === "webp"
            ? "webp"
            : "jpeg"
        }`,
        ACL: "public-read",
      };

      try {
        await s3.send(new PutObjectCommand(params));
      } catch (s3Error) {
        socket.emit("upload_error", {
          message: "خطا در آپلود تصویر به سرور! لطفاً دوباره امتحان کنید.",
        });
        return;
      }

      const imageUrl = `https://storage.c2.liara.space/roomsara/${uniqueFileName}`;

      // ذخیره پیام در دیتابیس
      const { roomId, sender_id, sender_name, message } = fileInfo;
      let result;
      try {
        result = await pool.query(
          "INSERT INTO room_messages (room_id, sender_id, sender_name, message, image) VALUES (?, ?, ?, ?, ?)",
          [roomId, sender_id, sender_name, message || "", imageUrl]
        );
      } catch (dbError) {
        console.error("خطا در ذخیره پیام در دیتابیس:", dbError);
        socket.emit("upload_error", {
          message: "خطا در ذخیره پیام! لطفاً دوباره امتحان کنید.",
        });
        return;
      }

      const messageId = result.insertId;

      // ارسال پیام به کلاینت‌ها
      io.to(roomId).emit("receive_message", {
        id: messageId,
        sender_id,
        sender_name,
        message: message || "",
        image: imageUrl,
      });
    } catch (error) {
      // خطای عمومی
      socket.emit("upload_error", {
        message: "مشکلی پیش آمد! لطفاً دوباره امتحان کنید.",
      });
    }
  });

  // مدیریت ارسال پیام متنی یا ترکیب متن و تصویر
  socket.on(
    "send_message_room",
    async ({ roomId, message, sender_id, sender_name }) => {
      try {
        const result = await pool.query(
          "INSERT INTO room_messages (room_id, sender_id, sender_name, message, image) VALUES (?, ?, ?, ?, ?)",
          [roomId, sender_id, sender_name, message, null]
        );

        const messageId = result.insertId;

        io.to(roomId).emit("receive_message", {
          id: messageId,
          sender_id,
          sender_name,
          message,
          image: null,
        });
      } catch (error) {
        console.error("خطا در ارسال پیام:", error);
      }
    }
  );

  socket.on("remove_user", async ({ roomId, userId }, callback) => {
    try {
      if (!rooms[roomId] || !rooms[roomId].users) {
        return callback({ success: false, message: "Room does not exist." });
      }

      const userIndex = rooms[roomId].users.findIndex(
        (user) => user.userId === userId
      );

      if (userIndex === -1) {
        return callback({ success: false, message: "User not found in room." });
      }

      const [removedUser] = rooms[roomId].users.splice(userIndex, 1);

      // پیام به کاربر حذف‌شده
      io.to(removedUser.socketId).emit("user_kicked");

      // پیام به سایر کاربران
      io.to(roomId).emit("user_removed", userId);

      // حذف کاربر از دیتابیس
      await pool.query(
        "DELETE FROM room_users WHERE room_id = ? AND user_id = ?",
        [roomId, userId]
      );

      // شروع تایمر حذف اتاق در صورت خالی بودن
      if (rooms[roomId].users.length === 0) {
        startRoomDeletionTimer(roomId);
      }

      callback({ success: true });
    } catch (error) {
      callback({ success: false, message: "Failed to remove user." });
    }
  });

  socket.on("get_room_users", async (roomId, callback) => {
    try {
      const [roomUsers] = await pool.query(
        "SELECT user_id FROM room_users WHERE room_id = ?",
        [roomId]
      );

      if (roomUsers.length === 0) {
        return callback({
          success: false,
          message: "No users found in this room",
        });
      }

      const userIds = roomUsers.map((user) => user.user_id);
      const [users] = await pool.query(
        "SELECT id, name, email, profile_image FROM users WHERE id IN (?)",
        [userIds]
      );

      callback({ success: true, users });
    } catch (error) {
      callback({ success: false, message: "Failed to fetch users" });
    }
  });

  socket.on("peer_id", ({ roomId, userId, peerId }) => {
    socket.to(roomId).emit("peer_id", { senderId: userId, peerId });
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      rooms[roomId].users = rooms[roomId].users.filter(
        (id) => id !== socket.id
      );
      if (rooms[roomId].users.length === 0) {
        startRoomDeletionTimer(roomId);
      }
    }
  });

  // مدیریت میوت/آن‌میوت
  socket.on("muteUser", async ({ roomId, targetUserId, mute }) => {
    try {
      const userId = socket.user.id;
      const [rows] = await pool.query(
        "SELECT role FROM room_users WHERE user_id = ? AND room_id = ?",
        [userId, roomId]
      );
      if (rows.length === 0 || !rows[0].is_admin === "admin") {
        socket.emit("error", { message: "فقط مدیر می‌تواند میوت کند" });
        return;
      }

      await pool.query(
        "UPDATE room_users SET is_muted = ? WHERE user_id = ? AND room_id = ?",
        [mute, targetUserId, roomId]
      );

      io.to(roomId).emit("userMuted", { userId: targetUserId, isMuted: mute });
    } catch (error) {
      console.error("خطا در میوت/آن‌میوت:", error.message);
      socket.emit("error", { message: "خطای سرور" });
    }
  });

  const startRoomDeletionTimer = (roomId) => {
    if (!rooms[roomId]) {
      console.error(`Room ${roomId} does not exist in memory.`);
      return;
    }

    // اگر تایمر از قبل تنظیم شده باشد، دوباره تنظیم نکن
    if (rooms[roomId].timer) {
      console.log(`Deletion timer for room ${roomId} is already running.`);
      return;
    }

    // هشدار به مدیر اتاق ۵ دقیقه قبل از حذف
    setTimeout(() => {
      if (rooms[roomId]) {
        const managerId = rooms[roomId].managerId;
        if (managerId) {
          const managerSocket = onlineUsers.get(managerId);
          if (managerSocket) {
            io.to(managerSocket).emit("room_deletion_warning", {
              message: "Your room will be deleted in 5 minutes.",
            });
            console.log(
              `Warning sent to manager ${managerId} for room ${roomId}`
            );
          } else {
            console.warn(`Manager ${managerId} is not online.`);
          }
        }
      }
    }, 3300000); // 55 دقیقه بعد

    // حذف نهایی اتاق بعد از ۱ ساعت
    rooms[roomId].timer = setTimeout(async () => {
      try {
        console.log(`Deleting room ${roomId} from database and memory...`);

        await pool.query("DELETE FROM room_messages WHERE room_id = ?", [
          roomId,
        ]);
        await pool.query("DELETE FROM room_users WHERE room_id = ?", [roomId]);
        await pool.query("DELETE FROM rooms WHERE id = ?", [roomId]);

        delete rooms[roomId];

        io.to(roomId).emit("room_deleted", {
          message: "The room has been deleted.",
        });

        console.log(`Room ${roomId} deleted successfully.`);
      } catch (error) {
        console.error("Error deleting room:", error);
      }
    }, 10000); // 1 ساعت = ۳,۶۰۰,۰۰۰ میلی‌ثانیه
  };
};
