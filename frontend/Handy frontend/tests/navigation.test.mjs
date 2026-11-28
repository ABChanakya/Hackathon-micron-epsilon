import test from 'node:test';
import assert from 'node:assert/strict';
import {cockpitUrl} from '../navigation.mjs';
import mobileCopy from '../../dist/locales/mobile-copy.js';

test('unified phone links keep the host and language while selecting the intended cockpit route', () => {
  assert.equal(cockpitUrl('https://sensor.example/handy/?lang=de', 8123, 'ja'), 'https://sensor.example/?lang=ja#monitor');
  assert.equal(cockpitUrl('https://sensor.example:8443/handy/', 8000, 'fr', 'advanced'), 'https://sensor.example:8443/?lang=fr#advanced');
});

test('standalone phone links use the relay backend port and preserve IPv6 hosts', () => {
  assert.equal(cockpitUrl('http://192.168.1.2:4174/', 8765, 'en'), 'http://192.168.1.2:8765/?lang=en#monitor');
  assert.equal(cockpitUrl('http://[::1]:4174/', 9012, 'cs'), 'http://[::1]:9012/?lang=cs#monitor');
  assert.equal(cockpitUrl('http://localhost:4174/', -1, 'de'), 'http://localhost:8000/?lang=de#monitor');
});

test('all phone messages have all nine translated forms and preserve supplied placeholders', () => {
  const keys = Object.keys(mobileCopy.en).sort();
  assert.ok(keys.length >= 75);
  for (const [language, copy] of Object.entries(mobileCopy)) {
    assert.deepEqual(Object.keys(copy).sort(), keys, language);
    for (const key of keys) {
      assert.ok(copy[key].trim(), `${language}: ${key}`);
      assert.deepEqual([...copy[key].matchAll(/\{\w+\}/g)].map(m=>m[0]).sort(), [...key.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort(), `${language}: ${key}`);
    }
  }
});
