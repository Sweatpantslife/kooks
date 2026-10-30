import { render } from "preact";
import { effect } from "@preact/signals";
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import { route, startRouter, navigate } from "./lib/router.js";
import { refresh, startPolling, confirmLink } from "./lib/store.js";
import { startTheme } from "./lib/theme.js";
import { startNative } from "./lib/native.js";
import { App } from "./app.jsx";

startTheme();
startRouter();

// An emailed sign-in link opens #/signin/<token>; anything else loads the
// kitchen as whoever this browser is signed in as.
const linked = () => (route.value[0] === "signin" ? route.value[1] : null);
if (!linked()) void refresh();
effect(() => {
  const token = linked();
  if (token) void confirmLink(token, () => navigate("week", { replace: true }));
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
