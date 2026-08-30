# Business Manager PRO

A comprehensive, full-stack business management application designed for monitoring and managing workers (staff), vehicles, routes, and finances. The system uses a Node.js/Express backend integrated with **Google Firebase Realtime Database**, **Firebase Authentication (simulation)**, **Socket.IO** for real-time notifications, **Leaflet.js** maps for route planning, and features comprehensive export tools for PDF, Excel, and CSV report formats.

## Key Features

1. **Worker Management**:
   - Staff directory with profiles, roles, and status.
   - Wage payment logs (daily rates) that automatically link as expenses in the financial ledger.
   - Wage payment history list per employee.
   
2. **Vehicle & Route Management**:
   - Fleet registry with make, model, type, and license plate records.
   - Maintenance log with scheduled service history (syncs costs to the financial ledger).
   - Route tracking with distances, fuel liters consumed, route revenues (income), and fuel costs (expense).
   - Interactive Leaflet.js map for planning route waypoints, measuring coordinates, and auto-calculating distances/fuel.

3. **Financial Dashboard**:
   - Consolidated ledger of income (service revenues) and expenses (daily wages, maintenance, fuel, operations).
   - Financial indicators: Gross Revenue, Total Expenses, Net Profit, and Profit Margins.
   - Interactive doughnut charts showing expense breakdowns.
   - Budget alerts (warnings trigger on over-budget states).

4. **Real-time Notifications**:
   - Socket.IO connection for instant alerts on maintenance due dates (triggers for services scheduled within the next 7 days).
   - Dashboard reminders and alerts listing.

5. **Integrated Analytics & Exports**:
   - Date-filtered data sheets.
   - **PDF Export**: Consolidated formatted PDF reports using `pdfkit`.
   - **Excel Export**: Styled multiple-sheet Excel workbooks using `exceljs`.
   - **CSV Export**: Standard CSV ledger tables.

---

## Project Structure

```
business-manager-pro/
├─ public/                   # Client-side static files
│  ├─ style.css              # Premium mid-tone UI styling
│  ├─ index.html             # Client-side gateway router
│  ├─ login.html             # Login view
│  ├─ signup.html            # Registration view
│  ├─ home.html              # Main KPI dashboard
│  ├─ workers.html           # Workers list & payroll payments
│  ├─ vehicles.html          # Vehicles, maintenance, route planning & Leaflet maps
│  ├─ finance.html           # Financial ledger, custom transactions & budgets
│  └─ reports.html           # PDF/Excel/CSV compilation & exports
├─ firebase-service-account.json  # Firebase Admin private certificate (loaded locally)
├─ server.js                 # Express server with REST APIs, sockets, and reports
├─ package.json              # Dependency manifests
├─ .env                      # App environment variables
└─ README.md                 # Project documentation
```

---

## Setup & Running

### Prerequisites
- Node.js (v16.0.0 or later)
- NPM (v7.0.0 or later)
- Firebase Project setup with Realtime Database enabled

### Installation

1. Clone or copy the project files to your server directory.
2. Open a terminal in the folder and install dependencies:
   ```bash
   npm install
   ```

3. **Firebase Setup**:
   - **Local Development**: Save your Firebase private key certificate in the root directory as `firebase-service-account.json`.
   - **Cloud Deployment**: Set the `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable to the contents of your service account private key file as a single-line JSON string. This prevents having to check credentials files into repository source control.
   - Note: The default database URL points to the `farmsense-ai-a40c6` default database in `Asia-Southeast1`. You can override it by setting the `FIREBASE_DATABASE_URL` environment variable.

4. **Environment Variables Config**:
   Copy `.env.example` to `.env` and fill in the values:
   - `PORT`: Server port (defaults to 3000)
   - `JWT_SECRET`: Hashing secret key for JWT session tokens
   - `FIREBASE_DATABASE_URL`: Firebase Realtime Database URL
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: Service account key string (for cloud deployments)
   - `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE`: SMTP server configs (for notifications)
   - `EMAIL_USER` / `EMAIL_PASS`: SMTP email user and password credentials

5. Start the server:
   - **Development Mode** (with nodemon auto-restart):
     ```bash
     npm run dev
     ```
   - **Production Mode**:
     ```bash
     npm start
     ```

6. Open your browser and navigate to `http://localhost:3000`. You will be routed to the Login page. Create a profile and start managing your operations!

---

## API Endpoints

### Authentication
- `POST /api/signup` – Register a new account (stores hashed password in Firebase).
- `POST /api/login` – Log in and receive a session JWT.
- `GET /api/me` – Retrieve profile of current logged-in user.
- `GET /api/settings` – Load monthly budget thresholds.
- `PUT /api/settings` – Save monthly budget configurations.

### Workers & Payroll
- `GET /api/workers` – List all workers.
- `POST /api/workers` – Add worker profile.
- `PUT /api/workers/:id` – Update worker details.
- `DELETE /api/workers/:id` – Remove worker.
- `GET /api/workers/:id/payments` – Load payments history for a worker.
- `POST /api/workers/:id/payments` – Log wage payment (syncs as an EXPENSE).

### Vehicles & Fleet
- `GET /api/vehicles` – List fleet registry.
- `POST /api/vehicles` – Register vehicle.
- `PUT /api/vehicles/:id` – Update vehicle details.
- `DELETE /api/vehicles/:id` – Delete vehicle.
- `GET /api/vehicles/:id/maintenance` – List maintenance history.
- `POST /api/vehicles/:id/maintenance` – Log maintenance service (syncs as an EXPENSE).
- `GET /api/vehicles/:id/routes` – List routes completed.
- `POST /api/vehicles/:id/routes` – Dispatch/log route path (syncs fuel cost as EXPENSE and revenue as INCOME).

### Finance Ledger
- `GET /api/finance/transactions` – Filter ledger sheet (by date, category, type).
- `POST /api/finance/transactions` – Log custom income/expense entry.
- `DELETE /api/finance/transactions/:id` – Delete ledger entry.
- `GET /api/finance/summary` – Retrieve KPI calculations (Margins, revenue, fleet metrics).

### Notifications & Triggers
- `GET /api/notifications` – Fetch unread alerts.
- `PUT /api/notifications/:id/read` – Mark alert as read.
- `POST /api/notifications/check-triggers` – Triggers scan for vehicles requiring maintenance.

### Reports Compilation & Exports
- `POST /api/reports/generate` – Load consolidated data JSON for table rendering.
- `GET /api/reports/export/csv` – Stream CSV spreadsheet.
- `GET /api/reports/export/excel` – Download styled multiple-sheet Excel file.
- `GET /api/reports/export/pdf` – Download compiled PDF summary.

---

## License

This project is licensed under the MIT License.