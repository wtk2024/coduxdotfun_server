// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Basic environment checks
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'MAIL_FROM', 'MAIL_APP_PASSWORD'];
for (const r of required) {
  if (!process.env[r]) {
    console.warn(`Warning: env var ${r} is not set.`);
  }
}

const PORT = process.env.PORT || 3000;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Nodemailer transporter for Outlook / Office365
const transporter = nodemailer.createTransport({
  host: 'smtp.office365.com',
  port: 587,
  secure: false, // use STARTTLS
  auth: {
    user: process.env.MAIL_FROM,
    pass: process.env.MAIL_APP_PASSWORD,
  },
  tls: {
    ciphers: 'SSLv3',
  },
});

// verify transporter on startup (optional but useful)
transporter.verify((err, success) => {
  if (err) console.error('Mail transporter verification failed:', err);
  else console.log('Mail transporter ready (Outlook).');
});

// Simple validation for incoming form
function validateInquiry(body) {
  const errors = [];
  if (!body.fullName || body.fullName.trim().length < 1) errors.push('fullName is required');
  if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) errors.push('valid email is required');
  return errors;
}

// POST endpoint: insert into Supabase + send confirmation mail
app.post('/api/public/inquiries', async (req, res) => {
  try {
    const validationErrors = validateInquiry(req.body);
    if (validationErrors.length) {
      return res.status(400).json({ error: 'Validation failed', details: validationErrors });
    }

    const payload = {
      full_name: req.body.fullName || null,
      email: req.body.email || null,
      phone_number: req.body.phone || null,
      service_type: req.body.serviceType || null,
      budget_range: req.body.budgetRange || null,
      project_description: req.body.projectDescription || null,
    };

    // Insert into Supabase
    const { data, error } = await supabase
      .from('inquiries')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(500).json({ error: 'Failed to save inquiry', details: error.message || error });
    }

    const inserted = data;

    // Prepare email
    const subject = `Thanks for contacting Codux.Fun, ${inserted.full_name || 'there'}!`;
    const textBody = `Hi ${inserted.full_name || 'there'},\n\nThanks for your inquiry. We received your message:\n\n${inserted.project_description || '(no description provided)'}\n\nWe'll review it and get back to you shortly.\n\n— Codux.Fun`;
    const htmlBody = `
      <p>Hi ${inserted.full_name || 'there'},</p>
      <p>Thanks for your inquiry. We received your message:</p>
      <blockquote>${inserted.project_description || '(no description provided)'}</blockquote>
      <p>We'll review it and get back to you shortly.</p>
      <p>— <strong>Codux.Fun</strong></p>
    `;

    // Send email
    let mailInfo;
    try {
      mailInfo = await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to: inserted.email,
        subject,
        text: textBody,
        html: htmlBody,
      });
      console.log('Mail sent:', mailInfo?.messageId || mailInfo);
    } catch (mailErr) {
      console.error('Email send failed:', mailErr);
      // Return success for insert + mail error info
      return res.status(200).json({
        message: 'Inquiry saved, but failed to send confirmation email',
        inquiry: inserted,
        mailError: mailErr.message || String(mailErr),
      });
    }

    // Success
    return res.status(200).json({
      message: 'Inquiry saved and confirmation email sent',
      inquiry: inserted,
      mail: {
        messageId: mailInfo.messageId,
        accepted: mailInfo.accepted || null,
      },
    });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error', details: err.message || err });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
