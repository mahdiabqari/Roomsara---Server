const express = require("express");
const Router = express.Router();
const UserController = require("../controller/userController");
const multer = require("multer");
const AccessToken = require("../middlewares/auth");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
require("dotenv").config();
const storage = multer.memoryStorage(); // استفاده از حافظه به جای ذخیره فایل‌ها به صورت محلی
const upload = multer({ storage });

const s3 = new S3Client({
  region: "us-east-1", // منطقه خود را تنظیم کنید
  endpoint: "https://storage.c2.liara.space", // API endpoint لیارا
  credentials: {
    accessKeyId: process.env.LIARA_ACCESS_KEY,
    secretAccessKey: process.env.LIARA_SECRET_KEY,
  },
});

Router.post(
  "/secret/upload-profile",
  upload.single("profilePic"), // انتظار فایل با نام 'profilePic'
  UserController.ChangeProfile
);

Router.get("/GetByUserId/:userId", AccessToken, UserController.GetUserById);

Router.post("/register", UserController.register);

Router.post("/login", UserController.login);

Router.get("/search", AccessToken, UserController.SearchUsers);

Router.put("/secret/ChangePassword", AccessToken, UserController.Changepass);

Router.put("/secret/ChangeUserName", AccessToken, UserController.ChangeName);

Router.get(
  "/friends/:userId",
  AccessToken,
  UserController.getUsersWithMessages
);

Router.post("/forgot-password", UserController.SendResetCode);

Router.post("/verify-reset-code", UserController.VerifyResetCode);

Router.post("/reset-password", UserController.ResetPassword);

Router.post("/verify-email", UserController.verifyEmail);

Router.post("/save-device-token", UserController.DeviceTokenCode);

Router.post("/google/check", UserController.checkGoogleAuth);

Router.post("/google/register", UserController.completeGoogleRegister);

Router.get("/update-application3", AccessToken, (req, res) => {
  res.send({ status: "false" });
});

module.exports = Router;
