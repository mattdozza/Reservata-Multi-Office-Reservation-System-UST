import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { loadResourcePhoto } from "../services/resourcePhotos.js";

export default function ResourcePhoto({ resource, preview, className = "" }) {
  const [photo, setPhoto] = useState(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const photoKey = resource?.photoKey || "";
  useEffect(() => {
    let active = true;
    setPhoto(null);
    setFailed(false);
    // A freshly picked photo is already a data URL, so it renders immediately without a fetch.
    if (!photoKey || preview) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    loadResourcePhoto(photoKey)
      .then((result) => { if (active) { setPhoto(result.url); setLoading(false); } })
      .catch(() => { if (active) { setFailed(true); setLoading(false); } });
    return () => { active = false; };
  }, [photoKey, preview]);
  const source = preview || photo;
  let message = "No photo available";
  if (source && !failed) message = "";
  else if (loading) message = "Loading photo...";
  else if (failed && photoKey) message = "Photo could not be loaded";
  return (
    <div className={`resource-photo ${className}`}>
      {source && !failed ? <img src={source} alt={resource?.name || "Resource photo preview"} onError={() => setFailed(true)} /> : (
        <span><ImageOff size={24} aria-hidden="true" />{message}</span>
      )}
    </div>
  );
}
