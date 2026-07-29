import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const THEME_KEY = 'docket.theme';

/** Dark by default: the scene is a document worker at a desk for a whole day,
 *  usually under mixed or low light, with the screen the brightest thing there. */
export const useTheme = () => {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
    []
  );

  return { theme, toggleTheme };
};

export const useWindowState = () => {
  const [maximized, setMaximized] = useState(false);

  useEffect(
    () => window.docket.window.onStateChanged((state) => setMaximized(state.maximized)),
    []
  );

  return {
    maximized,
    minimize: () => void window.docket.window.minimize(),
    toggleMaximize: () => void window.docket.window.toggleMaximize(),
    close: () => void window.docket.window.close()
  };
};

export interface Shortcut {
  readonly combo: string;
  readonly run: () => void;
  /** Fire even while a text field has focus (Ctrl+S must always work). */
  readonly whileTyping?: boolean;
}

const comboOf = (event: KeyboardEvent): string => {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('mod');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  parts.push(key);
  return parts.join('+');
};

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('.cm-editor') !== null
  );
};

export const useShortcuts = (shortcuts: readonly Shortcut[]): void => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const combo = comboOf(event);
      const match = shortcuts.find((shortcut) => shortcut.combo === combo);
      if (!match) return;
      if (isTypingTarget(event.target) && !match.whileTyping) return;
      event.preventDefault();
      match.run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts]);
};
