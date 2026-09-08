import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { loadResourcePhoto } from "../services/resourcePhotos.js";

export default function ResourcePhoto({ resource, preview, className = "" }) {
  const [photo, setPhoto] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setPhoto(null);
    setFailed(false);
    if (resource?.photoKey && !preview) loadResourcePhoto(resource.photoKey)
      .then((result) => { if (active) setPhoto(result.url); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [resource?.photoKey, preview]);
  const source = preview || photo;
  return (
    <div className={`resource-photo ${className}`}>
      {source && !failed ? <img src={source} alt={resource?.name || "Resource photo preview"} onError={() => setFailed(true)} /> : (
        <span><ImageOff size={24} aria-hidden="true" />{resource?.photoKey && !failed ? "Loading photo..." : "No photo available"}</span>
      )}
    </div>
  );
}
