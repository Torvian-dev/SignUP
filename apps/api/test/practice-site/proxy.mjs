// Minimal forward proxy for local E2E testing only (plain HTTP + CONNECT). PORT=8899.
import http from "node:http"; import net from "node:net"; import { URL } from "node:url";
const PORT = Number(process.env.PROXY_PORT ?? 8899); let count = 0;
const server = http.createServer((req, res) => {
  count++;
  const u = new URL(req.url);
  const p = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers: req.headers }, (pr) => { res.writeHead(pr.statusCode ?? 502, pr.headers); pr.pipe(res); });
  p.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(p);
});
server.on("connect", (req, clientSocket, head) => {
  count++;
  const [host, port] = req.url.split(":");
  const s = net.connect(Number(port) || 443, host, () => { clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); s.write(head); s.pipe(clientSocket); clientSocket.pipe(s); });
  s.on("error", () => clientSocket.end());
});
server.listen(PORT, () => console.log(`proxy on ${PORT}`));
setInterval(() => console.log(`proxy requests handled: ${count}`), 10000).unref();
