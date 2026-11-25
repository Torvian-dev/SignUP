/**
 * Practice site for end-to-end testing: a fictional supplier portal with
 *  - a landing page with no form (agent must follow "Register as a supplier"),
 *  - a 3-step client-side (SPA-style) registration with non-standard labels,
 *  - a honeypot field, a country <select>, a date with DD/MM/YYYY format,
 *  - a reCAPTCHA-style widget on the last step (test site key, no Google script),
 *  - a confirmation page. Received submissions are listed at /submissions.
 *
 *   node test/practice-site/server.mjs   (PORT=5055)
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 5055);
const submissions = [];

const page = (title, body) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui,sans-serif;margin:0;background:#f4f6f8;color:#1b1f24}
  header{background:#123c69;color:#fff;padding:16px 32px;font-weight:600}
  main{max-width:560px;margin:32px auto;background:#fff;border-radius:10px;padding:28px 32px;box-shadow:0 1px 3px #0002}
  .row{margin-bottom:14px} label{display:block;font-size:14px;margin-bottom:4px}
  input[type=text],input[type=email],input[type=tel],input[type=password],select{width:100%;padding:8px;border:1px solid #c5ccd3;border-radius:6px;font-size:14px;box-sizing:border-box}
  .check label{display:inline} button,.btn{background:#123c69;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:14px;cursor:pointer;text-decoration:none;display:inline-block}
  .steps{font-size:13px;color:#5b6570;margin-bottom:16px} .hp{position:absolute;left:-9999px}
  .g-recaptcha{border:1px solid #d3d3d3;background:#f9f9f9;border-radius:3px;width:300px;padding:18px;margin:12px 0;font-size:13px}
  .err{color:#b00020;font-size:13px}
</style></head><body><header>Acme Supplier Portal</header><main>${body}</main></body></html>`;

const LANDING = page("Acme Supplier Portal", `
  <h1>Work with Acme</h1>
  <p>Join our approved supplier list to receive purchase orders and tenders.</p>
  <p><a class="btn" href="/register">Register as a supplier</a></p>`);

const REGISTER = page("Supplier registration", `
  <h1>Supplier registration</h1>
  <div id="app"></div>
<script>
  const state = {};
  const steps = [
    () => \`<div class="steps">Step 1 of 3 — Contact details</div>
      <form id="f">
        <div class="row"><label for="fn">Forename</label><input type="text" id="fn" name="contact_fn" required></div>
        <div class="row"><label for="ln">Family name</label><input type="text" id="ln" name="contact_ln" required></div>
        <div class="row"><label for="em">Work e-mail</label><input type="email" id="em" name="work_mail" required></div>
        <div class="row"><label for="mob">Mobile number</label><input type="tel" id="mob" name="mob" placeholder="07…" required></div>
        <div class="row"><label for="co">Company / trading name</label><input type="text" id="co" name="trading_name" required></div>
        <div class="hp"><label for="website">Leave this empty</label><input type="text" id="website" name="website" tabindex="-1"></div>
        <button type="submit">Continue</button>
      </form>\`,
    () => \`<div class="steps">Step 2 of 3 — Business address</div>
      <form id="f">
        <div class="row"><label for="a1">House number and street</label><input type="text" id="a1" name="addr_1" required></div>
        <div class="row"><label for="town">Town</label><input type="text" id="town" name="town" required></div>
        <div class="row"><label for="county">County</label><input type="text" id="county" name="county"></div>
        <div class="row"><label for="pc">Postcode</label><input type="text" id="pc" name="pc" autocomplete="postal-code" required></div>
        <div class="row"><label for="ctry">Country</label><select id="ctry" name="ctry" autocomplete="country" required>
          <option value="">Please select</option><option value="GB">United Kingdom</option><option value="IE">Ireland</option>
          <option value="FR">France</option><option value="US">United States</option></select></div>
        <div class="row"><label for="dob">Director's date of birth</label><input type="text" id="dob" name="director_dob" placeholder="DD/MM/YYYY" pattern="\\\\d{2}/\\\\d{2}/\\\\d{4}" required></div>
        <button type="submit">Continue</button>
      </form>\`,
    () => \`<div class="steps">Step 3 of 3 — Create your login</div>
      <form id="f">
        <div class="row"><label for="pw">Choose a password</label><input type="password" id="pw" name="pw" autocomplete="new-password" minlength="12" required></div>
        <div class="row"><label for="pw2">Repeat password</label><input type="password" id="pw2" name="pw2" autocomplete="new-password" minlength="12" required></div>
        <div class="row check"><input type="checkbox" id="terms" name="terms" required> <label for="terms">I accept the supplier terms and privacy notice</label></div>
        <div class="row check"><input type="checkbox" id="news" name="news"> <label for="news">Send me tender alerts and marketing</label></div>
        <div class="g-recaptcha" data-sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI" role="checkbox" aria-checked="false" tabindex="0"
             onclick="document.getElementById('g-recaptcha-response').value='practice-token-'+Date.now();this.innerHTML='☑ Verified <small>(practice widget)</small>';this.setAttribute('aria-checked','true')">☐ I'm not a robot <small>(practice widget — click to verify)</small></div>
        <textarea name="g-recaptcha-response" id="g-recaptcha-response" style="display:none"></textarea>
        <p class="err" id="err"></p>
        <button type="submit">Create account</button>
      </form>\`,
  ];
  let i = 0;
  function render() {
    document.getElementById("app").innerHTML = steps[i]();
    document.getElementById("f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      for (const [k, v] of fd.entries()) state[k] = v;
      if (i < steps.length - 1) { i++; history.pushState({}, "", "/register?step=" + (i + 1)); render(); return; }
      if (state.pw !== state.pw2) { document.getElementById("err").textContent = "Passwords do not match"; return; }
      const r = await fetch("/api/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(state) });
      if (r.ok) location.href = "/thanks";
      else document.getElementById("err").textContent = (await r.json()).error;
    });
  }
  render();
</script>`);

const THANKS = page("Registration complete", `<h1>Thank you — your supplier account has been created</h1><p>We've sent a confirmation to your work e-mail.</p>`);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const html = (s, code = 200) => { res.writeHead(code, { "content-type": "text/html; charset=utf-8" }); res.end(s); };
  if (url.pathname === "/") return html(LANDING);
  if (url.pathname === "/register") return html(REGISTER);
  if (url.pathname === "/thanks") return html(THANKS);
  if (url.pathname === "/submissions") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(submissions.map(({ pw, pw2, ...rest }) => ({ ...rest, pw: pw ? `<${pw.length} chars>` : null })), null, 2));
  }
  if (url.pathname === "/api/register" && req.method === "POST") {
    let body = ""; for await (const c of req) body += c;
    const data = JSON.parse(body);
    if (data.website) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "Bot detected (honeypot filled)" })); }
    if (!data["g-recaptcha-response"]) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "Please complete the CAPTCHA" })); }
    if (!data.terms) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "You must accept the terms" })); }
    submissions.push({ ...data, receivedAt: new Date().toISOString() });
    res.writeHead(201, { "content-type": "application/json" }); return res.end("{}");
  }
  html("<h1>Not found</h1>", 404);
}).listen(PORT, () => console.log(`practice site on http://localhost:${PORT}`));
