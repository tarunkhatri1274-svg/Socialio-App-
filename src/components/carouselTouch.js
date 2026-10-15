// components/carouselTouch.js
let active = false;

export const isCarouselTouchActive = () => active;

// Spread these onto any horizontal ScrollView so the tab-swipe ignores it
export const carouselTouchProps = {
  onTouchStart: () => { active = true; },
  onTouchEnd: () => { active = false; },
  onTouchCancel: () => { active = false; },
};