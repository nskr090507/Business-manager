// Local development entry point
// On Vercel, api/index.js is used directly (serverless)
// Locally, this file starts an HTTP server on PORT 3000

const app = require('./api/index.js');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/login.html to get started`);
});
