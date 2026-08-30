const fs = require('fs');
const path = require('path');
const dir = 'f:/The/frontend';
const files = ['home.html', 'finance.html', 'stocks.html', 'vehicles.html', 'workers.html', 'reports.html', 'profile.html'];

files.forEach(file => {
  let p = path.join(dir, file);
  let content = fs.readFileSync(p, 'utf8');
  
  if (!content.includes('sidebar-overlay')) {
    content = content.replace(/<aside>/, '<div class=\"sidebar-overlay\" onclick=\"document.body.classList.remove(\'nav-open\')\"></div>\n  <aside>');
  }
  
  if (!content.includes('mobile-menu-btn')) {
    content = content.replace(/<header class=\"header\">\s*(<div class=\"header-left\">|<h1)/, '<header class=\"header\">\n      <button class=\"mobile-menu-btn\" onclick=\"document.body.classList.toggle(\'nav-open\')\">\n        <svg viewBox=\"0 0 24 24\"><line x1=\"3\" y1=\"12\" x2=\"21\" y2=\"12\"></line><line x1=\"3\" y1=\"6\" x2=\"21\" y2=\"6\"></line><line x1=\"3\" y1=\"18\" x2=\"21\" y2=\"18\"></line></svg>\n      </button>\n      ');
  }

  fs.writeFileSync(p, content);
  console.log('Updated ' + file);
});
