import { embedOrigins } from "../shared/links.js";

// The policy the built page carries in a meta tag. On a phone the page comes
// from the app itself, where no server sends a policy, and requests go to
// the household's kitchen at its https address, wherever that is. In a
// browser the server's own, stricter policy applies as well, so there the
// page still talks only to the kitchen that served it.
export const pagePolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self' https:",
  `frame-src ${embedOrigins.join(" ")}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");
