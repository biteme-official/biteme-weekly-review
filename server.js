const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) return;
    process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const PORT = 3001;

function wrapReqRes(req, res) {
  const parsed = url.parse(req.url, true);
  req.query = parsed.query;

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try { req.body = JSON.parse(body); } catch { req.body = {}; }
  });

  res.status = (code) => {
    res.statusCode = code;
    return {
      end: () => res.end(),
      json: (obj) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(obj));
      }
    };
  };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  };
  return { req, res, pathname: parsed.pathname };
}

const API_MAP = {};
function loadApi(name) {
  if (!API_MAP[name]) {
    API_MAP[name] = require(`./api/${name}`);
  }
  return API_MAP[name];
}

const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url, true);

  if (pathname.startsWith('/api/')) {
    const apiName = pathname.replace('/api/', '').replace(/\/$/, '');
    const apiFile = path.join(__dirname, 'api', apiName + '.js');
    if (!fs.existsSync(apiFile)) {
      res.writeHead(404);
      return res.end('Not found');
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try { req.body = JSON.parse(body); } catch { req.body = {}; }
      req.query = url.parse(req.url, true).query;

      const origStatus = res.status;
      res.status = (code) => {
        res.statusCode = code;
        return {
          end: () => res.end(),
          json: (obj) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(obj));
          }
        };
      };
      res.json = (obj) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(obj));
      };

      try {
        const handler = loadApi(apiName);
        await handler(req, res);
      } catch (err) {
        console.error('API error:', err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
