let reactGrabImport: Promise<unknown> | null = null;

export function initReactGrab() {
  if (!__DEV__) {
    return;
  }

  // Keep native bundles from resolving the browser-only package by using a web-only module.
  if (!reactGrabImport) {
    reactGrabImport = import('react-grab').catch((error) => {
      reactGrabImport = null;
      console.error('Failed to load react-grab:', error);
    });
  }
}
