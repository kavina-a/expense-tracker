require('./env')('time');

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const time = require('../time');

afterEach(() => time.resetClock());

describe('Colombo time', () => {
  it('rolls the date over at 18:30 UTC, not at midnight UTC', () => {
    time.setClock(() => new Date('2026-10-26T18:29:59Z'));
    assert.equal(time.todayColombo(), '2026-10-26');
    time.setClock(() => new Date('2026-10-26T18:30:00Z'));
    assert.equal(time.todayColombo(), '2026-10-27');
  });

  it('gives the Colombo day while the server (UTC) is still on the previous day', () => {
    // 20:00 UTC on the 25th is 01:30 on the 26th in Colombo.
    time.setClock(() => new Date('2026-10-25T20:00:00Z'));
    assert.equal(time.todayColombo(), '2026-10-26');
    assert.equal(time.monthColombo(), '2026-10');
  });

  it('crosses month and year boundaries in Colombo time', () => {
    time.setClock(() => new Date('2026-12-31T19:00:00Z'));
    assert.equal(time.todayColombo(), '2027-01-01');
    assert.equal(time.yearColombo(), '2027');
    assert.equal(time.monthColombo(), '2027-01');
  });

  it('counts days back from the Colombo date', () => {
    time.setClock(() => new Date('2026-10-25T20:00:00Z'));
    assert.equal(time.daysAgoColombo(6), '2026-10-20');
  });

  it('accepts a fixed instant for the clock', () => {
    time.setClock('2026-03-01T00:00:00Z');
    assert.equal(time.todayColombo(), '2026-03-01');
  });
});
