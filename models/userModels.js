const pool = require("../db/MySQL");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const cron = require("node-cron");

// زمان‌بندی برای اجرای هر روز ساعت ۱۲ شب
cron.schedule(
  "0 0 * * *",
  async () => {
    try {
      // حذف کاربران تأیید نشده قدیمی‌تر از ۲۴ ساعت
      const query = `
      DELETE FROM pending_registrations 
      WHERE created_at < NOW() - INTERVAL 1 DAY
    `;

      const [result] = await pool.query(query);

      console.log(`تعداد رکوردهای حذف شده: ${result.affectedRows}`);
    } catch (error) {
      console.error("خطا در پاکسازی خودکار:", error);
    }
  },
  {
    timezone: "Asia/Tehran", // تنظیم منطقه زمانی به تهران
  }
);

class UserModels {
  static RegisterUser = async (name, email, password) => {
    // انجام عملیات INSERT برای ثبت کاربر
    const [result] = await pool.query(
      `INSERT INTO users (id, name, email, password) VALUES (uuid(), ?, ?, ?)`,
      [name, email, password]
    );

    // بررسی اینکه عملیات INSERT موفقیت‌آمیز بوده است
    if (result.affectedRows > 0) {
      // دریافت شناسه کاربر جدید از LAST_INSERT_ID()
      const [user] = await pool.query(`SELECT id FROM users WHERE email = ?`, [
        email,
      ]);
      return user[0]; // برگرداندن شناسه کاربر
    }

    // در صورت شکست عملیات، مقدار null برگردانده می‌شود
    return null;
  };

  static GetEmailUser = async (email) => {
    const [result] = await pool.query(`SELECT * FROM users WHERE email = ?`, [
      email,
    ]);

    if (result.length === 0) {
      return null;
    }

    return result[0]; // برگشت اولین کاربر پیدا شده
  };

  static GetUserById = async (userId) => {
    const [result] = await pool.query(`SELECT * FROM users WHERE id = ?`, [
      userId,
    ]);
    return result[0];
  };

  static GetNameUser = async (name) => {
    const [result] = await pool.query(`SELECT * FROM users WHERE name = ?`, [
      name,
    ]);
    return result[0];
  };

  static Search = async (name) => {
    const [result] = await pool.query(
      `SELECT * FROM users 
       WHERE name LIKE ? OR email LIKE ? 
       LIMIT 10;`, // محدود به 10 نتیجه
      [`%${name}%`, `%${name}%`] // ارسال دو پارامتر
    );
    return result;
  };

  static getUsersWithMessages = async (userId) => {
    const query = `SELECT 
    u.id,
    u.name,
    u.email,
    u.profile_image,
    MAX(m_last.message) AS last_message, -- جایگزینی ANY_VALUE
    MAX(m_last.timestamp) AS last_message_time -- جایگزینی ANY_VALUE
FROM users u
INNER JOIN (
    SELECT 
        CASE 
            WHEN sender_id = ? THEN receiver_id 
            ELSE sender_id 
        END AS partner_id,
        MAX(timestamp) AS max_timestamp
    FROM messages
    WHERE sender_id = ? OR receiver_id = ?
    GROUP BY partner_id
) AS last_conversation ON u.id = last_conversation.partner_id
INNER JOIN messages m_last 
    ON (m_last.sender_id = u.id OR m_last.receiver_id = u.id)
    AND (m_last.sender_id = ? OR m_last.receiver_id = ?)
    AND m_last.timestamp = last_conversation.max_timestamp
WHERE u.id != ? -- حذف کاربر جاری از لیست
GROUP BY u.id
ORDER BY last_conversation.max_timestamp DESC;
`;

    const [result] = await pool.query(query, [
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
    ]);
    return result;
  };

  static ChangePassword = async (userId, currentPassword, newPassword) => {
    // دریافت رمز عبور فعلی کاربر از پایگاه داده
    const getPasswordQuery = `
        SELECT password FROM users
        WHERE id = ?
    `;
    const [user] = await pool.query(getPasswordQuery, [userId]);

    // بررسی اینکه آیا کاربر پیدا شد یا خیر
    if (user.length === 0) {
      throw new Error("User not found.");
    }

    const storedPassword = user[0].password;

    // مقایسه رمز عبور فعلی وارد شده با رمز ذخیره شده
    const isMatch = await bcrypt.compare(currentPassword, storedPassword);
    if (!isMatch) {
      throw new Error("Current password is incorrect.");
    }
    // به‌روزرسانی رمز عبور در پایگاه داده
    const updatePasswordQuery = `
        UPDATE users
        SET password = ?
        WHERE id = ?
    `;
    const [result] = await pool.query(updatePasswordQuery, [
      newPassword,
      userId,
    ]);

    return result; // بازگشت نتیجه کوئری
  };

  static ChangeName = async (userId, NewUserName) => {
    const result = await pool.query("Update users SET name = ? where id = ?", [
      NewUserName,
      userId,
    ]);
    return result;
  };

  static async ChangeProfile(userId, profileImagePath) {
    const query = "UPDATE users SET profile_image = ? WHERE id = ?";
    const [result] = await pool.query(query, [profileImagePath, userId]);
    return result;
  }

  static SaveResetCode = async (email, resetCode, expiresAt) => {
    const query = `
        INSERT INTO password_resets (email, reset_code, expires_at)
        VALUES (?, ?, ?)
    `;
    const [result] = await pool.query(query, [email, resetCode, expiresAt]);
    return result;
  };

  static VerifyResetCode = async (email, resetCode) => {
    const query = `
      SELECT * FROM password_resets
      WHERE email = ? AND reset_code = ? AND expires_at > NOW()
    `;
    const [result] = await pool.query(query, [email, resetCode]);
    return result[0];
  };

  static ChangePasswordByEmail = async (email, hashedPassword) => {
    const query = `
      UPDATE users SET password = ? WHERE email = ?
    `;
    const [result] = await pool.query(query, [hashedPassword, email]);
    return result;
  };

  static RemoveResetCode = async (email) => {
    const query = `
        DELETE FROM password_resets WHERE email = ?
    `;
    await pool.query(query, [email]);
  };

  // Verify Email

  static CheckPendingEmail = async (email) => {
    const [result] = await pool.query(
      "SELECT * FROM pending_registrations WHERE email = ?",
      [email]
    );
    return result[0];
  };

  static SavePendingRegistration = async (
    name,
    email,
    hashedPassword,
    verificationCode,
    expiresAt
  ) => {
    const [result] = await pool.query(
      `INSERT INTO pending_registrations 
      (id, email, name, password, verification_code, expires_at) 
      VALUES (UUID(), ?, ?, ?, ?, ?)`,
      [email, name, hashedPassword, verificationCode, expiresAt]
    );
    return result;
  };

  static GetPendingRegistration = async (email, code) => {
    const [result] = await pool.query(
      `SELECT * FROM pending_registrations 
      WHERE email = ? AND verification_code = ? AND expires_at > NOW()`,
      [email, code]
    );
    return result[0];
  };

  static ActivateUser = async (pendingUser) => {
    // ایجاد شناسه جدید برای کاربر اصلی
    const userId = uuidv4(); // یا استفاده از UUID() در SQL

    // انتقال داده به جدول users
    const [result] = await pool.query(
      `INSERT INTO users (id, name, email, password) 
      VALUES (?, ?, ?, ?)`,
      [userId, pendingUser.name, pendingUser.email, pendingUser.password]
    );

    // حذف از جدول موقت
    await pool.query(`DELETE FROM pending_registrations WHERE email = ?`, [
      pendingUser.email,
    ]);

    // بازگرداندن شناسه کاربر جدید
    return userId;
  };
}

module.exports = UserModels;
