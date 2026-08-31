const fs = require('fs');
const path = require('path');
const dir = 'f:/The/public';
const files = ['home.html', 'finance.html', 'stocks.html', 'vehicles.html', 'workers.html', 'reports.html', 'profile.html'];

files.forEach(file => {
  let p = path.join(dir, file);
  let content = fs.readFileSync(p, 'utf8');
  
  // Remove socket script tag
  content = content.replace(/<script src="https:\/\/cdn\.socket\.io\/4\.7\.2\/socket\.io\.min\.js"><\/script>\n?/g, '');
  
  // Remove socket logic
  content = content.replace(/\s*\/\/ Socket\.IO Real-Time Notifications[\s\S]*?(?=\/\/ Initial load|\/\/ Page load)/g, '\n      ');
  
  fs.writeFileSync(p, content);
  console.log('Removed socket logic from ' + file);
});
