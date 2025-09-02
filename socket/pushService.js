const fetch = require("node-fetch");
const pool = require("./../db/MySQL");

// کش برای ذخیره وضعیت آنلاین کاربران
const userStatusCache = new Map();
const CACHE_TTL = 30000; // 30 ثانیه

// تابع بهینه‌شده ارسال نوتیفیکیشن
exports.sendPushNotification = async ({ token, title, body, data }) => {
  if (!token) {
    console.log("No device token provided");
    return;
  }

  try {
    // بررسی کش قبل از درخواست به دیتابیس
    const cachedStatus = userStatusCache.get(token);
    const isUserOnline = cachedStatus?.status === "online";

    if (cachedStatus && Date.now() - cachedStatus.timestamp < CACHE_TTL) {
      if (isUserOnline) {
        console.log(`User is online (cached), skipping notification`);
        return;
      }
    } else {
      // اگر داده در کش نیست یا منقضی شده، از دیتابیس چک کنیم
      const [userStatus] = await pool.query(
        "SELECT is_online, last_active FROM users WHERE device_token = ?",
        [token]
      );

      const isOnline =
        userStatus[0]?.is_online ||
        (userStatus[0]?.last_active &&
          Date.now() - new Date(userStatus[0].last_active).getTime() < 60000);

      // آپدیت کش
      userStatusCache.set(token, {
        status: isOnline ? "online" : "offline",
        timestamp: Date.now(),
      });

      if (isOnline) {
        console.log(`User is online, skipping notification`);
        return;
      }
    }

    // محدود کردن طول متن نوتیفیکیشن
    const trimmedBody =
      body.length > 100 ? `${body.substring(0, 97)}...` : body;

    // تنظیمات پیشرفته نوتیفیکیشن
    const notificationPayload = {
      to: token,
      title: title || "پیام جدید",
      body: trimmedBody,
      data: {
        ...data,
        timestamp: Date.now(),
      },
      sound: "default",
      channelId: "messages",
      priority: "high",
      ttl: 3600, // 1 hour
      expiration: Math.floor(Date.now() / 1000) + 3600,
      badge: 1,
    };

    // ارسال با timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(notificationPayload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `Push API error: ${errorData.message || response.statusText}`
      );
    }

    const result = await response.json();
    console.log("Expo push result:", result); // 👈 اینو اضافه کن
    console.log("Sending push to token:", receiver[0].device_token);

    // مدیریت پاسخ Expo
    if (result.data?.status === "error") {
      if (result.data.message.includes("DeviceNotRegistered")) {
        // حذف توکن نامعتبر از دیتابیس
        await pool.query(
          "UPDATE users SET device_token = NULL WHERE device_token = ?",
          [token]
        );
        userStatusCache.delete(token);
      }
      console.error(`Expo error: ${result.data.message}`);
    }
  } catch (error) {
    console.error("Error in sendPushNotification:", error.message);

    // بازنشانی کش در صورت خطا
    if (error.message.includes("NetworkError")) {
      userStatusCache.delete(token);
    }
  }
};

// تابع پاکسازی دوره‌ای کش
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of userStatusCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      userStatusCache.delete(token);
    }
  }
}, 60000); // هر 1 دقیقه
