import type { SlotSymbolKind } from './slot-machine-reels.js';

export function SlotSymbolIcon({ kind }: { kind: SlotSymbolKind }) {
  return (
    <svg className="slot-symbol-icon" data-symbol={kind} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {kind === 'money' && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M7.5 6.5 12 13l4.5-6.5M12 12.5V18M8.5 14h7M8.5 16.5h7" />
        </>
      )}
      {kind === 'bomb' && (
        <>
          <circle cx="10.5" cy="13.5" r="6.5" />
          <path d="m14.8 8.6 2.1-2.1M16.2 4.7l1.1-1.1M19.2 6.4h2M17.4 3.6V1.8M17 6.5c-1.7.7-2.4 2.2-2.2 3.6" />
        </>
      )}
      {kind === 'attack' && (
        <>
          <path d="m5 4 4 1 10 11-3 3L6 8 5 4ZM19 4l-4 1-3 3M14 4l1 4 4 4M5 4l4 4M14 17l3 3M16 15l3 3" />
          <path d="m4 20 3-3M17 4l3-3" />
        </>
      )}
      {kind === 'key' && (
        <>
          <circle cx="8" cy="9" r="4.5" />
          <path d="m11.2 12.2 8.3 8.3M16 17l2-2M18 19l2-2M8 6.5v5M5.5 9h5" />
        </>
      )}
    </svg>
  );
}
