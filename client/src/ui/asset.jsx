import { useEffect, useState } from "preact/hooks";
import { file } from "../lib/api.js";
import { native, phone } from "../lib/device.js";
import { shareFile } from "../lib/native.js";
import { toast } from "../lib/toast.js";

export const assetPath = (id) => `/api/assets/${encodeURIComponent(id)}`;

// A phone fetches each photo once with its token and shows it from memory;
// an image tag on its own could not say who is asking.
const fetched = new Map();
function useAsset(id) {
  const [url, setUrl] = useState(() => (phone ? null : assetPath(id)));
  useEffect(() => {
    if (!phone) return setUrl(assetPath(id));
    let live = true;
    if (!fetched.has(id))
      fetched.set(
        id,
        file(assetPath(id)).then(
          (blob) => URL.createObjectURL(blob),
          (error) => {
            fetched.delete(id);
            throw error;
          },
        ),
      );
    fetched.get(id).then(
      (value) => live && setUrl(value),
      () => live && setUrl(null),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}

// A photo kept in the kitchen. Until a phone has it, the space stays empty.
export function AssetImage({ id, ...props }) {
  const src = useAsset(id);
  return src ? <img src={src} {...props} /> : <span class="asset-wait" />;
}

// The phone's sign-in tried in a browser saves files the browser's way.
function saveBlob(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

// A file kept in the kitchen, such as a book: a link in a browser, which
// opens it or downloads it; on a phone, a button that hands it to another
// app, such as Books or Files.
export function FileLink({ path, name, download, children, ...props }) {
  const [busy, setBusy] = useState(false);
  if (!phone)
    return (
      <a
        href={path}
        {...(download
          ? { download: name }
          : { target: "_blank", rel: "noopener noreferrer" })}
        {...props}
      >
        {children}
      </a>
    );
  const open = async () => {
    setBusy(true);
    try {
      const blob = await file(path);
      if (native) await shareFile(blob, name);
      else saveBlob(blob, name);
    } catch (error) {
      if (!/cancel/i.test(error.message)) toast(error.message, { error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" disabled={busy} onClick={open} {...props}>
      {children}
    </button>
  );
}
