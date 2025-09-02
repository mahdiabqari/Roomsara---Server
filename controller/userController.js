const joi = require("joi");
const model = require("../models/userModels");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const sharp = require("sharp");
const pool = require("./../db/MySQL");
require("dotenv").config();
const nodemailer = require("nodemailer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(process.env.Google_AUTH_ANDROID);

const s3 = new S3Client({
  region: "us-east-1", // منطقه شما (بر اساس منطقه‌ای که فضای ابری خود را در آن دارید)
  endpoint: "https://storage.c2.liara.space", // API endpoint لیارا
  credentials: {
    accessKeyId: process.env.LIARA_ACCESS_KEY, // کلید دسترسی لیارا
    secretAccessKey: process.env.LIARA_SECRET_KEY, // کلید مخفی لیارا
  },
});

const sendVerificationEmail = async (email, verificationCode) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "rooomsara@gmail.com",
        pass: "egfe mwku ofgu nhzc",
      },
    });

    const mailOptions = {
      from: "RooomSara@gmail.com",
      to: email,
      subject: "تأیید ایمیل ثبت‌نام در روم سرا",
      html: `
        <div style="
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background-color: #f5f7fa;
          padding: 40px 20px;
          text-align: center;
        ">
          <!-- هدر -->
          <div style="
            background: linear-gradient(135deg, #005f73, #3e5f9c);
            padding: 30px;
            border-radius: 15px 15px 0 0;
          ">
            <h1 style="
              color: white;
              font-size: 28px;
              margin: 0;
              font-weight: bold;
            ">
              تأیید ایمیل
            </h1>
            <p style="
              font-size: 16px;
              color: rgba(255, 255, 255, 0.9);
              margin-top: 10px;
            ">
              برای تکمیل ثبت‌نام در روم سرا، کد زیر را وارد کنید
            </p>
          </div>
    
          <!-- بدنه اصلی -->
          <div style="
            background-color: white;
            padding: 30px;
            border-radius: 0 0 15px 15px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
          ">
            <!-- کد تأیید -->
            <div style="
              background-color:rgb(226, 163, 48);
              color: white;
              font-size: 32px;
              font-weight: bold;
              padding: 20px;
              border-radius: 10px;
              margin: 20px 0;
              display: inline-block;
              letter-spacing: 5px;
            ">
              ${verificationCode}
            </div>
    
            <!-- متن راهنما -->
            <p style="
              font-size: 14px;
              color: #666;
              margin-top: 20px;
            ">
              این کد تا ۱۰ دقیقه معتبر است. در صورت عدم درخواست، این ایمیل را نادیده بگیرید.
            </p>
    
          </div>
    
          <!-- فوتر -->
          <div style="
            margin-top: 30px;
            font-size: 12px;
            color: #999;
          ">
            <p>این ایمیل به صورت خودکار ارسال شده است. لطفاً به آن پاسخ ندهید.</p>
            <p>© 2025 روم سرا. تمام حقوق محفوظ است.</p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("Error sending verification email:", error);
    throw error;
  }
};

const login = async (req, res, next) => {
  const dispatch = {
    email: joi.string().email().required(),
    password: joi.string().required(),
  };

  const check = joi.object(dispatch).validate(req.body);
  if (check.error) {
    return res.status(401).send("اطلاعات کامل نیست");
  }

  try {
    // بررسی وجود کاربر با ایمیل
    const checkuser = await model.GetEmailUser(req.body.email);
    if (!checkuser) {
      return res.status(404).send("لطفا ابتدا ثبت نام کنید");
    }

    // بررسی رمز عبور
    const isPasswordValid = await bcrypt.compare(
      req.body.password,
      checkuser.password
    );
    if (!isPasswordValid) {
      return res.status(401).send("رمز عبور اشتباه است");
    }

    // ایجاد توکن
    const token = jwt.sign({ id: checkuser.id }, process.env.SECRET_KEY);

    return res
      .header("Authorization", token)
      .json({ id: checkuser.id, message: "خوش آمدید" });
  } catch (error) {
    next(error);
  }
};

const checkGoogleAuth = async (req, res) => {
  const { id_token } = req.body;

  if (!id_token) {
    return res.status(400).json({ message: "توکن گوگل ارسال نشده" });
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload?.email;
    const name = payload?.name;

    if (!email) {
      return res.status(400).json({ message: "ایمیل معتبر دریافت نشد" });
    }

    const user = await model.GetEmailUser(email);

    if (user) {
      const token = jwt.sign({ id: user.id }, process.env.SECRET_KEY);
      return res
        .header("Authorization", token)
        .json({ success: true, registered: true, id: user.id });
    } else {
      return res.status(200).json({
        success: true,
        registered: false,
        needInfo: true,
        email,
        name,
      });
    }
  } catch (err) {
    console.error("🔴 Google Auth Error:", err);
    return res.status(500).json({ message: "خطای اعتبارسنجی گوگل" });
  }
};

const completeGoogleRegister = async (req, res) => {
  const { email, name, password } = req.body;

  if (!email || !name || !password) {
    return res
      .status(400)
      .json({ message: "نام، ایمیل و رمز عبور الزامی است" });
  }

  try {
    // دوباره بررسی کن کاربر ثبت نشده باشه (برای امنیت)
    const existing = await model.GetEmailUser(email);
    if (existing) {
      return res.status(409).json({ message: "این ایمیل قبلاً ثبت شده است" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await model.RegisterUser(name, email, hashed);

    if (!user) {
      return res.status(500).json({ message: "ثبت‌نام ناموفق بود" });
    }

    const token = jwt.sign({ id: user.id }, process.env.SECRET_KEY);
    return res.header("Authorization", token).json({
      success: true,
      message: "ثبت‌نام با موفقیت انجام شد",
      id: user.id,
    });
  } catch (err) {
    console.error("🔴 Register Error:", err);
    return res.status(500).json({ message: "خطا در ثبت‌نام" });
  }
};

const SearchUsers = async (req, res, next) => {
  try {
    const result = await model.Search(req.query.name);
    if (result.length > 0) {
      return res.json(result);
    } else {
      return res.status(404).send("کاربری پیدا نشد");
    }
  } catch (error) {
    return res.status(500).send("Internal server error");
  }
};

const Changepass = async (req, res, next) => {
  try {
    const { userId, newPassword, currentPassword } = req.body;

    // بررسی ورودی‌ها
    if (!userId || !newPassword) {
      return res
        .status(400)
        .json({ message: "User ID and new password are required." });
    }

    // هش کردن رمز عبور جدید
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // به‌روزرسانی رمز عبور در پایگاه داده
    const result = await model.ChangePassword(
      userId,
      currentPassword,
      hashedPassword
    );

    // بررسی نتیجه به‌روزرسانی
    if (result.affectedRows > 0) {
      res.status(200).json({ message: "Password updated successfully." });
    } else {
      res.status(404).json({ message: "User not found." });
    }
  } catch (error) {
    next(error); // ارسال خطا به هندلر عمومی خطاها
  }
};

const ChangeName = async (req, res, next) => {
  const userId = req.body.userId;
  const NewUserName = req.body.NewUserName;
  try {
    if (!userId || !NewUserName) {
      return res.status(404).send("Please Complete the information"); // استفاده از return
    }

    const result = await model.ChangeName(userId, NewUserName);
    if (result) {
      return res.send("userName has Changed successfully!"); // استفاده از return
    } else {
      return res.status(500).send("Something went wrong!!!"); // استفاده از return
    }
  } catch (error) {
    res.status(500).send("Something went wrong!!!"); // ارسال پیام خطا به کلاینت
  }
};

const getUsersWithMessages = async (req, res, next) => {
  try {
    const result = await model.getUsersWithMessages(req.params.userId);
    return res.json(result);
  } catch (error) {
    return res.status(500).send("Internal server error");
  }
};

const ChangeProfile = async (req, res) => {
  const userId = req.body.userId;

  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded!" });
  }

  // تولید نام فایل یونیک
  const uniqueFileName = `${Date.now()}-${req.file.originalname}`;

  // تغییر اندازه و فشرده‌سازی تصویر
  const resizedImageBuffer = await sharp(req.file.buffer)
    .resize(150, 150)
    .jpeg({ quality: 90 })
    .toBuffer();

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: uniqueFileName,
    Body: resizedImageBuffer,
    ContentType: "image/jpeg",
    ACL: "public-read",
  };

  try {
    // آپلود به فضای ابری (لیارا یا AWS)
    const s3Response = await s3.send(new PutObjectCommand(params));
    const fileUrl = `uploads/${uniqueFileName}`;

    // به‌روزرسانی مسیر تصویر در دیتابیس
    const result = await model.ChangeProfile(userId, fileUrl);

    if (result.affectedRows > 0) {
      return res.json({
        message: "Profile image updated successfully!",
        imagePath: fileUrl,
      });
    } else {
      return res.status(404).json({ message: "User not found." });
    }
  } catch (error) {
    return res.status(500).json({ message: "Something went wrong!" });
  }
};

const GetUserById = async (req, res) => {
  const id = req.params.userId;
  if (!id) return res.status(404).send("NotFOUND");
  try {
    const result = await model.GetUserById(id);
    return res.send(result);
  } catch {
    return res.status(404).send("Error");
  }
};

const SendResetCode = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  try {
    const user = await model.GetEmailUser(email);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 3 دقیقه انقضاء

    await model.SaveResetCode(email, resetCode, expiresAt);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "rooomsara@gmail.com",
        pass: "egfe mwku ofgu nhzc",
      },
    });

    const mailOptions = {
      from: "RooomSara@gmail.com",
      to: email,
      subject: "کد بازیابی رمز عبور",
      html: `
        <style>
          @import url('https://cdn.jsdelivr.net/gh/Fariborz/webfonts@1.0.0/fonts/iran-sans/font-face.css');
          body, p, h1, h2, h3, h4, h5 {
            font-family: 'IranSans', sans-serif !important;
          }
        </style>
        <div style="background-color: #f4f7fb; padding: 20px; text-align: center; color: #333; font-family: 'IranSans', sans-serif; border-radius: 10px; max-width: 600px; margin: auto;">
          <div style="background-color: #5a8fdb; padding: 20px; border-radius: 10px;">
            <h1 style="color: white; font-size: 28px; margin: 0; font-weight: bold;">درخواست بازیابی رمز عبور</h1>
            <p style="font-size: 18px; color: white; margin-top: 10px;">ما درخواست بازیابی رمز عبور شما را دریافت کردیم. برای بازنشانی رمز عبور خود از کد زیر استفاده کنید.</p>
            <div style="background-color: #ffffff; color: #5a8fdb; padding: 15px; font-size: 24px; font-weight: bold; margin-top: 20px; border-radius: 5px;">
              ${resetCode}
            </div>
            <p style="font-size: 16px; color: white; margin-top: 20px;">این کد تا ۳ دقیقه دیگر منقضی می‌شود. اگر شما این درخواست را ارسال نکردید، می‌توانید این ایمیل را نادیده بگیرید.</p>
            <p style="font-size: 14px; color: white; margin-top: 20px;">در صورت نیاز به کمک بیشتر می‌توانید به ما از طریق ایمیل <a href="mailto:support@roomsara.com" style="color: #ffffff; text-decoration: underline;">support@roomsara.com</a> تماس بگیرید.</p>
          </div>
          <footer style="font-size: 12px; color: #888888; margin-top: 30px;">
            <p>&copy; 2025 RooomSara, کلیه حقوق محفوظ است.</p>
          </footer>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    return res.json({ message: "Reset code sent successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error." });
  }
};

const ResetPassword = async (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return res
      .status(400)
      .json({ message: "Email and new password are required." });
  }

  try {
    // رمز عبور جدید را هش می‌کنیم
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const result = await model.ChangePasswordByEmail(email, hashedPassword);

    if (result.affectedRows > 0) {
      return res.json({ message: "Password updated successfully." });
    } else {
      return res.status(500).json({ message: "Failed to update password." });
    }
  } catch (error) {
    return res.status(500).json({ message: "Internal server error." });
  }
};

const VerifyResetCode = async (req, res) => {
  const { email, resetCode } = req.body;

  if (!email || !resetCode) {
    return res
      .status(400)
      .json({ message: "Email and reset code are required." });
  }

  try {
    const isValid = await model.VerifyResetCode(email, resetCode);

    if (!isValid) {
      return res
        .status(400)
        .json({ message: "Invalid or expired reset code." });
    }

    return res.json({ message: "Reset code is valid." });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error." });
  }
};

const DeviceTokenCode = async (req, res) => {
  const { userId, token } = req.body;

  if (!userId || !token) return res.status(400).json({ error: "Invalid data" });

  try {
    await pool.query("UPDATE users SET device_token = ? WHERE id = ?", [
      token,
      userId,
    ]);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
};

// userController.js
const register = async (req, res) => {
  const schema = joi.object({
    name: joi.string().min(4).max(25).required().messages({
      "string.min": "نام باید حداقل ۴ کاراکتر باشد",
      "string.max": "نام باید حداکثر ۲۵ کاراکتر باشد",
    }),
    email: joi.string().email().required(),
    password: joi.string().min(6).max(45).required(),
  });
  const { name, email, password } = req.body;

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).send(error.details[0].message);
  }

  try {
    // ✅ بررسی ایمیل در جدول کاربران ثبت شده
    const existingUser = await model.GetEmailUser(email);
    if (existingUser) {
      return res.status(400).json("این ایمیل قبلاً ثبت شده است");
    }

    // تولید کد تأیید
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000
    ).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 دقیقه

    // ذخیره در جدول موقت
    const hashedPassword = await bcrypt.hash(password, 10);
    await model.SavePendingRegistration(
      name,
      email,
      hashedPassword,
      verificationCode,
      expiresAt
    );

    // ارسال ایمیل
    await sendVerificationEmail(email, verificationCode);

    res.json({
      success: true,
      message: "کد تأیید به ایمیل شما ارسال شد",
      email: email,
    });
  } catch (error) {
    res.status(500).send("خطای سرور");
  }
};

const verifyEmail = async (req, res) => {
  const schema = joi.object({
    email: joi.string().email().required(),
    code: joi.string().length(6).required(),
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).send(error.details[0].message);
  }

  try {
    const { email, code } = req.body;

    // 1. بررسی وجود در جدول موقت
    const pendingUser = await model.GetPendingRegistration(email, code);
    if (!pendingUser) {
      return res.status(400).send("کد تأیید نامعتبر یا منقضی شده است");
    }

    // 2. انتقال به جدول اصلی و دریافت شناسه جدید
    const userId = await model.ActivateUser(pendingUser);

    // 3. دریافت اطلاعات کاربر از جدول اصلی
    const user = await model.GetEmailUser(email);
    if (!user) {
      return res.status(500).send("خطا در بازیابی اطلاعات کاربر");
    }

    // 4. تولید توکن با شناسه اصلی
    const token = jwt.sign({ id: user.id }, process.env.SECRET_KEY);

    // 5. پاسخ به کلاینت
    res.header("Authorization", token).json({
      success: true,
      message: "حساب شما با موفقیت فعال شد",
      userId: user.id,
      email: user.email,
      name: user.name,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("خطای سرور");
  }
};

module.exports = {
  register,
  login,
  SearchUsers,
  getUsersWithMessages,
  Changepass,
  ChangeName,
  ChangeProfile,
  GetUserById,
  SendResetCode,
  ResetPassword,
  VerifyResetCode,
  sendVerificationEmail,
  verifyEmail,
  DeviceTokenCode,
  checkGoogleAuth,
  completeGoogleRegister,
};
