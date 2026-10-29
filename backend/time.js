// All calendar logic runs in Asia/Colombo, whatever timezone the server is in.
// Railway runs in UTC, so new Date().toLocaleDateString() gives the wrong day
// between 00:00 and 05:30 Colombo time.
//
// now() is injectable so settlement windows and expiries can be tested.

const TIME_ZONE = 'Asia/Colombo';

let clock = () => new Date();

function now() {
  return clock();
}

function setClock(fn) {
  clock = typeof fn === 'function' ? fn : () => new Date(fn);
}

function resetClock() {
  clock = () => new Date();
}

const dateFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// YYYY-MM-DD in Colombo.
function colomboDate(at = now()) {
  return dateFormat.format(at instanceof Date ? at : new Date(at));
}

function todayColombo() {
  return colomboDate(now());
}

function monthColombo() {
  return todayColombo().slice(0, 7);
}

function yearColombo() {
  return todayColombo().slice(0, 4);
}

// Colombo calendar date N days before today (N may be negative).
function daysAgoColombo(days) {
  return colomboDate(new Date(now().getTime() - days * 24 * 60 * 60 * 1000));
}

const dateTimeFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

// YYYY-MM-DDTHH:MM:SS in Colombo, with no offset (the form bank SMS times use).
function colomboDateTime(at = now()) {
  return dateTimeFormat.format(at instanceof Date ? at : new Date(at)).replace(' ', 'T');
}

// The instant a Colombo wall-clock string (YYYY-MM-DDTHH:MM[:SS]) refers to.
function fromColombo(naive) {
  const text = String(naive);
  const full = text.length === 16 ? `${text}:00` : text.slice(0, 19);
  return new Date(`${full}+05:30`);
}

function isoNow() {
  return now().toISOString();
}

module.exports = {
  TIME_ZONE,
  now,
  setClock,
  resetClock,
  colomboDate,
  colomboDateTime,
  fromColombo,
  todayColombo,
  monthColombo,
  yearColombo,
  daysAgoColombo,
  isoNow,
};
