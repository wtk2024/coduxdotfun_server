// server.js (ESM)
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import sgMail from '@sendgrid/mail';

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- env checks ---
const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'MAIL_FROM',
  'SENDGRID_API_KEY'
];
for (const r of required) {
  if (!process.env[r]) {
    console.warn(`Warning: env var ${r} is not set.`);
  }
}

const PORT = process.env.PORT ?? 3000;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Simple validation
function validateInquiry(body) {
  const errors = [];
  if (!body.fullName || body.fullName.trim().length < 1) errors.push('fullName is required');
  if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) errors.push('valid email is required');
  return errors;
}

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
      created_at: new Date().toISOString()
    };

    // 1) Insert inquiry
    const insertResp = await supabase
      .from('inquiries')
      .insert([payload])
      .select()
      .single();

    if (insertResp.error) {
      console.error('Supabase insert error:', insertResp.error);
      return res.status(500).json({ error: 'Failed to save inquiry', details: insertResp.error.message || insertResp.error });
    }

    const inserted = insertResp.data;
    const inquiryId = inserted.id; // assumes primary key column is `id`

    // 2) Prepare email content
    const subject = `Thanks for contacting Codux.Fun, ${inserted.full_name || 'there'}!`;
    const textBody = `Hi ${inserted.full_name || 'there'},\n\nThanks for your inquiry. We received your message:\n\n${inserted.project_description || '(no description provided)'}\n\nWe'll review it and get back to you shortly.\n\n— Codux.Fun`;
    const htmlBody = `
      <p>Hi ${inserted.full_name || 'there'},</p>
      <p>Thanks for your inquiry. We received your message:</p>
      <blockquote>${inserted.project_description || '(no description provided)'}</blockquote>
      <p>We'll review it and get back to you shortly.</p>
      <p>— <strong>Codux.Fun</strong></p>
    `;

    const msg = {
      to: inserted.email,
      from: process.env.MAIL_FROM,
      subject,
      text: textBody,
      html: htmlBody,
    };

    // 3) Attempt to send email and always update inquiry row with mail status
    let mailResult = {
      success: false,
      sentAt: null,
      error: null,
      response: null
    };

    try {
      const sendResp = await sgMail.send(msg); // returns array of responses
      mailResult.success = true;
      mailResult.sentAt = new Date().toISOString();
      // store a compact representation of response (status and headers)
      mailResult.response = JSON.stringify({
        status: Array.isArray(sendResp) ? sendResp[0].statusCode : sendResp.statusCode,
        headers: Array.isArray(sendResp) ? sendResp[0].headers : sendResp.headers
      });
      console.log('SendGrid send response', mailResult.response);
    } catch (mailErr) {
      console.error('SendGrid send error', mailErr);
      mailResult.success = false;
      mailResult.sentAt = new Date().toISOString();
      // Keep error message concise
      mailResult.error = (mailErr?.response?.body && JSON.stringify(mailErr.response.body)) || (mailErr.message || String(mailErr));
    }

    // 4) Update the inquiry row with mail status (non-fatal if update fails)
    try {
      const updatePayload = {
        mail_sent: mailResult.success,
        mail_error: mailResult.success ? null : mailResult.error,
        mail_response: mailResult.success ? mailResult.response : null,
        mail_sent_at: mailResult.sentAt
      };

      const upd = await supabase
        .from('inquiries')
        .update(updatePayload)
        .eq('id', inquiryId)
        .select()
        .single();

      if (upd.error) {
        console.warn('Failed to update inquiry with mail status:', upd.error);
        // we do not treat this as a fatal error; log and continue
      } else {
        // merge updated fields into inserted for response
        Object.assign(inserted, upd.data);
      }
    } catch (updErr) {
      console.error('Error while updating inquiry mail status:', updErr);
    }

    // 5) Respond to client with final status
    const clientMessage = mailResult.success
      ? 'Inquiry saved and confirmation email sent'
      : 'Inquiry saved but failed to send confirmation email (status recorded)';

    return res.status(200).json({
      message: clientMessage,
      inquiry: inserted,
      mail: mailResult
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error', details: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
