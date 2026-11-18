// Startup file for cPanel "Setup Node.js App" / Application Manager (Phusion Passenger).
// Passenger loads this file directly (it does not run "npm start"). The server
// itself is written as ES modules, so this CommonJS file loads it with a
// dynamic import (the root package.json has no "type": "module").
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
import('./server/src/server.js').catch((err) => {
  // eslint-disable-next-line no-console
  console.error('blogSite failed to start:', err);
  process.exit(1);
});
