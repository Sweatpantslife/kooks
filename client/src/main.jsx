import { render } from "preact";
import { effect } from "@preact/signals";
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import { route, startRouter, navigate } from "./lib/router.js";
import { confirmLink, openInvite, refresh, startPolling } from "./lib/store.js";
import { startTheme } from "./lib/theme.js";
import { startNative } from "./lib/native.js";
import { App } from "./app.jsx";

startTheme();
startRouter();

// An emailed sign-in link opens #/signin/<token>, and an invite
// #/join/<token>; anything else loads the kitchen as whoever this browser is
// signed in as.
const linked = (kind) => (route.value[0] === kind ? route.value[1] : null);
if (!linked("signin") && !linked("join")) void refresh();
const leave = () => navigate("week", { replace: true });
effect(() => {
  const token = linked("signin");
  if (token) void confirmLink(token, leave);
});
effect(() => {
  const token = linked("join");
  if (token) void openInvite(token, leave);
});
startPolling();
// On a phone, the back button goes back a page until the week, then leaves
// the app; coming back to the app catches up at once.
void startNative({
  back: () => {
    if (route.value[0] === "week" && !route.value[1]) return false;
    history.back();
    return true;
  },
  resume: () => void refresh(),
});

render(<App />, document.getElementById("app"));
