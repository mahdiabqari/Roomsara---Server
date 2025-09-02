const express = require("express");
const app = express();
const cors = require("cors");
const axios = require("axios");
const compression = require("compression");
require("dotenv").config();
const userRouter = require("./router/userRouter");
const messageRouter = require("./router/messageRouter");
const roomsRoutes = require("./router/roomsRoutes"); // مسیر روتر اتاق‌ها
const pool = require("./db/MySQL");
const socketHandlers = require("./socket/socketHandlers");
const helmet = require("helmet");
const http = require("http");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");

const {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: "0000",
  credentials: {
    accessKeyId: process.env.LIARA_ACCESS_KEY,
    secretAccessKey: process.env.LIARA_SECRET_KEY,
  },
});

// middle wares -----------------------------------------------------
app.use(
  cors({
    origin: ["https://roomsara.liara.run", "http://localhost:3001", null],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);
app.use(express.json());

app.use(compression());

// Routes -----------------------------------------------------
app.use("/users", userRouter);
app.use("/messages", messageRouter);
app.use("/rooms", roomsRoutes);
app.get("/uploads/:imageName", async (req, res) => {
  const imageName = req.params.imageName;

  // فرض کنید فایل‌ها در فضای ابری با نام bucket شما ذخیره می‌شوند
  const bucketUrl = `https://storage.c2.liara.space/roomsara/${imageName}`;

  try {
    // درخواست به فضای ابری برای دریافت تصویر
    const response = await axios.get(bucketUrl, { responseType: "stream" });

    // تنظیم هدرهای پاسخ به‌طور صحیح برای ارسال فایل
    res.setHeader("Content-Type", "image/jpeg"); // می‌توانید نوع تصویر را متناسب با نوع فایل تغییر دهید
    response.data.pipe(res); // ارسال فایل به کاربر
  } catch (error) {
    console.error("Error fetching image from cloud storage:", error);
    res.status(404).json({ message: "Image not found" });
  }
});
app.get("/download-app", async (req, res) => {
  const fileName = "roomsara Demo.apk"; // نام فایل در فضای ابری
  const bucketUrl = `https://storage.c2.liara.space/roomsara/${fileName}`; // لینک فایل در لیارا

  try {
    // ارسال درخواست به فضای ابری برای دریافت فایل
    const response = await axios.get(bucketUrl, { responseType: "stream" });

    // تنظیم هدرهای پاسخ برای دانلود فایل
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/vnd.android.package-archive"); // نوع فایل APK

    // ارسال فایل به کاربر
    response.data.pipe(res);
  } catch (error) {
    console.error("Error fetching APK file from cloud storage:", error);
    res.status(404).json({ message: "File not found" });
  }
});

app.use(helmet());

// Delete the old messages -----------------------------------------------------
const deleteOldMessages = async () => {
  try {
    const result = await pool.query(
      "DELETE FROM messages WHERE timestamp < NOW() - INTERVAL '30 days'"
    );
    console.log(`${result.rowCount} old messages deleted.`);
  } catch (error) {
    console.error("Error deleting old messages:", error);
  }
};
setInterval(deleteOldMessages, 24 * 60 * 60 * 1000);

// Delete room-related data every 24 hours -----------------------------------------------------

const checkData = async () => {
  try {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 ساعت قبل

    // ابتدا پیام‌هایی که قدیمی‌تر از 24 ساعت هستند رو بگیر (برای حذف تصاویر)
    const [oldMessages] = await pool.query(
      "SELECT id, image FROM room_messages WHERE sent_at < ? AND image IS NOT NULL",
      [cutoffDate]
    );

    // حذف تصاویر از S3
    for (const message of oldMessages) {
      const imageUrl = message.image;
      if (!imageUrl) continue;

      const prefix = "https://storage.c2.liara.space/roomsara/room-images/";
      if (!imageUrl.startsWith(prefix)) {
        console.warn(`URL معتبر نیست: ${imageUrl}`);
        continue;
      }

      const fileName = imageUrl.substring(prefix.length);

      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `room-images/${fileName}`,
          })
        );
        console.log(`تصویر حذف شد: room-images/${fileName}`);
      } catch (s3Error) {
        console.error(
          `خطا در حذف تصویر room-images/${fileName}:`,
          s3Error.message
        );
      }
    }

    // حذف پیام‌های قدیمی از دیتابیس
    await pool.query("DELETE FROM room_messages WHERE sent_at < ?", [
      cutoffDate,
    ]);

    // حذف کاربران قدیمی (joined_at بیشتر از 24 ساعت پیش)
    await pool.query("DELETE FROM room_users WHERE joined_at < ?", [
      cutoffDate,
    ]);

    // حذف اتاق‌های قدیمی (created_at بیشتر از 24 ساعت پیش)
    await pool.query("DELETE FROM rooms WHERE created_at < ?", [cutoffDate]);

    // حذف نوت‌های قدیمی (اگر created_at داری، مثلا همین 24 ساعت)
    await pool.query("DELETE FROM notes WHERE created_at < ?", [cutoffDate]);
  } catch (error) {
    return;
  }
};

// اجرا هر 4 ساعت
setInterval(checkData, 4 * 60 * 60 * 1000);

// Creating HTTP server and socket -----------------------------------------------------
const server = http.createServer(app);
const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  reconnection: true, // فعال‌سازی بازنشانی خودکار
  reconnectionAttempts: 5, // تعداد تلاش‌های مجدد
  reconnectionDelay: 1000, // مدت زمان تا تلاش مجدد
  reconnectionDelayMax: 5000, // حداکثر زمان تأخیر بین تلاش‌های مجدد
  randomizationFactor: 0.5, // عامل تصادفی برای تغییر زمان تأخیر
});
io.on("connection", (socket) => {
  // انتقال مدیریت سوکت‌ها به فایل جداگانه
  socketHandlers(socket, io); // فراخوانی تابع مربوط به سوکت‌ها

  socket.on("disconnect", () => {});
});

// limit req -----------------------------------------------------
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقیقه
  max: 100, // حداکثر 100 درخواست در هر بازه
  message: "تعداد درخواست‌های شما بیش از حد مجاز است!",
});
app.use(limiter);

// Starting srver ----------------------------------------------------

const port = process.env.PORT || 5000;
server.listen(port, () => {
  console.log("Server is running on port:", port);
});
