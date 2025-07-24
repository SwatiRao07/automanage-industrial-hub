require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

app.post('/send-purchase-order', async (req, res) => {
  const to = req.body.to || process.env.RECEIVER_EMAIL;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SENDER_EMAIL,
      pass: process.env.SENDER_PASSWORD,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to: to,
      subject: "Purchase Order",
      text: "hello world",
    });
    res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = 5001;
app.listen(PORT, () => console.log(`Email server running on port ${PORT}`)); 