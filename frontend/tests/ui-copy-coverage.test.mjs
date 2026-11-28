import test from 'node:test';
import assert from 'node:assert/strict';
import copy from '../dist/locales/coverage-copy.js';
import {LANGUAGES, setLanguage, translateText} from '../dist/i18n.js';

const cases = [
  ['Messbereich 20–30 mm · Profilrate 4 kHz', ['20–30 mm', '4 kHz']],
  ['optoNCDT 1900-10 über eine lokale Messbrücke.', ['optoNCDT 1900-10']],
  ['ME-Bus · USB (3,3-V-TTL) · Messbrücke', ['ME-Bus · USB (3,3-V-TTL)']],
  ['Richte den Sensor auf das Messobjekt aus. Der Messbereich liegt bei -50–900 °C Objekttemperatur.', ['-50–900 °C']],
  ['KI lernt Normalzustand · 40 %', ['40']],
  ['KI · Rauschen erhöht · verworfen', []],
  ['KI-Auffälligkeit · Grenzwert überschritten', []],
  ['· 7,5-fache Abweichung vom gelernten Normalzustand (Meldung ab 6). Bewerte dieses Signalmuster.', ['7,5', '6']],
  ['· Gleicht einer als „nicht in Ordnung“ gelernten Messung. Auffälligstes Merkmal: Ungewöhnlicher Verlauf.', []],
  ['State-LED: Grün. Das Objekt liegt im Messbereich des Sensors.', []],
  ['Output-LED: Gelb. Die Schaltausgänge sind aktiv. RS422, Analogausgang oder Webinterface können zugeschaltet werden.', ['RS422']],
  ['state-LED grün', ['state']],
  ['Der Sensor liefert keinen gültigen Temperaturwert. NO_PEAK 4', ['NO_PEAK 4']],
  ['Gelernte Grenzen: 24,900–25,100 → 24,800–25,200 mm. Die Sollgrenzen bleiben erhalten.', ['24,900–25,100', '24,800–25,200', 'mm']],
  ['Einstellungen · Micro-Epsilon', ['Micro-Epsilon']],
  ['Als Normalmuster lernen', []],
  ['Diese Bewertung verändert nur die Auswertungsgrenzen. Die Sollgrenzen bleiben erhalten.', []],
];

test('whole-message coverage has a native entry in every target language without relying on English fallback', () => {
  const keys = Object.keys(copy.en).sort();
  assert.ok(keys.length >= 70);
  for (const language of LANGUAGES.filter(item => item.code !== 'de')) {
    assert.deepEqual(Object.keys(copy[language.code]).sort(), keys, language.code);
    for (const key of keys) {
      assert.ok(copy[language.code][key].trim(), `${language.code}: ${key}`);
      const parameters = value => [...value.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
      assert.deepEqual(parameters(copy[language.code][key]), parameters(key), `${language.code}: ${key}`);
    }
  }
});

test('actual translations cover complete setup, ML and LED messages while preserving names, values and units', async () => {
  for (const {code} of LANGUAGES.filter(item => item.code !== 'de')) {
    await setLanguage(code);
    for (const [source, retained] of cases) {
      const value = translateText(source, code);
      assert.notEqual(value, source, `${code}: ${source}`);
      for (const token of retained) assert.ok(value.includes(token), `${code}: retained ${token}`);
      for (const german of ['Profilrate', 'über eine lokale Messbrücke', 'Richte den Sensor', 'Objekttemperatur', 'Normalzustand', 'Rauschen erhöht', 'verworfen', 'Auffälligkeit', 'Grenzwert überschritten', 'Bewerte dieses', 'Gleicht einer', 'Auswertungsgrenzen', 'Sollgrenzen', 'Grün', 'Gelb', 'grün', 'Schaltausgänge', 'Temperaturwert', 'Gelernte Grenzen', 'Einstellungen'])
        assert.ok(!value.includes(german), `${code}: untranslated ${german} in ${value}`);
    }
    const model = 'Messwert verschoben';
    assert.ok(translateText(`${model} über eine lokale Messbrücke.`, code).includes(model), `${code}: technical model name stays literal`);
  }
  await setLanguage('de');
});
