const fs = require('fs');
let code = fs.readFileSync('f:/The/api/index.js', 'utf8');

// Use powerful regex to strip all socket/http imports
code = code.replace(/const http = require\('http'\);\s*const \{ Server \} = require\('socket\.io'\);\s*/, '');

// Strip server creation
code = code.replace(/const server = http\.createServer\(app\);\s*const io = new Server\(server, \{[\s\S]*?\}\);\s*/, '');

// Strip listen and replace with export
code = code.replace(/server\.listen\([\s\S]*?\n\}\);/, 'module.exports = app;');

fs.writeFileSync('f:/The/api/index.js', code);
console.log('Fixed index.js');
