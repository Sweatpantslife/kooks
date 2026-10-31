import { CloudUpload } from "lucide";
import { Icon } from "./icon.jsx";

// Beside anything made on this device that the kitchen has not heard of
// yet. The list of what waits is a tap away in the bar at the top.
export function Waiting({ id }) {
  return (
    <span id={id} class="badge badge-saffron">
      <Icon icon={CloudUpload} />
      Waiting to send
    </span>
  );
}
