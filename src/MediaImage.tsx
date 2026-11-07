import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import { mediaUrl } from './api';
import { loadMediaBlobUrl, nativeMediaNeedsDownload } from './media';

type MediaImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'onError'> & {
  src?: string | null;
  fallback?: ReactNode;
  onFailure?: () => void;
};

export function MediaImage({ src, alt = '', fallback, onFailure, ...attributes }: MediaImageProps) {
  const url = mediaUrl(src);
  const download = nativeMediaNeedsDownload(url);
  const [photo, setPhoto] = useState<{ url: string; source?: string; failed?: boolean } | null>(null);
  const placeholder = useRef<HTMLSpanElement>(null);
  const onFailureRef = useRef(onFailure);
  onFailureRef.current = onFailure;

  useEffect(() => {
    if (!download || !url) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const load = () => {
      loadMediaBlobUrl(url, controller.signal).then(source => {
        objectUrl = source;
        if (controller.signal.aborted) {
          URL.revokeObjectURL(source);
          return;
        }
        setPhoto({ url, source });
      }).catch(() => {
        if (controller.signal.aborted) return;
        setPhoto({ url, failed: true });
        onFailureRef.current?.();
      });
    };
    let observer: IntersectionObserver | undefined;
    if (attributes.loading === 'lazy' && placeholder.current && typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer?.disconnect();
          load();
        }
      }, { rootMargin: '300px' });
      observer.observe(placeholder.current);
    } else load();
    return () => {
      controller.abort();
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, download, attributes.loading]);

  const current = photo?.url === url ? photo : null;
  const source = download ? current?.source : url;
  if (!source || current?.failed) {
    return <span ref={placeholder} className={attributes.className} style={{ display: 'inline-flex', minWidth: 1, minHeight: 1, ...attributes.style }} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true} aria-busy={!!url && download && !current}>
      {fallback ?? (current?.failed ? <ImageOff size={20} /> : null)}
    </span>;
  }
  return <img {...attributes} src={source} alt={alt} onError={() => {
    setPhoto({ url, failed: true });
    onFailureRef.current?.();
  }} />;
}
