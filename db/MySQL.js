const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  reconnectionDelay: 5000,
  reconnectionDelayMax: 10000,
  randomizationFactor: 0.2,
});

(async () => {
  try {
    const connection = await pool.getConnection();
    console.log("Connected to DB");
    connection.release();
  } catch (err) {
    console.error("Error connecting to DB:");
  }
})();

module.exports = pool;
