import net from "node:net";
import tls from "node:tls";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Sign-in links travel by email. This is the small SMTP client Kooks needs
// (implicit TLS or STARTTLS, AUTH PLAIN or LOGIN, one text message) plus a
// file outbox for development and tests.

const loopback = (host) => ["127.0.0.1", "localhost", "::1"].includes(host);
export const isEmail = (value) =>
  typeof value === "string" &&
  value.length <= 254 &&
  /^[^\s@<>,;:"'()[\]\\]+@[^\s@<>,;:"'()[\]\\]+\.[^\s@<>,;:"'()[\]\\.]{2,}$/.test(
    value,
  );
// "Name <box@example.com>" or "box@example.com".
export function parseAddress(value, what = "The address") {
  const text = String(value ?? "").trim();
  const bracketed = text.match(/^(?:"?([^"<>]*?)"?\s*)?<([^<>\s]+)>$/);
  const match = bracketed ?? (/[\s<>]/.test(text) ? null : ["", "", text]);
  if (!match || !isEmail(match[2]))
    throw new Error(
      `${what} must be an email address such as "Kooks <kooks@example.com>".`,
    );
  return { name: (match[1] ?? "").trim(), address: match[2] };
}

export function formatMessage({ from, to, subject, text, date = new Date() }) {
  const header = (name, value) =>
    `${name}: ${String(value).replace(/[\r\n]+/g, " ")}`;
  const ascii = /^[\t\n\r\x20-\x7e]*$/.test(text) && !/[^\n]{999}/.test(text);
  const body = ascii
    ? text.replace(/\r?\n/g, "\r\n")
    : Buffer.from(text, "utf8")
        .toString("base64")
        .replace(/.{76}(?=.)/g, "$&\r\n");
  const encodedSubject = /^[\x20-\x7e]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const domain = parseAddress(from).address.split("@")[1];
  const message = [
    header("From", from),
    header("To", to),
    header("Subject", encodedSubject),
    header("Date", date.toUTCString().replace(/GMT$/, "+0000")),
    header("Message-ID", `<${randomBytes(12).toString("hex")}@${domain}>`),
    header("MIME-Version", "1.0"),
    header("Content-Type", "text/plain; charset=utf-8"),
    header("Content-Transfer-Encoding", ascii ? "7bit" : "base64"),
    header("Auto-Submitted", "auto-generated"),
    "",
    body,
  ].join("\r\n");
  return message.endsWith("\r\n") ? message : `${message}\r\n`;
}

function openSocket({ host, port, secure, tlsOptions }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host, ...tlsOptions })
      : net.connect({ host, port });
    socket.once(secure ? "secureConnect" : "connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}
// Reply-by-reply conversation over a socket that STARTTLS can replace.
function converse(initial, timeoutMs) {
  let socket,
    buffer = "",
    partial = [],
    pending = [],
    waiting = null,
    failure = null;
  const fail = (error) => {
    failure ??= error;
    if (waiting) {
      const { reject } = waiting;
      waiting = null;
      reject(error);
    }
  };
  const drain = () => {
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      partial.push(line);
      if (!/^\d{3}(?: |$)/.test(line)) continue;
      const reply = {
        code: Number(line.slice(0, 3)),
        lines: partial.map((l) => l.slice(4)),
      };
      partial = [];
      if (waiting) {
        const { resolve } = waiting;
        waiting = null;
        resolve(reply);
      } else pending.push(reply);
    }
  };
  const attach = (next) => {
    socket = next;
    socket.setTimeout(timeoutMs, () => {
      fail(new Error("The mail server stopped responding."));
      socket.destroy();
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      drain();
    });
    socket.on("error", fail);
    socket.on("close", () =>
      fail(new Error("The mail server closed the connection.")),
    );
  };
  const next = () =>
    pending.length
      ? Promise.resolve(pending.shift())
      : failure
        ? Promise.reject(failure)
        : new Promise((resolve, reject) => {
            waiting = { resolve, reject };
          });
  async function expect(codes, context) {
    const reply = await next();
    if (![].concat(codes).includes(reply.code))
      throw new Error(
        `The mail server refused ${context}: ${reply.code} ${reply.lines.join(" ").trim()}`,
      );
    return reply.lines;
  }
  attach(initial);
  return {
    expect,
    command(text, codes, context) {
      socket.write(`${text}\r\n`);
      return expect(codes, context);
    },
    upgrade({ host, tlsOptions }) {
      return new Promise((resolve, reject) => {
        const plain = socket;
        for (const event of ["data", "error", "close"])
          plain.removeAllListeners(event);
        plain.setTimeout(0);
        const secure = tls.connect({
          socket: plain,
          servername: host,
          ...tlsOptions,
        });
        secure.once("secureConnect", () => {
          attach(secure);
          resolve();
        });
        secure.once("error", reject);
      });
    },
    end: () => socket.destroy(),
  };
}
const clientName = () => {
  const name = hostname();
  return /^[A-Za-z0-9.-]+$/.test(name) ? name : "kooks.local";
};

export async function sendSmtp({
  url,
  from,
  to,
  message,
  timeoutMs = 20000,
  tls: tlsOptions = {},
}) {
  if (!isEmail(to)) throw new Error("The recipient is not an email address.");
  const target = new URL(url);
  const secure = target.protocol === "smtps:";
  const host = target.hostname.replace(/^\[|\]$/g, ""),
    port = Number(target.port || (secure ? 465 : 587));
  const user = decodeURIComponent(target.username),
    password = decodeURIComponent(target.password);
  const talk = converse(
    await openSocket({ host, port, secure, tlsOptions }),
    timeoutMs,
  );
  try {
    await talk.expect(220, "the connection");
    let extensions = await talk.command(`EHLO ${clientName()}`, 250, "EHLO");
    if (!secure) {
      if (extensions.some((line) => /^STARTTLS$/i.test(line.trim()))) {
        await talk.command("STARTTLS", 220, "STARTTLS");
        await talk.upgrade({ host, tlsOptions });
        extensions = await talk.command(`EHLO ${clientName()}`, 250, "EHLO");
      } else if (!loopback(host))
        throw new Error(
          `${host} does not offer STARTTLS, so Kooks will not send credentials or mail in the clear. Use smtps:// or a server with STARTTLS.`,
        );
    }
    if (user) {
      const offered = (extensions.find((line) => /^AUTH[ =]/i.test(line)) ?? "")
        .slice(5)
        .toUpperCase()
        .split(/[\s=]+/);
      const encode = (text) => Buffer.from(text, "utf8").toString("base64");
      if (offered.includes("PLAIN"))
        await talk.command(
          `AUTH PLAIN ${encode(`\0${user}\0${password}`)}`,
          235,
          "AUTH",
        );
      else if (offered.includes("LOGIN")) {
        await talk.command("AUTH LOGIN", 334, "AUTH");
        await talk.command(encode(user), 334, "AUTH");
        await talk.command(encode(password), 235, "AUTH");
      } else
        throw new Error(
          "The mail server offers neither AUTH PLAIN nor AUTH LOGIN.",
        );
    }
    await talk.command(`MAIL FROM:<${from}>`, 250, "MAIL FROM");
    await talk.command(`RCPT TO:<${to}>`, [250, 251], "RCPT TO");
    await talk.command("DATA", 354, "DATA");
    await talk.command(
      `${message.replace(/(^|\r\n)\./g, "$1..")}.`,
      250,
      "the message",
    );
    await talk.command("QUIT", 221, "QUIT").catch(() => {});
  } finally {
    talk.end();
  }
}

// null when nothing is configured; the server decides whether that matters.
export function createMailer({
  smtpUrl = "",
  from = "",
  outbox = "",
  tls = {},
  timeoutMs,
} = {}) {
  if (!smtpUrl && !outbox) return null;
  if (smtpUrl && outbox)
    throw new Error(
      "Set either KOOKS_SMTP_URL or KOOKS_MAIL_OUTBOX, not both.",
    );
  let sender = from;
  if (smtpUrl) {
    let url;
    try {
      url = new URL(smtpUrl);
    } catch {
      url = null;
    }
    if (!url || !["smtp:", "smtps:"].includes(url.protocol) || !url.hostname)
      throw new Error(
        "KOOKS_SMTP_URL must look like smtps://user:password@smtp.example.com:465 or smtp://user:password@smtp.example.com:587 (STARTTLS).",
      );
    if (!sender && isEmail(decodeURIComponent(url.username)))
      sender = decodeURIComponent(url.username);
    if (!sender)
      throw new Error(
        "KOOKS_MAIL_FROM is required: the address sign-in links are sent from.",
      );
  } else sender ||= "Kooks <kooks@kooks.local>";
  const { address } = parseAddress(sender, "KOOKS_MAIL_FROM");
  return {
    description: smtpUrl
      ? `by email through ${new URL(smtpUrl).hostname}`
      : `to files in ${outbox}`,
    async send({ to, subject, text }) {
      const message = formatMessage({ from: sender, to, subject, text });
      if (outbox) {
        mkdirSync(outbox, { recursive: true, mode: 0o700 });
        writeFileSync(
          join(outbox, `${Date.now()}-${randomBytes(4).toString("hex")}.eml`),
          message,
          { mode: 0o600 },
        );
        return;
      }
      await sendSmtp({
        url: smtpUrl,
        from: address,
        to,
        message,
        tls,
        timeoutMs,
      });
    },
  };
}
