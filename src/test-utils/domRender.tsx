import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

type Matcher = string | RegExp;

// Silence React's act warning for the lightweight DOM harness in Vitest.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function matchText(text: string, matcher: Matcher) {
  if (typeof matcher === 'string') {
    return text.includes(matcher);
  }
  return matcher.test(text);
}

function findByText(container: HTMLElement, matcher: Matcher): HTMLElement | null {
  const elements = Array.from(container.querySelectorAll<HTMLElement>('*'));
  return (
    elements.find((element) => {
      const text = element.textContent?.trim() || '';
      return text.length > 0 && matchText(text, matcher);
    }) || null
  );
}

export function renderToDom(ui: React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(<>{ui}</>);
  });

  return {
    container,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
    getByText(matcher: Matcher) {
      const element = findByText(container, matcher);
      if (!element) {
        throw new Error(`Unable to find text: ${String(matcher)}`);
      }
      return element;
    },
    queryByText(matcher: Matcher) {
      return findByText(container, matcher);
    },
    getByTestId(testId: string) {
      const element = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      if (!element) {
        throw new Error(`Unable to find test id: ${testId}`);
      }
      return element;
    },
    queryByTestId(testId: string) {
      return container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    },
    click(element: Element | null) {
      if (!element) {
        throw new Error('Unable to click a null element');
      }
      const target =
        element instanceof HTMLElement
          ? element.closest('button,[role="button"]') || element
          : element;
      act(() => {
        (target as HTMLElement).click();
      });
    },
    change(element: Element | null, value: string) {
      if (!element || !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        throw new Error('Unable to change a non-input element');
      }
      act(() => {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
  };
}
