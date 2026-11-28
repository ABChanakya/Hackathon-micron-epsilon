// Hover and focus information, "i" buttons for technical terms, and screen-reader announcements.
// Hint texts are German source strings (translated at show time by i18n.js); they are attached after every render
// by selector, so the page templates in app.js stay readable. Hints work with the mouse (hover), the keyboard (focus,
// Esc closes) and touch (tap an "i" button), and the tooltip can be hovered without disappearing (WCAG 1.4.13).
import {translateText} from './i18n.js?v=phone-live-1';

const recording = el => /Stoppen/.test(el.textContent);
const isMl = el => el?.dataset?.feedbackKind === 'ml' || /In Ordnung/.test(el.textContent);
const accepted = el => el.dataset.accepted === 'true';

// [selector, hint(el) | text, options]. options.info: also add an "i" button after the element (selectors are structural, because the text is translated).
export const HINTS = [
  ['[data-action="record"]', el => recording(el) ? 'Beendet die Aufnahme und speichert sie in diesem Browser.' : 'Zeichnet die Messwerte auf, bis du stoppst. Fertige Aufnahmen findest du unter Aufzeichnungen.'],
  ['[data-action="pause"]', 'Hält nur die Anzeige an. Der Sensor misst weiter.'],
  ['[data-action="zero"]', 'Zieht den aktuellen Wert von der Anzeige ab, so siehst du Änderungen ab jetzt.'],
  ['[data-action="window"]', el => `Zeigt im Diagramm die letzten ${el.dataset.value} Sekunden.`],
  ['#reading-state', 'Zeigt, ob der Wert innerhalb der Sollgrenzen des Messprofils liegt.'],
  ['.tolerance-track', 'Der grüne Bereich ist der Sollbereich. Der Zeiger zeigt den aktuellen Wert.'],
  ['.led-status[data-led="state"]', 'State-LED: Grün = Objekt im Messbereich, Gelb = Mitte des Messbereichs, Rot = kein gültiger Abstand.'],
  ['.led-status[data-led="output"]', 'Output-LED: Zeigt, welcher Ausgang des Sensors aktiv ist. Grün = RS422, die Datenleitung zu diesem Monitor.'],
  ['[data-action="toggle-learning"]', 'Legt fest, ob akzeptierte Abweichungen die Auswertungsgrenzen erweitern.'],
  ['[data-action="undo-learning"]', 'Macht die letzte Anpassung der Auswertungsgrenzen rückgängig.'],
  ['[data-action="reset-learning"]', 'Setzt die Auswertungsgrenzen auf die Sollgrenzen zurück.'],
  ['#profile-select', 'Ein Messprofil bündelt Sollwert, Sollgrenzen und Profilrate für eine Aufgabe.'],
  ['[data-action="edit-profile"]', 'Ändert Sollwert und Sollgrenzen. Die Auswertungsgrenzen beginnen danach neu.'],
  ['[data-action="feedback"]', el => isMl(el.parentElement)
    ? (accepted(el) ? 'Das Signal ist normal. Die KI lernt es und meldet es nicht mehr.' : 'Das ist eine Anomalie. Die KI merkt sich das Muster und erkennt es künftig sofort.')
    : (accepted(el) ? 'Der Wert war in Ordnung. Die Auswertungsgrenzen werden erweitert.' : 'Der Wert war ein Fehler. Die Auswertungsgrenzen bleiben unverändert.')],
  ['form[data-form="marker"] button[type="submit"]', 'Markiert diesen Zeitpunkt im Diagramm und in der Aufnahme.'],
  ['[data-action="sensor"].text-button', 'Öffnet die große 3D-Ansicht mit dem Sensorstatus.'],
  ['[data-action="connect-sensor"]', 'Verbindet den gewählten Sensor. Schließe vorher sensorTOOL und andere Programme.'],
  ['[data-action="scan-sensors"]', 'Sucht erneut nach angeschlossenen Sensoren.'],
  ['[data-action="ml-reset"]', 'Lernt den Normalzustand neu. Gelernte Beispiele und Ereignisverlauf bleiben erhalten.'],
  ['[data-action="ml-forget"]', 'Setzt Normalzustand und gelernte Beispiele zurück. Ereignisverlauf und Fehlerdatei bleiben erhalten.'],
  ['[data-action="ml-learn"]', el => el.dataset.label === 'anomaly' ? 'Lernt die gewählte Aufnahme als Anomalie.' : 'Lernt die gewählte Aufnahme als Normalzustand.'],
  ['.learning-card .panel-heading h2, .advanced-panel:has([data-action="toggle-learning"]) .panel-heading h2', 'Sollgrenzen sind deine Vorgabe. Auswertungsgrenzen können wachsen, wenn du Abweichungen als akzeptabel bewertest.', {info: true, label: 'Hilfe zu Auswertungsgrenzen'}],
  ['.ml-panel .panel-heading h2', 'Lernt, wie dein Signal normal aussieht, und meldet Abweichungen. Fehler werden verworfen und in eine Datei geschrieben.', {info: true, label: 'Hilfe zur Anomalieerkennung'}],
  ['.chart-head h2', 'Verlauf der Messwerte. Fahre mit der Maus über das Diagramm, um den Wert zu jedem Zeitpunkt zu sehen.', {info: true, label: 'Hilfe zum Messverlauf'}],
];

function attach(root) {
  for (const [selector, hint, options = {}] of HINTS) {
    for (const el of root.querySelectorAll(selector)) {
      const text = typeof hint === 'function' ? hint(el) : hint;
      if (options.info) {
        if (el.nextElementSibling?.classList.contains('tip-btn')) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tip-btn';
        button.textContent = 'i';
        button.setAttribute('aria-label', translateText(options.label || 'Mehr Informationen'));
        button.dataset.i18nSkip = '';
        button.dataset.hint = text;
        el.after(button);
      } else if (el.dataset.hint !== text) {
        el.dataset.hint = text;
      }
    }
  }
}

let tip, current, showTimer, hideTimer;
const ensureTip = () => {
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'hint-tip';
    tip.className = 'hint-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    tip.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    tip.addEventListener('pointerleave', hide);
    document.body.append(tip);
  }
  return tip;
};

function place(target) {
  const box = target.getBoundingClientRect();
  const t = ensureTip();
  const margin = 8;
  const width = t.offsetWidth, height = t.offsetHeight;
  let left = box.left + box.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, innerWidth - width - margin));
  let top = box.bottom + 8;
  if (top + height > innerHeight - margin) top = Math.max(margin, box.top - height - 8);
  t.style.left = `${Math.round(left)}px`;
  t.style.top = `${Math.round(top)}px`;
}

function show(target, delay) {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  showTimer = setTimeout(() => {
    if (!target.isConnected) return;
    const text = translateText(target.dataset.hint || '');
    if (!text) return;
    hide();
    const t = ensureTip();
    t.textContent = text;
    t.hidden = false;
    place(target);
    target.setAttribute('aria-describedby', 'hint-tip');
    current = target;
  }, delay);
}

function hide() {
  clearTimeout(showTimer);
  if (current) {
    current.removeAttribute('aria-describedby');
    current = null;
  }
  if (tip) tip.hidden = true;
}

const hinted = event => event.target instanceof Element ? event.target.closest('[data-hint]') : null;

let announcer;
export function announce(message) {
  if (!announcer) {
    announcer = document.createElement('div');
    announcer.className = 'sr-only';
    announcer.setAttribute('role', 'status');
    announcer.setAttribute('aria-live', 'polite');
    document.body.append(announcer);
  }
  const text = translateText(message);
  announcer.textContent = '';
  setTimeout(() => { announcer.textContent = text; }, 60);   // a changed node is announced even when the text repeats
}

export function installHints(root = document.getElementById('app')) {
  if (!root || root.dataset.hints) return;
  root.dataset.hints = '1';
  let queued = false;
  const run = () => { queued = false; attach(root); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
    .observe(root, {childList: true, subtree: true});
  attach(root);

  document.addEventListener('pointerover', event => {
    const target = hinted(event);
    if (target && event.pointerType === 'mouse') show(target, 450);
  });
  document.addEventListener('pointerout', event => {
    const target = hinted(event);
    if (target && event.pointerType === 'mouse' && !target.contains(event.relatedTarget)) {
      clearTimeout(showTimer);
      hideTimer = setTimeout(hide, 150);   // long enough to move onto the tooltip itself
    }
  });
  document.addEventListener('focusin', event => {
    const target = hinted(event);
    if (target && target.matches(':focus-visible')) show(target, 0);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('click', event => {
    const target = hinted(event);
    if (target?.classList.contains('tip-btn')) {
      if (current === target) hide(); else show(target, 0);   // touch and mouse: tap the "i" to open or close
    } else if (!event.target.closest?.('#hint-tip')) hide();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && tip && !tip.hidden) {
      hide();
      event.stopPropagation();   // close only the hint, not a dialog behind it
    }
  }, true);
  addEventListener('scroll', hide, {passive: true, capture: true});
  addEventListener('resize', hide);
}
