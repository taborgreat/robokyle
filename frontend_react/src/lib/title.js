import { useEffect } from 'react';

/* Per-page document titles: screen readers announce them on SPA navigation,
   the browser tab and history entries get real names, and search sees more
   than "Works" everywhere. Pass nothing while a page is still loading. */
export function useTitle(title) {
  useEffect(() => {
    if (title) document.title = `${title} | Robo Kyle`;
  }, [title]);
}
