// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// --- Configuration ---
const app = express();
const port = 8080; // Match the port your frontend expects

// --- Supabase Client ---
// We use the SERVICE_ROLE_KEY here so our server has full admin access
// to bypass RLS when needed, and we'll implement our own auth check.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// --- Middleware ---
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Enable parsing of JSON request bodies

// --- AUTH MIDDLEWARE (Replaces JwtRequestFilter.java) ---
// This function checks the 'Authorization: Bearer <token>' header
const checkAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ error: 'No authorization token provided.' });
  }

  const token = authHeader.split(' ')[1];

  // Ask Supabase if this token is valid
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).send({ error: 'Invalid or expired token.' });
  }

  // If valid, attach the user to the request object and continue
  req.user = user;
  next();
};


// --- PUBLIC API ENDPOINTS (Replaces InquiryController & AuthController) ---

// 1. Submit Inquiry
app.post('/api/public/inquiries', async (req, res) => {
  console.log('Received inquiry:', req.body);
  
  // The DTO validation is now done by Supabase RLS (anyone can insert)
  const { data, error } = await supabase
    .from('inquiries')
    .insert([
      {
        // Map frontend camelCase (req.body) to database snake_case
        full_name: req.body.fullName,
        email: req.body.email,
        phone_number: req.body.phone,
        service_type: req.body.serviceType,
        budget_range: req.body.budgetRange,
        project_description: req.body.projectDescription,
      },
    ])
    .select(); // .select() returns the created data

  if (error) {
    console.error('Supabase insert error:', error.message);
    return res.status(500).send({ error: 'Failed to submit inquiry.', details: error.message });
  }

  res.status(200).send(data[0]);
});

// 2. Authenticate Admin
app.post('/api/public/authenticate', async (req, res) => {
  console.log('Login attempt for:', req.body.username);
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email: req.body.username, // Supabase auth uses email as the username
    password: req.body.password,
  });

  if (error) {
    console.error('Supabase login error:', error.message);
    return res.status(401).send({ error: 'Invalid username or password.' });
  }

  // Success! Send back the token just like Spring Security did.
  // The frontend expects a field named "token".
  res.status(200).send({ token: data.session.access_token });
});


// --- ADMIN API ENDPOINTS (Replaces AdminController) ---
// All routes below this line will be protected by our 'checkAuth' middleware.

// 1. Get All Inquiries
app.get('/api/admin/inquiries', checkAuth, async (req, res) => {
  // The user is authenticated (thanks to checkAuth middleware)
  // RLS rules on Supabase will double-check
  console.log(`User ${req.user.email} fetching inquiries.`);
  
  const { data, error } = await supabase
    .from('inquiries')
    .select('*')
    .order('created_at', { ascending: false }); // Sort by newest first

  if (error) {
    console.error('Supabase select error:', error.message);
    return res.status(500).send({ error: 'Failed to fetch inquiries.' });
  }

  res.status(200).send(data);
});

// 2. Delete an Inquiry
app.delete('/api/admin/inquiries/:id', checkAuth, async (req, res) => {
  const { id } = req.params;
  console.log(`User ${req.user.email} deleting inquiry ${id}.`);
  
  const { error } = await supabase
    .from('inquiries')
    .delete()
    .match({ id: id }); // Delete the row where id matches

  if (error) {
    console.error('Supabase delete error:', error.message);
    return res.status(500).send({ error: 'Failed to delete inquiry.' });
  }

  res.status(200).send({ message: 'Inquiry deleted successfully.' });
});


// --- Start Server ---
app.listen(port, () => {
  console.log(`Node.js server for codux.fun listening on http://localhost:${port}`);
  console.log('Make sure your Supabase URL and Service Key are in the .env file!');
});