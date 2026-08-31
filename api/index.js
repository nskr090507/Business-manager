const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const exceljs = require('exceljs');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-fallback-secret-key-change-in-production';

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Initialize Firebase Admin SDK
let db;
try {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    serviceAccount = require('./firebase-service-account.json');
  }

  const databaseURL = process.env.FIREBASE_DATABASE_URL || "https://farmsense-ai-a40c6-default-rtdb.asia-southeast1.firebasedatabase.app/";

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: databaseURL
  });
  db = admin.database();
  console.log('Firebase Admin SDK initialized successfully.');
} catch (err) {
  console.error('CRITICAL: Firebase Admin SDK initialization failed:', err.message);
  process.exit(1);
}

// Nodemailer Transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.ethereal.email",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER || "demo-alerts@farmsense.ai",
    pass: process.env.EMAIL_PASS || "demo-password-123"
  }
});

// Authentication middleware using custom JWT tokens (supports header and query param for downloads)
function requireAuth(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split('Bearer ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (err) {
    console.error('Token verification error:', err.message);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

// ----------------------------------------------------
// AUTHENTICATION ROUTES
// ----------------------------------------------------

// Signup route
app.post('/api/signup', async (req, res) => {
  const { username, password, full_name, business_name, email, phone } = req.body;
  if (!username || !password || !full_name || !business_name || !email || !phone) {
    return res.status(400).json({ error: 'All fields (Full Name, Username, Business, Email, Phone, Password) are required' });
  }
  try {
    const userSlug = username.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const userRef = db.ref(`users/${userSlug}`);
    
    userRef.once('value', async (snapshot) => {
      if (snapshot.exists()) {
        return res.status(400).json({ error: 'Username already exists' });
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      const userData = {
        username,
        password: hashedPassword,
        full_name,
        business_name,
        email,
        phone,
        created_at: new Date().toISOString(),
        settings: {
          email_alerts_enabled: false,
          budget_threshold: 5000
        }
      };
      
      await userRef.set(userData);
      
      // Sign JWT token
      const token = jwt.sign({ userId: userSlug, username, full_name }, JWT_SECRET, { expiresIn: '24h' });
      res.json({ success: true, token, user: { id: userSlug, username, full_name } });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forgot Password route
app.post('/api/forgot-password', async (req, res) => {
  const { username, email } = req.body;
  if (!username || !email) {
    return res.status(400).json({ error: 'Username and email are required' });
  }

  try {
    const userSlug = username.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const userRef = db.ref(`users/${userSlug}`);

    userRef.once('value', async (snapshot) => {
      const user = snapshot.val();
      if (!user) {
        return res.status(404).json({ error: 'User does not exist' });
      }

      if (!user.email || user.email.toLowerCase() !== email.toLowerCase()) {
        return res.status(400).json({ error: 'Incorrect email address associated with this username' });
      }

      // Generate random temporary password
      const tempPassword = 'tmp_' + Math.random().toString(36).substring(2, 10).toUpperCase();
      const newHashedPassword = await bcrypt.hash(tempPassword, 10);

      await userRef.child('password').set(newHashedPassword);

      const mailOptions = {
        from: '"Manager PRO Alerts" <demo-alerts@farmsense.ai>',
        to: user.email,
        subject: 'Your Password Reset Request - Manager PRO',
        text: `Hello ${user.full_name || user.username},\n\nWe received a request to reset your password. Here is your temporary password:\n\nTemporary Password: ${tempPassword}\n\nPlease use this to log in, and make sure to change your password immediately in Settings.\n\nBest regards,\nManager PRO Support Team`
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error('SMTP Send Error:', error);
          // Return temporary password inside JSON for simulation fallback
          return res.json({ success: true, message: 'Password reset simulation complete (SMTP delivery failed, temporary password printed below)', tempPassword });
        }
        res.json({ success: true, message: 'A temporary password has been sent to your email address.' });
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login route
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const userSlug = username.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const userRef = db.ref(`users/${userSlug}`);
    
    userRef.once('value', async (snapshot) => {
      const user = snapshot.val();
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const token = jwt.sign({ userId: userSlug, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
      res.json({ success: true, token, user: { id: userSlug, username: user.username } });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get profile details
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ userId: req.userId, username: req.username });
});

// Get detailed profile details for settings
app.get('/api/profile', requireAuth, (req, res) => {
  const ref = db.ref(`users/${req.userId}`);
  ref.once('value', (snapshot) => {
    const user = snapshot.val();
    if (!user) return res.status(404).json({ error: 'User profile not found' });
    res.json({
      username: user.username,
      full_name: user.full_name || '',
      business_name: user.business_name || '',
      email: user.email || '',
      phone: user.phone || '',
      created_at: user.created_at || ''
    });
  }, (err) => res.status(500).json({ error: err.message }));
});

// Get product catalog
app.get('/api/settings/products', requireAuth, (req, res) => {
  const ref = db.ref(`users/${req.userId}/products`);
  ref.once('value', (snapshot) => {
    const data = snapshot.val() || {};
    const list = Object.keys(data).map(key => ({ key, ...data[key] }));
    res.json(list);
  }, (err) => res.status(500).json({ error: err.message }));
});

// Add product to catalog
app.post('/api/settings/products', requireAuth, (req, res) => {
  const { name, initial_stock } = req.body;
  if (!name || isNaN(parseFloat(initial_stock))) {
    return res.status(400).json({ error: 'Product name and a valid initial stock are required' });
  }

  const productKey = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const ref = db.ref(`users/${req.userId}/products/${productKey}`);
  
  const productData = {
    name: name.trim(),
    initial_stock: parseFloat(initial_stock)
  };

  ref.set(productData, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ key: productKey, ...productData });
  });
});

// Remove product from catalog
app.delete('/api/settings/products/:key', requireAuth, (req, res) => {
  const { key } = req.params;
  const ref = db.ref(`users/${req.userId}/products/${key}`);
  ref.remove((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Product removed from catalog' });
  });
});

// Get worker roles catalog
app.get('/api/settings/roles', requireAuth, (req, res) => {
  const ref = db.ref(`users/${req.userId}/roles`);
  ref.once('value', (snapshot) => {
    const data = snapshot.val() || {};
    const list = Object.keys(data).map(key => ({ key, ...data[key] }));
    res.json(list);
  }, (err) => res.status(500).json({ error: err.message }));
});

// Add custom role
app.post('/api/settings/roles', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Role name is required' });
  }

  const roleKey = name.trim().replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const ref = db.ref(`users/${req.userId}/roles/${roleKey}`);
  
  const roleData = {
    name: name.trim()
  };

  ref.set(roleData, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ key: roleKey, ...roleData });
  });
});

// Remove custom role
app.delete('/api/settings/roles/:key', requireAuth, (req, res) => {
  const { key } = req.params;
  const ref = db.ref(`users/${req.userId}/roles/${key}`);
  ref.remove((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Role removed from configurator' });
  });
});

// Get user settings
app.get('/api/settings', requireAuth, (req, res) => {
  const ref = db.ref(`users/${req.userId}/settings`);
  ref.once('value', (snapshot) => {
    res.json(snapshot.val() || { email_alerts_enabled: false, budget_threshold: 5000, low_stock_threshold: 100 });
  }, (err) => res.status(500).json({ error: err.message }));
});

// Update user settings
app.put('/api/settings', requireAuth, (req, res) => {
  const { email_alerts_enabled, budget_threshold, low_stock_threshold } = req.body;
  const ref = db.ref(`users/${req.userId}/settings`);
  
  const updatedSettings = {
    email_alerts_enabled: !!email_alerts_enabled,
    budget_threshold: parseFloat(budget_threshold) || 5000,
    low_stock_threshold: parseFloat(low_stock_threshold) || 100
  };

  ref.update(updatedSettings, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(updatedSettings);
  });
});

// Change Password route
app.put('/api/settings/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }

  try {
    const userRef = db.ref(`users/${req.userId}`);
    userRef.once('value', async (snapshot) => {
      const user = snapshot.val();
      if (!user) {
        return res.status(404).json({ error: 'User profile not found' });
      }

      // Verify current password
      const match = await bcrypt.compare(current_password, user.password);
      if (!match) {
        return res.status(400).json({ error: 'Incorrect current password' });
      }

      // Hash and save new password
      const newHashedPassword = await bcrypt.hash(new_password, 10);
      await userRef.child('password').set(newHashedPassword);

      res.json({ success: true, message: 'Password updated successfully!' });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ----------------------------------------------------
// WORKERS MANAGEMENT
// ----------------------------------------------------

// Get all workers
app.get('/api/workers', requireAuth, (req, res) => {
  const ref = db.ref(`workers/${req.userId}`);
  ref.once('value', (snapshot) => {
    const data = snapshot.val() || {};
    const list = Object.keys(data).map(id => ({ id, ...data[id] }));
    res.json(list);
  }, (err) => res.status(500).json({ error: err.message }));
});

// Add new worker
app.post('/api/workers', requireAuth, (req, res) => {
  const { name, role, contact_info, salary_rate, hire_date } = req.body;
  if (!name || isNaN(parseFloat(salary_rate)) || parseFloat(salary_rate) <= 0) {
    return res.status(400).json({ error: 'Name and a valid wage rate are required' });
  }

  const ref = db.ref(`workers/${req.userId}`);
  const newWorkerRef = ref.push();
  const workerData = {
    name,
    role: role || 'General Worker',
    contact_info: contact_info || '',
    salary_rate: parseFloat(salary_rate),
    hire_date: hire_date || new Date().toISOString().split('T')[0],
    status: 'active',
    created_at: new Date().toISOString()
  };

  newWorkerRef.set(workerData, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: newWorkerRef.key, ...workerData });
  });
});

// Update worker details
app.put('/api/workers/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { name, role, contact_info, salary_rate, hire_date, status } = req.body;
  if (!name || isNaN(parseFloat(salary_rate)) || parseFloat(salary_rate) <= 0) {
    return res.status(400).json({ error: 'Name and valid wage rate are required' });
  }

  const ref = db.ref(`workers/${req.userId}/${id}`);
  const updateData = {
    name,
    role,
    contact_info,
    salary_rate: parseFloat(salary_rate),
    hire_date,
    status: status || 'active',
    updated_at: new Date().toISOString()
  };

  ref.update(updateData, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id, ...updateData });
  });
});

// Delete worker
app.delete('/api/workers/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const ref = db.ref(`workers/${req.userId}/${id}`);
  ref.remove((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Get wage payments history for a specific worker
app.get('/api/workers/:id/payments', requireAuth, (req, res) => {
  const { id } = req.params;
  const ref = db.ref(`worker_payments/${req.userId}`);
  ref.orderByChild('worker_id').equalTo(id).once('value', (snapshot) => {
    const data = snapshot.val() || {};
    const payments = Object.keys(data).map(key => ({ id: key, ...data[key] }));
    payments.sort((a, b) => new Date(b.payment_date) - new Date(a.payment_date));
    res.json(payments);
  }, (err) => res.status(500).json({ error: err.message }));
});

// Pay daily wages to a worker
app.post('/api/workers/:id/payments', requireAuth, (req, res) => {
  const { id } = req.params;
  const { amount, payment_date, payment_method, period_covered, notes } = req.body;

  if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Valid payment amount is required' });
  }

  const workerRef = db.ref(`workers/${req.userId}/${id}`);
  workerRef.once('value', (snapshot) => {
    const worker = snapshot.val();
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const payRef = db.ref(`worker_payments/${req.userId}`);
    const newPayRef = payRef.push();
    const paymentData = {
      worker_id: id,
      worker_name: worker.name,
      amount: parseFloat(amount),
      payment_date: payment_date || new Date().toISOString().split('T')[0],
      payment_method: payment_method || 'Cash',
      period_covered: period_covered || new Date().toISOString().split('T')[0],
      notes: notes || '',
      created_at: new Date().toISOString()
    };

    newPayRef.set(paymentData, (err) => {
      if (err) return res.status(500).json({ error: err.message });

      // Automatically sync as Expense in Financial Transactions ledger
      const finRef = db.ref(`finance_transactions/${req.userId}`);
      const newFinRef = finRef.push();
      newFinRef.set({
        type: 'EXPENSE',
        category: 'Wages',
        amount: parseFloat(amount),
        date: payment_date || new Date().toISOString().split('T')[0],
        description: `Wage payment to ${worker.name} (Period/Day: ${period_covered})`,
        related_worker_id: id,
        created_at: new Date().toISOString()
      });

      res.json({ id: newPayRef.key, ...paymentData });
    });
  });
});

// Get attendance statuses by date
app.get('/api/workers/attendance', requireAuth, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date parameter is required' });
  const ref = db.ref(`attendance/${req.userId}/${date}`);
  ref.once('value', (snapshot) => {
    res.json(snapshot.val() || {});
  }, (err) => res.status(500).json({ error: err.message }));
});

// Log worker attendance status
app.post('/api/workers/attendance', requireAuth, (req, res) => {
  const { date, workerId, status } = req.body;
  if (!date || !workerId || !status) {
    return res.status(400).json({ error: 'Date, workerId, and status are required' });
  }
  if (status !== 'present' && status !== 'absent') {
    return res.status(400).json({ error: 'Status must be present or absent' });
  }
  const ref = db.ref(`attendance/${req.userId}/${date}/${workerId}`);
  ref.set(status, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, date, workerId, status });
  });
});

// Get attendance history logs & metrics for a specific worker
app.get('/api/workers/:id/attendance-history', requireAuth, (req, res) => {
  const { id } = req.params;
  const ref = db.ref(`attendance/${req.userId}`);
  ref.once('value', (snapshot) => {
    const datesObj = snapshot.val() || {};
    const history = [];
    let totalDays = 0;
    let presentCount = 0;

    Object.keys(datesObj).forEach(date => {
      if (datesObj[date][id]) {
        const status = datesObj[date][id];
        history.push({ date, status });
        totalDays++;
        if (status === 'present') {
          presentCount++;
        }
      }
    });

    // Sort by date descending (newest first)
    history.sort((a, b) => new Date(b.date) - new Date(a.date));

    const rate = totalDays > 0 ? Math.round((presentCount / totalDays) * 100) : 100;

    res.json({
      history,
      stats: {
        totalDays,
        presentCount,
        absentCount: totalDays - presentCount,
        attendanceRate: rate
      }
    });
  }, (err) => res.status(500).json({ error: err.message }));
});


// ----------------------------------------------------
// VEHICLES MANAGEMENT
// ----------------------------------------------------

// Get all vehicles
app.get('/api/vehicles', requireAuth, (req, res) => {
  const ref = db.ref(`vehicles/${req.userId}`);
  ref.once('value', (snapshot) => {
    const data = snapshot.val() || {};
    const list = Object.keys(data).map(id => ({ id, ...data[id] }));
    res.json(list);
  }, (err) => res.status(500).json({ error: err.message }));
});

// Add new vehicle
app.post('/api/vehicles', requireAuth, (req, res) => {
  const { make, model, year, license_plate, vehicle_type, purchase_date } = req.body;
  if (!make || !model || !year || !license_plate) {
    return res.status(400).json({ error: 'Make, model, year, and license plate are required' });
  }

  const plateRegex = /^[A-Za-z0-9\s-]{2,15}$/;
  if (!plateRegex.test(license_plate)) {
    return res.status(400).json({ error: 'License plate must be alphanumeric, 2-15 characters' });
  }

  const ref = db.ref(`vehicles/${req.userId}`);
  ref.orderByChild('license_plate').equalTo(license_plate).once('value', (snapshot) => {
    if (snapshot.exists()) {
      return res.status(400).json({ error: 'Vehicle with this license plate is already registered' });
    }

    const newVehicleRef = ref.push();
    const vehicleData = {
      make,
      model,
      year: parseInt(year),
      license_plate,
      vehicle_type: vehicle_type || 'Truck',
      purchase_date: purchase_date || '',
      status: 'active',
      created_at: new Date().toISOString()
    };

    newVehicleRef.set(vehicleData, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: newVehicleRef.key, ...vehicleData });
    });
  });
});

// Update vehicle
app.put('/api/vehicles/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { make, model, year, license_plate, vehicle_type, purchase_date, status } = req.body;

  if (!make || !model || !year || !license_plate) {
    return res.status(400).json({ error: 'Make, model, year, and license plate are required' });
  }

  const ref = db.ref(`vehicles/${req.userId}/${id}`);
  const updateData = {
    make,
    model,
    year: parseInt(year),
    license_plate,
    vehicle_type,
    purchase_date,
    status: status || 'active',
    updated_at: new Date().toISOString()
  };

  ref.update(updateData, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id, ...updateData });
  });
});

// Delete vehicle
app.delete('/api/vehicles/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const ref = db.ref(`vehicles/${req.userId}/${id}`);
  ref.remove((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Get maintenance logs for a vehicle
app.get('/api/vehicles/:id/maintenance', requireAuth, (req, res) => {
  const { id } = req.params;
  const ref = db.ref(`vehicle_maintenance/${req.userId}`);
  ref.orderByChild('vehicle_id').equalTo(id).once('value', (snapshot) => {
    const data = snapshot.val() || {};
    const list = Object.keys(data).map(key => ({ id: key, ...data[key] }));
    list.sort((a, b) => new Date(b.service_date) - new Date(a.service_date));
    res.json(list);
  }, (err) => res.status(500).json({ error: err.message }));
});

// Log maintenance service
app.post('/api/vehicles/:id/maintenance', requireAuth, (req, res) => {
  const { id } = req.params;
  const { service_type, service_date, cost, next_service_date, description } = req.body;

  if (!service_type || isNaN(parseFloat(cost)) || parseFloat(cost) < 0) {
    return res.status(400).json({ error: 'Service type and a non-negative cost are required' });
  }

  const vehicleRef = db.ref(`vehicles/${req.userId}/${id}`);
  vehicleRef.once('value', (snapshot) => {
    const vehicle = snapshot.val();
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const maintRef = db.ref(`vehicle_maintenance/${req.userId}`);
    const newMaintRef = maintRef.push();
    const maintData = {
      vehicle_id: id,
      vehicle_name: `${vehicle.make} ${vehicle.model} (${vehicle.license_plate})`,
      service_type,
      service_date: service_date || new Date().toISOString().split('T')[0],
      cost: parseFloat(cost),
      next_service_date: next_service_date || '',
      description: description || '',
      created_at: new Date().toISOString()
    };

    newMaintRef.set(maintData, (err) => {
      if (err) return res.status(500).json({ error: err.message });

      // Automatically sync as Expense in Financial Ledger
      const finRef = db.ref(`finance_transactions/${req.userId}`);
      const newFinRef = finRef.push();
      newFinRef.set({
        type: 'EXPENSE',
        category: 'Maintenance',
        amount: parseFloat(cost),
        date: service_date || new Date().toISOString().split('T')[0],
        description: `Maintenance (${service_type}) for ${vehicle.make} ${vehicle.model} (${vehicle.license_plate})`,
        related_vehicle_id: id,
        created_at: new Date().toISOString()
      });

      // Broadcast Socket notification
      io.to(req.userId).emit('notification', {
        message: `Maintenance service logged for ${vehicle.license_plate} (Cost: $${cost})`,
        type: 'maintenance'
      });

      res.json({ id: newMaintRef.key, ...maintData });
    });
  });
});

// Get route logs for a vehicle
app.get('/api/vehicles/:id/routes', requireAuth, (req, res) => {
  const { id } = req.params;
  const ref = db.ref(`vehicle_routes/${req.userId}`);
  ref.orderByChild('vehicle_id').equalTo(id).once('value', (snapshot) => {
    const data = snapshot.val() || {};
    const list = Object.keys(data).map(key => ({ id: key, ...data[key] }));
    list.sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
    res.json(list);
  }, (err) => res.status(500).json({ error: err.message }));
});

// Log a route
app.post('/api/vehicles/:id/routes', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { worker_id, start_date, destination_person, destination_area, route_notes } = req.body;

  if (!start_date || !destination_person || !destination_area) {
    return res.status(400).json({ error: 'Start date, destination person, and area are required' });
  }

  try {
    const vehicleSnap = await db.ref(`vehicles/${req.userId}/${id}`).once('value');
    const vehicle = vehicleSnap.val();
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    let workerName = 'N/A';
    if (worker_id) {
      const workerSnap = await db.ref(`workers/${req.userId}/${worker_id}`).once('value');
      const worker = workerSnap.val();
      if (worker) workerName = worker.name;
    }

    const routeRef = db.ref(`vehicle_routes/${req.userId}`);
    const newRouteRef = routeRef.push();
    const routeId = newRouteRef.key;

    const routeData = {
      vehicle_id: id,
      vehicle_name: `${vehicle.make} ${vehicle.model} (${vehicle.license_plate})`,
      worker_id: worker_id || null,
      worker_name: workerName,
      start_date,
      destination_person,
      destination_area,
      route_notes: route_notes || '',
      created_at: new Date().toISOString()
    };

    await newRouteRef.set(routeData);

    res.json({ id: routeId, ...routeData });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// ----------------------------------------------------
// FINANCIAL LEDGER
// ----------------------------------------------------

// Get all transactions
app.get('/api/finance/transactions', requireAuth, (req, res) => {
  const ref = db.ref(`finance_transactions/${req.userId}`);
  ref.once('value', (snapshot) => {
    const data = snapshot.val() || {};
    let list = Object.keys(data).map(key => ({ id: key, ...data[key] }));

    const { start_date, end_date, category, type } = req.query;
    if (start_date) list = list.filter(t => t.date >= start_date);
    if (end_date) list = list.filter(t => t.date <= end_date);
    if (category && category !== 'All') list = list.filter(t => t.category === category);
    if (type && type !== 'All') list = list.filter(t => t.type === type);

    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(list);
  }, (err) => res.status(500).json({ error: err.message }));
});

// Add custom transaction
app.post('/api/finance/transactions', requireAuth, (req, res) => {
  const { type, category, amount, date, description, related_worker_id, related_vehicle_id } = req.body;
  
  if (!type || !category || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || !date) {
    return res.status(400).json({ error: 'Type, category, positive amount, and date are required' });
  }

  const ref = db.ref(`finance_transactions/${req.userId}`);
  const newRef = ref.push();
  const txData = {
    type,
    category,
    amount: parseFloat(amount),
    date,
    description: description || '',
    related_worker_id: related_worker_id || null,
    related_vehicle_id: related_vehicle_id || null,
    created_at: new Date().toISOString()
  };

  newRef.set(txData, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: newRef.key, ...txData });
  });
});

// Delete financial transaction
app.delete('/api/finance/transactions/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const ref = db.ref(`finance_transactions/${req.userId}/${id}`);
  ref.remove((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Get Party Balances (Accounts Payable & Receivable)
app.get('/api/finance/party-balances', requireAuth, async (req, res) => {
  try {
    const stockSnap = await db.ref(`stocks/${req.userId}`).once('value');
    const stocks = stockSnap.val() || {};

    let totalReceivables = 0;
    let totalPayables = 0;
    const parties = {};

    Object.values(stocks).forEach(stock => {
      if (!stock.party_name) return; // Skip if no party name

      const partyName = stock.party_name.trim();
      const contact = stock.party_contact || '';
      
      if (!parties[partyName]) {
        parties[partyName] = { name: partyName, contact: contact, receivable: 0, payable: 0 };
      }
      
      const totalAmt = parseFloat(stock.total_amount) || 0;
      const paidAmt = parseFloat(stock.amount_paid) || 0;
      const balance = totalAmt - paidAmt;

      if (balance > 0) {
        if (stock.type === 'OUTGOING') {
          // Sale -> We should receive money
          parties[partyName].receivable += balance;
          totalReceivables += balance;
        } else if (stock.type === 'INCOMING') {
          // Purchase -> We need to pay money
          parties[partyName].payable += balance;
          totalPayables += balance;
        }
      }
    });

    const partiesList = Object.values(parties).filter(p => p.receivable > 0 || p.payable > 0);
    
    // Calculate net balance for each party (Positive = they owe us, Negative = we owe them)
    partiesList.forEach(p => {
      p.net_balance = p.receivable - p.payable;
    });

    res.json({
      total_receivables: totalReceivables,
      total_payables: totalPayables,
      parties: partiesList
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get financial summary KPIs
app.get('/api/finance/summary', requireAuth, async (req, res) => {
  try {
    const txSnap = await db.ref(`finance_transactions/${req.userId}`).once('value');
    const transactions = txSnap.val() || {};

    const routeSnap = await db.ref(`vehicle_routes/${req.userId}`).once('value');
    const routes = routeSnap.val() || {};

    let totalRevenue = 0;
    let totalExpenses = 0;
    let fuelExpenses = 0;
    let wagesExpenses = 0;
    let maintenanceExpenses = 0;
    let wastageExpenses = 0;
    let otherExpenses = 0;

    Object.values(transactions).forEach(tx => {
      const amt = parseFloat(tx.amount) || 0;
      if (tx.type === 'INCOME') {
        totalRevenue += amt;
      } else {
        totalExpenses += amt;
        if (tx.category === 'Fuel') fuelExpenses += amt;
        else if (tx.category === 'Wages') wagesExpenses += amt;
        else if (tx.category === 'Maintenance') maintenanceExpenses += amt;
        else if (tx.category === 'Wastage') wastageExpenses += amt;
        else otherExpenses += amt;
      }
    });

    let totalKm = 0;
    let totalLiters = 0;
    Object.values(routes).forEach(route => {
      totalKm += parseFloat(route.distance_traveled) || 0;
      totalLiters += parseFloat(route.fuel_used) || 0;
    });

    const netProfit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
    const fuelEfficiency = totalLiters > 0 ? totalKm / totalLiters : 0;
    const fuelCostPerKm = totalKm > 0 ? fuelExpenses / totalKm : 0;

    res.json({
      totalRevenue,
      totalExpenses,
      netProfit,
      profitMargin,
      breakdown: {
        fuel: fuelExpenses,
        wages: wagesExpenses,
        maintenance: maintenanceExpenses,
        wastage: wastageExpenses,
        other: otherExpenses
      },
      fleetMetrics: {
        totalKm,
        totalLiters,
        fuelEfficiency,
        fuelCostPerKm
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ----------------------------------------------------
// NOTIFICATIONS SYSTEM
// ----------------------------------------------------

// Get unread notifications
app.get('/api/notifications', requireAuth, (req, res) => {
  const ref = db.ref(`notifications/${req.userId}`);
  ref.orderByChild('is_read').equalTo(false).once('value', (snapshot) => {
    const data = snapshot.val() || {};
    const list = Object.keys(data).map(key => ({ id: key, ...data[key] }));
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(list);
  }, (err) => res.status(500).json({ error: err.message }));
});

// Mark notification as read
app.put('/api/notifications/:id/read', requireAuth, (req, res) => {
  const { id } = req.params;
  const ref = db.ref(`notifications/${req.userId}/${id}`);
  ref.update({ is_read: true }, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Trigger checks (runs checks for scheduled vehicle services or wage reminders)
// Trigger checks (runs checks for scheduled vehicle services, low stock warnings, or lot expiry reminders)
app.post('/api/notifications/check-triggers', requireAuth, async (req, res) => {
  try {
    const today = new Date();
    const notificationsRef = db.ref(`notifications/${req.userId}`);
    
    // Fetch existing unread messages to avoid duplicates
    const notifSnap = await db.ref(`notifications/${req.userId}`).once('value');
    const existingNotifs = notifSnap.val() || {};
    const unreadMessages = Object.values(existingNotifs)
      .filter(n => !n.is_read)
      .map(n => n.message);

    const added = [];

    // 1. Check upcoming vehicle maintenance
    const vehiclesSnap = await db.ref(`vehicles/${req.userId}`).once('value');
    const vehicles = vehiclesSnap.val() || {};

    const maintenanceSnap = await db.ref(`vehicle_maintenance/${req.userId}`).once('value');
    const maintenanceLogs = maintenanceSnap.val() || {};

    Object.keys(vehicles).forEach(vId => {
      const vehicle = vehicles[vId];
      if (vehicle.status !== 'active') return;

      const vLogs = Object.values(maintenanceLogs).filter(log => log.vehicle_id === vId && log.next_service_date);
      if (vLogs.length === 0) return;

      vLogs.sort((a, b) => new Date(b.service_date) - new Date(a.service_date));
      const latestLog = vLogs[0];
      const nextDate = new Date(latestLog.next_service_date);

      const diffTime = nextDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays <= 7) {
        const msg = `Upcoming service required for ${vehicle.make} ${vehicle.model} (${vehicle.license_plate}) on ${latestLog.next_service_date} (${diffDays} days left).`;
        
        if (!unreadMessages.some(m => m.includes(`service required for ${vehicle.license_plate}`))) {
          const newNotifRef = notificationsRef.push();
          newNotifRef.set({
            message: msg,
            type: 'maintenance',
            is_read: false,
            created_at: new Date().toISOString()
          });
added.push(msg);
        }
      }
    });

    // 2. Check Low Stock Levels
    const prodSnap = await db.ref(`users/${req.userId}/products`).once('value');
    const productsObj = prodSnap.val() || {};
    const productsCatalog = Object.keys(productsObj).map(key => ({ key, ...productsObj[key] }));

    const stockSnap = await db.ref(`stocks/${req.userId}`).once('value');
    const stocksObj = stockSnap.val() || {};
    const stocksList = Object.keys(stocksObj).map(key => ({ id: key, ...stocksObj[key] }));

    const availableStocks = {};
    productsCatalog.forEach(p => {
      availableStocks[p.name] = parseFloat(p.initial_stock) || 0;
    });

    stocksList.forEach(s => {
      const item = s.item_name;
      const qty = parseFloat(s.quantity) || 0;
      const type = s.type;
      if (availableStocks[item] === undefined) {
        availableStocks[item] = 0;
      }
      if (type === 'INCOMING') {
        availableStocks[item] += qty;
      } else if (type === 'OUTGOING') {
        availableStocks[item] -= qty;
      }
    });

    const settingsSnap = await db.ref(`users/${req.userId}/settings`).once('value');
    const settings = settingsSnap.val() || {};
    const lowStockThreshold = parseFloat(settings.low_stock_threshold) || 100;

    Object.keys(availableStocks).forEach(itemName => {
      const qty = Math.max(0, availableStocks[itemName]);
      if (qty < lowStockThreshold) {
        const msg = `Low stock alert: ${itemName} is at ${qty.toFixed(1)} kg (Threshold: ${lowStockThreshold} kg).`;
        
        if (!unreadMessages.some(m => m.includes(`Low stock alert: ${itemName}`))) {
          const newNotifRef = notificationsRef.push();
          newNotifRef.set({
            message: msg,
            type: 'low_stock',
            is_read: false,
            created_at: new Date().toISOString()
          });
added.push(msg);
        }
      }
    });

    // 3. Check Perishable Lot Expiry Dates (warnings triggered within 7 days of expiry)
    const todayStr = new Date().toISOString().split('T')[0];
    const todayTime = new Date(todayStr).getTime();

    stocksList.forEach(s => {
      if (s.expiry_date && s.type === 'INCOMING') {
        const expTime = new Date(s.expiry_date).getTime();
        const diffTime = expTime - todayTime;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= 7) {
          const lotStr = s.batch_number ? ` (Lot: ${s.batch_number})` : '';
          const msg = `Expiry warning: ${s.item_name}${lotStr} will expire on ${s.expiry_date} (${diffDays} days left).`;
          const identifier = `Expiry warning: ${s.item_name}${lotStr}`;

          if (!unreadMessages.some(m => m.includes(identifier))) {
            const newNotifRef = notificationsRef.push();
            newNotifRef.set({
              message: msg,
              type: 'expiry',
              is_read: false,
              created_at: new Date().toISOString()
            });
added.push(msg);
          }
        }
      }
    });

    res.json({ success: true, triggersRun: ['maintenance', 'low_stock', 'expiry'], alertsTriggered: added });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// ----------------------------------------------------
// INTEGRATED REPORTING & EXPORTS
// ----------------------------------------------------

async function getReportData(userId, startDate, endDate, category = 'All', type = 'All') {
  const txSnap = await db.ref(`finance_transactions/${userId}`).once('value');
  const transactions = txSnap.val() || {};

  const routeSnap = await db.ref(`vehicle_routes/${userId}`).once('value');
  const routes = routeSnap.val() || {};

  const workerSnap = await db.ref(`worker_payments/${userId}`).once('value');
  const wages = workerSnap.val() || {};

  let txList = Object.keys(transactions).map(key => ({ id: key, ...transactions[key] }));
  let routeList = Object.keys(routes).map(key => ({ id: key, ...routes[key] }));
  let wageList = Object.keys(wages).map(key => ({ id: key, ...wages[key] }));

  // Apply filters
  if (startDate) {
    txList = txList.filter(t => t.date >= startDate);
    routeList = routeList.filter(r => r.start_date >= startDate);
    wageList = wageList.filter(w => w.payment_date >= startDate);
  }
  if (endDate) {
    txList = txList.filter(t => t.date <= endDate);
    routeList = routeList.filter(r => r.start_date <= endDate);
    wageList = wageList.filter(w => w.payment_date <= endDate);
  }
  if (category && category !== 'All') {
    txList = txList.filter(t => t.category === category);
  }
  if (type && type !== 'All') {
    txList = txList.filter(t => t.type === type);
  }

  let revenue = 0;
  let expenses = 0;
  txList.forEach(t => {
    if (t.type === 'INCOME') revenue += parseFloat(t.amount) || 0;
    else expenses += parseFloat(t.amount) || 0;
  });

  return {
    transactions: txList,
    routes: routeList,
    wages: wageList,
    summary: {
      startDate: startDate || 'All time',
      endDate: endDate || 'All time',
      totalRevenue: revenue,
      totalExpenses: expenses,
      netProfit: revenue - expenses
    }
  };
}

// REST route to generate report details
app.post('/api/reports/generate', requireAuth, async (req, res) => {
  const { startDate, endDate, category, type } = req.body;
  try {
    const report = await getReportData(req.userId, startDate, endDate, category, type);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV Export Route
app.get('/api/reports/export/csv', requireAuth, async (req, res) => {
  const { startDate, endDate, category, type } = req.query;
  try {
    const data = await getReportData(req.userId, startDate, endDate, category, type);
    
    let csv = 'ID,Date,Type,Category,Amount,Description\n';
    data.transactions.forEach(t => {
      csv += `"${t.id}","${t.date}","${t.type}","${t.category}",${t.amount},"${t.description.replace(/"/g, '""')}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=financial-report-${startDate || 'all'}-to-${endDate || 'all'}.csv`);
    res.status(200).send(csv);
  } catch (err) {
    res.status(500).send('Error generating CSV');
  }
});

// Excel Export Route (ExcelJS)
app.get('/api/reports/export/excel', requireAuth, async (req, res) => {
  const { startDate, endDate, category, type } = req.query;
  try {
    const data = await getReportData(req.userId, startDate, endDate, category, type);
    
    const workbook = new exceljs.Workbook();
    
    const sheet1 = workbook.addWorksheet('Ledger');
    sheet1.columns = [
      { header: 'Transaction ID', key: 'id', width: 25 },
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Amount ($)', key: 'amount', width: 15 },
      { header: 'Description', key: 'description', width: 45 }
    ];

    data.transactions.forEach(t => {
      sheet1.addRow({
        id: t.id,
        date: t.date,
        type: t.type,
        category: t.category,
        amount: parseFloat(t.amount),
        description: t.description
      });
    });

    sheet1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet1.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }
    };

    const sheet2 = workbook.addWorksheet('Vehicle Routes');
    sheet2.columns = [
      { header: 'Route ID', key: 'id', width: 25 },
      { header: 'Vehicle', key: 'vehicle_name', width: 25 },
      { header: 'Driver', key: 'worker_name', width: 18 },
      { header: 'Start Date', key: 'start_date', width: 15 },
      { header: 'Distance (km)', key: 'distance', width: 15 },
      { header: 'Fuel Used (L)', key: 'fuel', width: 15 },
      { header: 'Fuel Cost ($)', key: 'fuel_cost', width: 15 },
      { header: 'Revenue ($)', key: 'revenue', width: 15 }
    ];

    data.routes.forEach(r => {
      sheet2.addRow({
        id: r.id,
        vehicle_name: r.vehicle_name,
        worker_name: r.worker_name,
        start_date: r.start_date,
        distance: r.distance_traveled,
        fuel: r.fuel_used,
        fuel_cost: r.fuel_cost,
        revenue: r.route_revenue
      });
    });

    sheet2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet2.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF10B981' }
    };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=business-report.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating Excel file');
  }
});

// PDF Export Route (PDFKit)
app.get('/api/reports/export/pdf', requireAuth, async (req, res) => {
  const { startDate, endDate, category, type } = req.query;
  try {
    const data = await getReportData(req.userId, startDate, endDate, category, type);
    
    const doc = new PDFDocument({ margin: 50 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=business-report.pdf`);

    doc.pipe(res);

    doc.fontSize(24).font('Helvetica-Bold').fillColor('#1E293B').text('Business Management Summary', { align: 'center' });
    doc.moveDown();
    
    doc.fontSize(10).font('Helvetica').fillColor('#64748B')
       .text(`Report Period: ${startDate || 'All'} to ${endDate || 'All'}`)
       .text(`Generated On: ${new Date().toLocaleString()}`)
       .text(`Categories filtered: ${category || 'All'}, Transaction types: ${type || 'All'}`);
    
    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#E2E8F0').strokeWidth(1).stroke();
    doc.moveDown(1.5);

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0F172A').text('Financial Highlights');
    doc.moveDown();
    
    doc.fontSize(11).font('Helvetica').fillColor('#334155');
    doc.text(`Total Route / Service Revenue: $${data.summary.totalRevenue.toFixed(2)}`);
    doc.text(`Total Operating Expenses: $${data.summary.totalExpenses.toFixed(2)}`);
    
    const profit = data.summary.netProfit;
    const isLoss = profit < 0;
    doc.fillColor(isLoss ? '#EF4444' : '#10B981')
       .text(`Net Profit / Loss: $${profit.toFixed(2)} (${isLoss ? 'Loss' : 'Gain'})`);
    
    doc.moveDown(2);

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0F172A').text('Recent Financial Ledger Entries');
    doc.moveDown();
    
    doc.fontSize(9).font('Helvetica').fillColor('#334155');
    
    data.transactions.slice(0, 15).forEach((t, i) => {
      const typeStr = t.type === 'INCOME' ? '(+) Revenue' : '(-) Expense';
      const color = t.type === 'INCOME' ? '#10B981' : '#EF4444';
      
      doc.font('Helvetica-Bold').fillColor(color).text(`${t.date}  [${typeStr}] - ${t.category}: `, { continued: true })
         .font('Helvetica').fillColor('#1E293B').text(`$${t.amount.toFixed(2)} - `, { continued: true })
         .fillColor('#64748B').text(t.description);
      doc.moveDown(0.5);
    });

    if (data.transactions.length > 15) {
      doc.fontSize(8).fillColor('#94A3B8').text(`...and ${data.transactions.length - 15} more records (download CSV/Excel for full logs).`);
    }

    doc.moveDown(2);

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0F172A').text('Fleet Route Summary');
    doc.moveDown();
    
    doc.fontSize(9).font('Helvetica').fillColor('#334155');
    
    let totalDist = 0;
    let totalFuel = 0;
    data.routes.forEach(r => {
      totalDist += r.distance_traveled || 0;
      totalFuel += r.fuel_used || 0;
    });

    doc.text(`Total Fleet Distance Covered: ${totalDist.toFixed(1)} km`);
    doc.text(`Total Fleet Fuel Consumed: ${totalFuel.toFixed(1)} Liters`);
    const eff = totalFuel > 0 ? (totalDist / totalFuel).toFixed(2) : 0;
    doc.text(`Average Fleet Fuel Efficiency: ${eff} km/L`);

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating PDF');
  }
});

// ----------------------------------------------------
// STOCKS MANAGEMENT API
// ----------------------------------------------------

// Get all stock transactions, available stock levels and today's stats
app.get('/api/stocks', requireAuth, async (req, res) => {
  try {
    const userSlug = req.userId;
    const stocksRef = db.ref(`stocks/${userSlug}`);
    const productsRef = db.ref(`users/${userSlug}/products`);
    
    productsRef.once('value', (prodSnapshot) => {
      const productsObj = prodSnapshot.val() || {};
      
      const availableStocks = {};
      const productsCatalog = [];
      Object.keys(productsObj).forEach(key => {
        const prodName = productsObj[key].name;
        const initStock = parseFloat(productsObj[key].initial_stock) || 0;
        availableStocks[prodName] = initStock;
        productsCatalog.push({ key, name: prodName, initial_stock: initStock });
      });

      stocksRef.once('value', (snapshot) => {
        const stocksObj = snapshot.val() || {};
        const stocksList = Object.keys(stocksObj).map(key => ({
          id: key,
          ...stocksObj[key]
        }));

        // Sort by date/time descending (newest first)
        stocksList.sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));

        let todayIncoming = 0;
        let todayOutgoing = 0;
        const todayStr = new Date().toISOString().split('T')[0];

        stocksList.forEach(s => {
          const item = s.item_name;
          const qty = parseFloat(s.quantity) || 0;
          const type = s.type;
          const datePart = s.transaction_date.split('T')[0];

          // Initialize at 0 if not present in catalog
          if (availableStocks[item] === undefined) {
            availableStocks[item] = 0;
          }

          if (type === 'INCOMING') {
            availableStocks[item] += qty;
          } else if (type === 'OUTGOING') {
            availableStocks[item] -= qty;
          }

          // Today's statistics
          if (datePart === todayStr) {
            if (type === 'INCOMING') {
              todayIncoming += qty;
            } else if (type === 'OUTGOING') {
              todayOutgoing += qty;
            }
          }
        });

        // Filter out zero stock items unless they belong to the configured catalog
        const availableList = Object.keys(availableStocks).map(itemName => ({
          item_name: itemName,
          quantity: Math.max(0, availableStocks[itemName])
        })).filter(item => {
          if (item.quantity > 0) return true;
          // Keep catalog items at 0 so they show up
          return productsCatalog.some(p => p.name.toLowerCase() === item.item_name.toLowerCase());
        });

        res.json({
          transactions: stocksList,
          available: availableList,
          products: productsCatalog,
          summary: {
            todayIncoming,
            todayOutgoing
          }
        });
      });
    });
  } catch (err) {
    console.error('Error fetching stocks:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Log a new stock transaction (INCOMING or OUTGOING)
app.post('/api/stocks', requireAuth, async (req, res) => {
  try {
    const userSlug = req.userId;
    const { 
      item_name, 
      type, 
      quantity, 
      price, 
      vehicle_number, 
      vehicle_id,
      worker_id, 
      worker_name, 
      is_wastage, 
      batch_number, 
      expiry_date, 
      supplier_info,
      party_name,
      party_contact,
      payment_status,
      amount_paid,
      transaction_date 
    } = req.body;

    if (!item_name || !type || !quantity || !price || !transaction_date) {
      return res.status(400).json({ error: 'Item name, type, quantity, price and date are required' });
    }

    const qtyVal = parseFloat(quantity);
    const priceVal = parseFloat(price);
    const totalAmount = qtyVal * priceVal;

    if (qtyVal <= 0 || priceVal <= 0) {
      return res.status(400).json({ error: 'Quantity and price must be greater than zero' });
    }

    const isWastage = !!is_wastage;

    // 1. Log in the general finance ledger first to get the transaction ID
    const financeRef = db.ref(`finance_transactions/${userSlug}`);
    const newFinanceTxRef = financeRef.push();
    const financeTxId = newFinanceTxRef.key;

    const ledgerType = isWastage ? 'EXPENSE' : (type === 'INCOMING' ? 'EXPENSE' : 'INCOME');
    const ledgerCategory = isWastage ? 'Wastage' : (type === 'INCOMING' ? 'Stock Purchase' : 'Stock Sale');
    
    let ledgerDesc = '';
    if (isWastage) {
      ledgerDesc = `Wastage/Spoilage: ${qtyVal} kg of ${item_name}${batch_number ? ` (Lot: ${batch_number})` : ''}`;
    } else {
      const partyLabel = type === 'INCOMING' ? 'from' : 'to';
      const partyStr = party_name ? ` ${partyLabel} ${party_name}` : '';
      const payStr = payment_status ? ` | Payment: ${payment_status}` : '';
      ledgerDesc = `${type === 'INCOMING' ? 'Purchased' : 'Sold'} ${qtyVal} kg of ${item_name}${vehicle_number ? ` via vehicle ${vehicle_number}` : ''}${partyStr}${payStr}`;
    }

    const dateOnly = transaction_date.split('T')[0];

    const ledgerData = {
      type: ledgerType,
      category: ledgerCategory,
      description: ledgerDesc,
      amount: totalAmount,
      date: dateOnly,
      related_worker_id: worker_id || null,
      related_vehicle_id: vehicle_id || null,
      created_at: new Date().toISOString()
    };

    await newFinanceTxRef.set(ledgerData);

    // 2. Save the stock transaction record in Firebase linked to the ledger ID
    const stocksRef = db.ref(`stocks/${userSlug}`);
    const newStockRef = stocksRef.push();
    const stockId = newStockRef.key;

    const stockData = {
      item_name,
      type: isWastage ? 'OUTGOING' : type,
      quantity: qtyVal,
      price: priceVal,
      total_amount: totalAmount,
      vehicle_number: vehicle_number || '',
      vehicle_id: vehicle_id || null,
      worker_id: worker_id || null,
      worker_name: worker_name || null,
      is_wastage: isWastage,
      batch_number: batch_number || '',
      expiry_date: expiry_date || '',
      supplier_info: supplier_info || '',
      party_name: party_name || '',
      party_contact: party_contact || '',
      payment_status: payment_status || 'pending',
      amount_paid: parseFloat(amount_paid) || 0,
      transaction_date,
      finance_tx_id: financeTxId,
      created_at: new Date().toISOString()
    };

    await newStockRef.set(stockData);

    res.json({ success: true, stock: { id: stockId, ...stockData } });
  } catch (err) {
    console.error('Error saving stock entry:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delete a stock transaction and its linked finance ledger entry
app.delete('/api/stocks/:id', requireAuth, async (req, res) => {
  try {
    const userSlug = req.userId;
    const stockId = req.params.id;

    const stockRef = db.ref(`stocks/${userSlug}/${stockId}`);
    
    stockRef.once('value', async (snapshot) => {
      const stock = snapshot.val();
      if (!stock) {
        return res.status(404).json({ error: 'Stock transaction not found' });
      }

      // 1. Delete the linked general ledger transaction if it exists
      if (stock.finance_tx_id) {
        const financeRef = db.ref(`finance_transactions/${userSlug}/${stock.finance_tx_id}`);
        await financeRef.remove();
      }

      // 2. Delete the stock transaction itself
      await stockRef.remove();

      res.json({ success: true });
    });
  } catch (err) {
    console.error('Error deleting stock entry:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Start Express Server
module.exports = app;