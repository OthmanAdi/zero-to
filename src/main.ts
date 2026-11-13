import { boot } from './app/director';

boot().catch((error: unknown) => {
  // Whatever went wrong, the roadmap's text is still in the page: show it instead of an empty room.
  console.error('zero-to could not start', error);
  document.documentElement.classList.remove('map-view');
  document.documentElement.dataset.zt = 'failed';
});
