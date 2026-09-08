import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { registerFormGuard } from "../shared/formSafety.js";

export default function ManagedForm({ onSubmit, children, resetKey, changed = false, onChange, ...props }) {
  const dirty = useRef(false);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState({});
  const formRef = useRef(null);

  useEffect(() => {
    const remove = registerFormGuard(() => dirty.current);
    const beforeUnload = (event) => {
      if (!dirty.current && !submitting.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const actionError = (event) => { if (submitting.current) setError(event.detail); };
    const actionSuccess = () => { if (submitting.current) dirty.current = false; };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("reservata:action-error", actionError);
    window.addEventListener("reservata:action-success", actionSuccess);
    return () => {
      remove();
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("reservata:action-error", actionError);
      window.removeEventListener("reservata:action-success", actionSuccess);
    };
  }, []);

  useEffect(() => { dirty.current = false; setError(""); setInvalid({}); }, [resetKey]);
  useEffect(() => { if (changed) dirty.current = true; }, [changed]);

  function validateField(target) {
    if (!target.id || !target.validity) return;
    target.setAttribute("aria-invalid", String(!target.validity.valid));
    if (!target.validity.valid) target.setAttribute("aria-describedby", `field-error-${target.id}`);
    else if (target.getAttribute("aria-describedby") === `field-error-${target.id}`) target.removeAttribute("aria-describedby");
    setInvalid((current) => ({ ...current, [target.id]: target.validity.valid ? "" : target.validationMessage }));
  }

  return (
    <form {...props} ref={formRef} aria-busy={busy} onChange={(event) => {
      dirty.current = true;
      validateField(event.target);
      onChange?.(event);
    }} onInvalidCapture={(event) => validateField(event.target)} onSubmit={async (event) => {
      event.preventDefault();
      if (submitting.current) return;
      submitting.current = true;
      setError("");
      try {
        const result = onSubmit(event);
        setBusy(true);
        await result;
      } catch (failure) {
        setError(failure.message || "Could not save. Please try again.");
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    }}>
      <fieldset className="managed-form-fields" disabled={busy}>{children}</fieldset>
      {Object.entries(invalid).filter(([, message]) => message).map(([id, message]) => {
        const field = Array.from(formRef.current?.elements || []).find((element) => element.id === id)?.closest(".field");
        const feedback = <small id={`field-error-${id}`} className="field-error" role="alert">{message}</small>;
        return field ? createPortal(feedback, field, id) : <p key={id}>{feedback}</p>;
      })}
      {error && <p className="field-error" role="alert">{error}</p>}
      {busy && <p className="form-progress" role="status">Saving, please wait...</p>}
    </form>
  );
}
