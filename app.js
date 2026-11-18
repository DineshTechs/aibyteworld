// Startup file for Node.js hosting (MilesWeb GitHub deploys, cPanel "Setup Node.js
// App" / Passenger). It works whether or not the panel ran "npm install":
//
// 1. Packages: when they are missing, they are installed here first (npm ci).
// 2. Folders that must survive redeploys: hosts that put each deploy in a new
//    folder (…/deploys/<version>) get the settings file and photos from the
//    site folder above it: …/.env and …/uploads (created when missing).
// 3. Port: 3000 unless the host sets PORT.
//
// Start-up problems are written to logs/app.log (in the site folder) as well as
// the host's own log; the visitor only sees the host's 503 page.
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.PORT = process.env.PORT || '3000';

const deployed = path.basename(path.dirname(__dirname)) === 'deploys';
const siteHome = deployed ? path.dirname(path.dirname(__dirname)) : __dirname;

const logFile = path.join(siteHome, 'logs', 'app.log');
function note(...parts) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const text = parts.map((p) => (p instanceof Error ? p.stack || p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    // Never write connection strings with passwords to the log.
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${text.replace(/(mongodb(\+srv)?:\/\/[^:\s]+):[^@\s]+@/g, '$1:****@')}\n`);
  } catch {
    /* logging must never stop the app */
  }
}
const originalError = console.error.bind(console);
console.error = (...args) => {
  note(...args);
  originalError(...args);
};
process.on('uncaughtException', (err) => note('Uncaught error:', err));
process.on('unhandledRejection', (err) => note('Unhandled promise rejection:', err));
process.on('exit', (code) => {
  if (code) note(`The app stopped with exit code ${code}.`);
});

if (deployed) {
  const envFile = path.join(siteHome, '.env');
  if (!process.env.ENV_FILE && fs.existsSync(envFile)) process.env.ENV_FILE = envFile;
  if (!process.env.UPLOAD_DIR) {
    process.env.UPLOAD_DIR = path.join(siteHome, 'uploads');
    fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });
  }
}
note(`Starting: Node ${process.version}, folder ${__dirname}, settings ${process.env.ENV_FILE || 'server/.env or host variables'}, photos ${process.env.UPLOAD_DIR || 'server/uploads'}, port ${process.env.PORT}`);

// Install packages when the host did not.
function packagesReady() {
  try {
    require.resolve('express', { paths: [__dirname] });
    require.resolve('cors', { paths: [__dirname] });
    return true;
  } catch {
    return false;
  }
}
if (!packagesReady()) {
  note('Packages are missing: installing them (about a minute)...');
  const cmd = fs.existsSync(path.join(__dirname, 'package-lock.json')) ? 'npm ci --omit=dev --no-audit --no-fund' : 'npm install --omit=dev --no-audit --no-fund';
  try {
    execSync(cmd, { cwd: __dirname, stdio: 'inherit', timeout: 10 * 60 * 1000 });
    note('Packages installed.');
  } catch (err) {
    console.error(`Installing packages failed (${cmd}):`, err.message);
    process.exit(1);
  }
}

import('./server/src/server.js').catch((err) => {
  console.error('blogSite failed to start:', err);
  process.exit(1);
});
