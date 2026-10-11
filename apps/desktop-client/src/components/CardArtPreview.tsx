import { useEffect, useId, useRef, useState } from "react";
import { ImageOff, X } from "lucide-react";
import "./CardArtPreview.css";

interface CardArtPreviewProps {
  readonly imageUrl: string | null;
  readonly title: string;
  readonly printingLabel: string;
}

export function CardArtPreview({
  imageUrl,
  title,
  printingLabel
}: CardArtPreviewProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = "";
      triggerRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="deck-art-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`预览 ${title} ${printingLabel}`}
        onClick={() => setOpen(true)}
      >
        <CardArtThumbnail className="deck-variant-thumbnail" imageUrl={imageUrl} />
      </button>

      {open ? (
        <div
          className="card-art-backdrop"
          role="presentation"
          onKeyDown={event => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Tab") {
              event.preventDefault();
              closeButtonRef.current?.focus();
            }
          }}
          onMouseDown={event => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="card-art-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <header className="card-art-header">
              <h2 id={titleId}>{title}</h2>
              <button
                ref={closeButtonRef}
                type="button"
                className="card-art-close"
                aria-label="关闭预览"
                onClick={() => setOpen(false)}
              >
                <X size={18} aria-hidden />
              </button>
            </header>

            <div className="card-art-frame">
              <CardArtImage imageUrl={imageUrl} title={title} printingLabel={printingLabel} />
            </div>

            <p className="card-art-printing">{printingLabel}</p>
          </section>
        </div>
      ) : null}
    </>
  );
}

function CardArtImage({
  imageUrl,
  title,
  printingLabel
}: {
  readonly imageUrl: string | null;
  readonly title: string;
  readonly printingLabel: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  if (imageUrl === null || failed) {
    return (
      <span className="card-art-placeholder" role="img" aria-label="No card image">
        <ImageOff size={32} aria-hidden />
      </span>
    );
  }

  return (
    <img
      className="card-art-image"
      src={imageUrl}
      alt={`${title} ${printingLabel}`}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function CardArtThumbnail({
  className,
  imageUrl
}: {
  readonly className: string;
  readonly imageUrl: string | null;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  if (imageUrl !== null && !failed) {
    return (
      <img
        className={`deck-thumbnail ${className}`}
        src={imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={`deck-thumbnail deck-thumbnail-placeholder ${className}`}
      role="img"
      aria-label="No card image"
    >
      <ImageOff size={16} aria-hidden />
    </span>
  );
}
