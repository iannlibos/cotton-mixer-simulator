/**
 * Servidor estático para produção após `npm run build`.
 * Desenvolvimento: use `npm run dev` (Vite + React).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function safeJoin(base, rel) {
  const resolved = path.join(base, rel);
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }

  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "Build não encontrado. Execute: npm install && npm run build\n" +
        "Para desenvolvimento: npm run dev"
    );
    return;
  }

  const urlPath = new URL(req.url || "/", "http://localhost").pathname;
  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const file = safeJoin(DIST, rel);

  if (!file) {
    res.writeHead(403);
    res.end();
    return;
  }

  const ext = path.extname(file);
  const type = MIME[ext] || "application/octet-stream";

  fs.readFile(file, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        fs.readFile(path.join(DIST, "index.html"), (e2, html) => {
          if (e2) {
            res.writeHead(404);
            res.end("Not Found");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        });
        return;
      }
      res.writeHead(500);
      res.end("Server Error");
      return;
    }
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log("");
  console.log("  Nortex · Gerador de Misturas (produção)");
  console.log("  ----------------------------------------");
  console.log("  " + path.join(DIST, "index.html"));
  console.log("  http://localhost:" + PORT);
  console.log("");
});
