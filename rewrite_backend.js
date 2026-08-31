const fs = require('fs');
let code = fs.readFileSync('f:/The/api/index.js', 'utf8');

// Remove socket.io initialization
code = code.replace(/const http = require\('http'\);\nconst { Server } = require\('socket\.io'\);\nconst server = http\.createServer\(app\);\nconst io = new Server\(server, \{\n  cors: \{ origin: "\*" \}\n\}\);\n/, '');

// Remove socket io broadcasts
code = code.replace(/\s*\/\/ Broadcast Socket notification\s*io\.to\([^)]*\)\.emit\([^)]*\);\s*/g, '\n');
code = code.replace(/\s*io\.to\([^)]*\)\.emit\([^)]*\);\s*/g, '\n');

// Remove connection listener completely (everything between REALTIME SOCKET CONNECTIONS and Start Express)
code = code.replace(/\/\/ REALTIME SOCKET CONNECTIONS[\s\S]*?\/\/ Start Express \+ HTTP \+ Socket Server/, '// Start Express Server');

// Replace server.listen with module.exports
code = code.replace(/server\.listen\(PORT, \(\) => \{\n  console\.log\(Express server running on http:\/\/localhost:\$\{PORT\}\);\n\}\);/, 'module.exports = app;');

fs.writeFileSync('f:/The/api/index.js', code);
console.log('Backend rewritten for serverless');
