import { useEffect, useState } from "preact/hooks";
import { file } from "../lib/api.js";
import { native, phone } from "../lib/device.js";
import { shareFile } from "../lib/native.js";
import { keepPhoto, keptPhoto } from "../lib/photos.js";
import { account, offline } from "../lib/store.js";
import { toast } from "../lib/toast.js";

export const assetPath = (id) => `/api/assets/${encodeURIComponent(id)}`;

// A phone fetches each photo once with its token and shows it from memory;
// an image tag on its own could not say who is asking. It keeps each photo
// it has opened, so the photo shows without the kitchen too, and a kept one
// is not fetched again: a photo in the kitchen never changes.
const fetched = new Map();
async function photo(id) {
  const household = account.value?.household?.id ?? null;
  const kept = await keptPhoto(household, id);
  if (kept) return kept;
  const blob = await file(assetPath(id));
  void keepPhoto(household, id, blob);
  return blob;
}
function useAsset(id) {
  const [url, setUrl] = useState(() => (phone ? null : assetPath(id)));
  // A photo the kitchen could not send is asked for again once it answers.
  const away = phone && offline.value !== null;
  useEffect(() => {
    if (!phone) return setUrl(assetPath(id));
    let live = true;
    if (!fetched.has(id))
      fetched.set(
        id,
        photo(id).then(
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
  }, [id, away]);
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
