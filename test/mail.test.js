import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMailer,
  formatMessage,
  parseAddress,
  sendSmtp,
} from "../web/mail.js";

// A self-signed certificate for localhost, when openssl is available.
function certificate(t) {
  const directory = mkdtempSync(join(tmpdir(), "kooks-mail-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "2",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
  } catch {
    return null;
  }
  return {
    key: readFileSync(join(directory, "key.pem")),
    cert: readFileSync(join(directory, "cert.pem")),
  };
}

// Enough SMTP to receive one message, with STARTTLS or implicit TLS.
function fakeSmtp(
  t,
  {
    starttls = null,
    implicit = null,
    mechanisms = "PLAIN LOGIN",
    rejectRecipient = false,
  } = {},
) {
  const received = [];
  function serve(socket) {
    let current = socket,
      buffer = "",
      data = null,
      login = null,
      session = { auth: null, from: null, to: [] };
    const write = (text) => current.write(`${text}\r\n`);
    const listen = (s) => {
      current = s;
      s.on("data", (chunk) => {
        buffer += chunk.toString();
        handle();
      });
      s.on("error", () => {});
    };
    function handle() {
      let index;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line === ".") {
            received.push({ ...session, message: `${data.join("\r\n")}\r\n` });
            data = null;
            write("250 queued");
          } else data.push(line.startsWith("..") ? line.slice(1) : line);
          continue;
        }
        if (login === "user") {
          session.auth = {
            mechanism: "LOGIN",
            user: Buffer.from(line, "base64").toString(),
          };
          login = "pass";
          write("334 UGFzc3dvcmQ6");
          continue;
        }
        if (login === "pass") {
          session.auth.pass = Buffer.from(line, "base64").toString();
          login = null;
          write("235 ok");
          continue;
        }
        const [verb, ...rest] = line.split(" ");
        switch (verb.toUpperCase()) {
          case "EHLO":
            write("250-fake.example");
            if (starttls && current === socket) write("250-STARTTLS");
            write(`250-AUTH ${mechanisms}`);
            write("250 8BITMIME");
            break;
          case "STARTTLS": {
            write("220 go ahead");
            socket.removeAllListeners("data");
            listen(
              new tls.TLSSocket(socket, {
                isServer: true,
                secureContext: tls.createSecureContext(starttls),
              }),
            );
            break;
          }
          case "AUTH":
            if (rest[0] === "PLAIN") {
              const [, user, pass] = Buffer.from(rest[1], "base64")
                .toString()
                .split("\0");
              session.auth = { mechanism: "PLAIN", user, pass };
              write("235 ok");
            } else {
              login = "user";
              write("334 VXNlcm5hbWU6");
            }
            break;
          case "MAIL":
            session.from = line.match(/<([^>]*)>/)[1];
            write("250 ok");
            break;
          case "RCPT":
            if (rejectRecipient) write("550 no such mailbox");
            else {
              session.to.push(line.match(/<([^>]*)>/)[1]);
              write("250 ok");
            }
            break;
          case "DATA":
            data = [];
            write("354 go");
            break;
          case "QUIT":
            write("221 bye");
            current.end();
            break;
          default:
            write("500 unknown");
        }
      }
    }
    listen(socket);
    write("220 fake.example ESMTP");
  }
  const server = implicit
    ? tls.createServer(implicit, serve)
    : net.createServer(serve);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      t.after(() => new Promise((done) => server.close(done)));
      resolve({ port: server.address().port, received });
    }),
  );
}
const message = (text) =>
  formatMessage({
    from: "Kooks <kooks@example.test>",
    to: "cook@example.test",
    subject: "Sign in",
    text,
  });

test("formats a readable message with safe headers", () => {
  const plain = message(
    "Open this link:\n\nhttps://kooks.example/#/signin/abc\n",
  );
  assert.match(
    plain,
    /^From: Kooks <kooks@example.test>\r\nTo: cook@example.test\r\nSubject: Sign in\r\nDate: .* \+0000\r\nMessage-ID: <[a-f0-9]{24}@example.test>\r\n/,
  );
  assert.match(
    plain,
    /Content-Transfer-Encoding: 7bit\r\nAuto-Submitted: auto-generated\r\n\r\nOpen this link:\r\n\r\nhttps:\/\/kooks\.example\/#\/signin\/abc\r\n$/,
  );
  const unicode = formatMessage({
    from: "kooks@example.test",
    to: "cook@example.test",
    subject: "Café ✓",
    text: "Bon appétit",
  });
  assert.match(unicode, /Subject: =\?UTF-8\?B\?Q2Fmw6kg4pyT\?=\r\n/);
  assert.match(
    unicode,
    /Content-Transfer-Encoding: base64\r\nAuto-Submitted: auto-generated\r\n\r\nQm9uIGFwcMOpdGl0\r\n$/,
  );
  assert.deepEqual(parseAddress("Kooks <kooks@example.test>"), {
    name: "Kooks",
    address: "kooks@example.test",
  });
  assert.deepEqual(parseAddress("kooks@example.test"), {
    name: "",
    address: "kooks@example.test",
  });
  assert.throws(
    () => parseAddress("not an address", "KOOKS_MAIL_FROM"),
    /KOOKS_MAIL_FROM must be an email address/,
  );
});

test("sends through STARTTLS with AUTH PLAIN and dot-stuffs the message", async (t) => {
  const cert = certificate(t);
  if (!cert) return t.skip("openssl is not available");
  const { port, received } = await fakeSmtp(t, { starttls: cert });
  const text = "Hello\n.hidden line\n..double\nbye\n";
  await sendSmtp({
    url: `smtp://cook%40example.test:s%3Acret@localhost:${port}`,
    from: "kooks@example.test",
    to: "cook@example.test",
    message: message(text),
    tls: { ca: cert.cert },
  });
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].auth, {
    mechanism: "PLAIN",
    user: "cook@example.test",
    pass: "s:cret",
  });
  assert.equal(received[0].from, "kooks@example.test");
  assert.deepEqual(received[0].to, ["cook@example.test"]);
  assert.ok(
    received[0].message.endsWith(
      "Hello\r\n.hidden line\r\n..double\r\nbye\r\n",
    ),
  );
});

test("uses implicit TLS and AUTH LOGIN when PLAIN is not offered", async (t) => {
  const cert = certificate(t);
  if (!cert) return t.skip("openssl is not available");
  const { port, received } = await fakeSmtp(t, {
    implicit: cert,
    mechanisms: "LOGIN",
  });
  const mailer = createMailer({
    smtpUrl: `smtps://kooks%40example.test:pw@localhost:${port}`,
    tls: { ca: cert.cert },
  });
  assert.equal(mailer.description, "by email through localhost");
  await mailer.send({
    to: "cook@example.test",
    subject: "Sign in",
    text: "Link\n",
  });
  assert.deepEqual(received[0].auth, {
    mechanism: "LOGIN",
    user: "kooks@example.test",
    pass: "pw",
  });
  assert.match(received[0].message, /^From: kooks@example.test\r\n/);
});

test("talks plainly only to loopback and reports refusals", async (t) => {
  const { port, received } = await fakeSmtp(t);
  await sendSmtp({
    url: `smtp://127.0.0.1:${port}`,
    from: "kooks@example.test",
    to: "cook@example.test",
    message: message("Plain\n"),
  });
  assert.equal(received[0].auth, null);
  const refusing = await fakeSmtp(t, { rejectRecipient: true });
  await assert.rejects(
    sendSmtp({
      url: `smtp://127.0.0.1:${refusing.port}`,
      from: "kooks@example.test",
      to: "cook@example.test",
      message: message("Plain\n"),
    }),
    /refused RCPT TO: 550 no such mailbox/,
  );
  await assert.rejects(
    sendSmtp({
      url: `smtp://127.0.0.1:${port}`,
      from: "kooks@example.test",
      to: "bad\r\nRCPT",
      message: "",
    }),
    /not an email address/,
  );
});

test("configuration picks one transport and a sender", async (t) => {
  assert.equal(createMailer({}), null);
  assert.throws(
    () => createMailer({ smtpUrl: "smtp://x", outbox: "/tmp/x" }),
    /not both/,
  );
  assert.throws(
    () => createMailer({ smtpUrl: "https://x" }),
    /KOOKS_SMTP_URL must look like/,
  );
  assert.throws(
    () => createMailer({ smtpUrl: "smtp://robot:pw@mail.example" }),
    /KOOKS_MAIL_FROM is required/,
  );
  assert.throws(
    () => createMailer({ smtpUrl: "smtp://mail.example", from: "nope" }),
    /KOOKS_MAIL_FROM must be/,
  );
  const outbox = join(mkdtempSync(join(tmpdir(), "kooks-outbox-")), "mail");
  t.after(() => rmSync(outbox, { recursive: true, force: true }));
  const mailer = createMailer({ outbox });
  assert.equal(mailer.description, `to files in ${outbox}`);
  await mailer.send({
    to: "cook@example.test",
    subject: "Sign in",
    text: "https://kooks.example/#/signin/token\n",
  });
  const files = readdirSync(outbox);
  assert.equal(files.length, 1);
  assert.match(
    readFileSync(join(outbox, files[0]), "utf8"),
    /From: Kooks <kooks@kooks.local>\r\n[\s\S]*https:\/\/kooks\.example\/#\/signin\/token\r\n$/,
  );
});
