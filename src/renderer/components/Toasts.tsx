import type { Notice } from '@/state/useSession';
import { IconClose } from './icons';

interface ToastsProps {
  readonly notices: readonly Notice[];
  onDismiss(id: number): void;
}

export const Toasts = ({ notices, onDismiss }: ToastsProps) => (
  <div className="toasts" role="status" aria-live="polite">
    {notices.map((notice) => (
      <div
        key={notice.id}
        className={`toast ${notice.tone === 'error' ? 'toast--error' : ''}`}
      >
        <span
          className={`lamp ${notice.tone === 'error' ? 'lamp--red' : 'lamp--green'}`}
          style={{ marginTop: 5 }}
          aria-hidden="true"
        />
        <div className="toast__body">
          <p className="toast__title">{notice.title}</p>
          {notice.detail && <p className="toast__detail">{notice.detail}</p>}
        </div>
        <button
          type="button"
          className="toast__dismiss"
          onClick={() => onDismiss(notice.id)}
          aria-label="Dismiss"
        >
          <IconClose size={12} />
        </button>
      </div>
    ))}
  </div>
);
