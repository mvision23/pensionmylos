// Language-independent site data. All visible text lives in src/i18n/messages/<lang>.json.

export const site = {
  name: 'Pension Mylos',
  phone: '+30 2841 14 15 17',
  phoneHref: 'tel:+302841141517',
  email: 'info@pensionmylos.com',
  mapsUrl: 'https://maps.google.com/?q=Pension+Mylos+Agios+Nikolaos',
  mapEmbed:
    'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3260.632299986605!2d25.716328428516587!3d35.19071609866514!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x6f2a4d10abee6e2b!2sPension+Mylos!5e0!3m2!1sen!2sgr!4v1395611348027',
  social: {
    facebook: 'https://fb.com/pensionmylos',
    instagram: 'https://instagram.com/pensionmylos',
  },
  kayak: 'https://www.kayak.co.uk/Agios-Nikolaos-Hotels-Pension-Mylos.518337.ksp',
  formspree: 'https://formspree.io/f/mdowyaeq',
  /**
   * Cloudflare Turnstile site key (public). Leave empty until Turnstile is set up:
   * create a widget for pensionmylos.com in Cloudflare, paste its SECRET key in the
   * Formspree form settings (Spam protection → CAPTCHA → Cloudflare Turnstile),
   * and put the SITE key here. The contact form then shows the (mostly invisible)
   * check on our own page, so JavaScript submissions pass Formspree's CAPTCHA.
   */
  turnstileSiteKey: '',
  mailchimp: {
    action: 'https://pensionmylos.us10.list-manage.com/subscribe/post?u=f48d4d634ff736e7fd7478dcd&id=d9029da3c9',
    honeypot: 'PensionMylos_form',
  },
};

/** Beds24 property id — taken from the "Book Now" button on the current site. */
export const BEDS24_PROPID = '116338';
export const beds24 = {
  propid: BEDS24_PROPID,
  /** Public availability endpoint (Beds24 JSON API v1, no key needed, CORS-enabled). */
  availabilityApi: 'https://api.beds24.com/json/getAvailabilities',
  /** Booking page; with `br1-<roomId>=Book` it opens straight on the guest-details step. */
  bookingPage: 'https://beds24.com/booking2.php',
  /** URL used inside the embedded iframe (the page's language is appended as `lang`). */
  iframeSrc: `https://beds24.com/booking2.php?propid=${BEDS24_PROPID}&referer=iframe`,
  /** Same booking page, opened full-window (fallback link). */
  directUrl: `https://beds24.com/booking2.php?propid=${BEDS24_PROPID}&referer=pensionmylos.com`,
  /**
   * Taxes Beds24 adds on top of the API price, as configured in the Beds24
   * account (VAT 13 %, municipal tax 0.75 %, climate fee €2 per room per night).
   * Total = round(Σ price × (1 + vat + municipal)) + climate × nights × rooms —
   * the "Grand Total" Beds24's booking page shows (its server-side HTML can be
   * 1 cent higher for several rooms; its own script then corrects it). Checked
   * Nov 2026 for 1–3 rooms. Update if the taxes change in Beds24.
   */
  taxes: { vat: 0.13, municipal: 0.0075, climatePerRoomNight: 2 },
};

/** Main navigation: path (without language prefix) + key in messages.nav. */
export const nav = [
  { key: 'pension', path: '/#about' },
  { key: 'location', path: '/#location' },
  { key: 'blog', path: '/blog/' },
  { key: 'contact', path: '/#contact' },
] as const;

/** "Sights of interest", in the same order as messages.location.sights. */
export const sightModes: ('walk' | 'drive')[] = [
  'walk', 'walk', 'walk', 'walk', 'walk', 'walk', 'walk',
  'drive', 'drive', 'drive', 'drive', 'drive',
];

// The scroll film. Each scene is one cut of videos/all.mp4 at the marks
// 0:00, 4:23, 9:18, 13:15, 18:20, 25:25 (seconds:frames @ 30 fps).
// Scene texts are in messages.film.scenes (same order).
export const film = [
  { id: 'town', from: '0:00', to: '4:23', scroll: 1.7, linger: 0.2 },
  { id: 'pension', from: '4:23', to: '9:18', scroll: 1.5, linger: 0.3 },
  { id: 'rooms', from: '9:18', to: '13:15', scroll: 1.4, linger: 0.35 },
  { id: 'view', from: '13:15', to: '18:20', scroll: 1.7, linger: 0.4 },
  { id: 'location', from: '18:20', to: '25:25', scroll: 2.0, linger: 0.3 },
  { id: 'book', from: '25:25', to: 'end', scroll: 1.0, linger: 0 },
] as const;

/**
 * Rooms as set up in Beds24 (ids from the booking page). `msg` = index in
 * messages.rooms for the translated name; rooms without it show `name`
 * (their Beds24 name). Photos are from src/assets/gallery.
 * `group`: rooms can only be booked together within the same group — Beds24
 * rejects mixing the regular rooms with the two Airbnb-imported listings
 * ("Not all of this selection is available"), tested Nov 2026.
 */
export const bookableRooms = [
  { id: '261964', msg: 0, name: 'Twin Room Panoramic Sea View', photo: 'slider-4', group: 'rooms' },
  { id: '265730', msg: 1, name: 'Triple Room Panoramic Sea View', photo: 'slider-2', group: 'rooms' },
  { id: '314270', msg: 2, name: 'Single Room Panoramic View', photo: 'slider-12', group: 'rooms' },
  { id: '352782', msg: null, name: 'Your First Seat to Mirabello Bay', photo: 'slider-5', group: 'listings' },
  { id: '352783', msg: null, name: 'Panorama Mirabello Bay', photo: 'slider-7', group: 'listings' },
] as const;
