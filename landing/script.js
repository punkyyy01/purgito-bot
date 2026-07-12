'use strict';

/* Ticker del hero: frases cortas que parodian a un bot de Markov de primer
   orden entrenado en chat de Discord. Tipeo + glitch corto, vainilla, sin
   librerías. Respeta prefers-reduced-motion (cambio directo, sin animación). */

(function () {
  var PHRASES = [
    'no cacho ni lo que estoy diciendo pero igual',
    'alguien vio el mensaje como de recién que decía',
    'esto claramente no era lo que iba a',
    'ya po pero quién fue el que mandó el',
    'el meme estaba bueno hasta que después nadie',
    'creo que me perdí como en la parte tres del',
    'según lo que leí esto no tiene mucho',
    'espera espera eso lo dije yo o fue el otro',
    'básicamente sí pero también depende de si',
    'el gif que subieron ayer todavía me da un poco de',
    'no me acuerdo de qué hablábamos pero era importante',
    'confirmo que esto es real aunque no estoy tan',
    'la música se cortó justo cuando venía la mejor',
    'leí demasiados mensajes y ahora solo pienso en',
    'posiblemente tengan razón o posiblemente yo esté',
    'wena la idea igual pero cómo se supone que uno',
    'juraría que ese comando existía o quizás lo soñé',
    'al final terminamos hablando de cualquier cosa menos del'
  ];

  var textEl = document.getElementById('ticker-text');
  if (!textEl) return;

  var TYPE_MS = 45;    // ms por caracter tipeado
  var HOLD_MS = 2800;  // pausa con la frase completa en pantalla
  var GLITCH_MS = 240; // duración del glitch al cambiar de frase

  var i = 0;
  function pickNext() {
    var p = PHRASES[i % PHRASES.length];
    i++;
    return p;
  }

  // Sin animación: cambio directo, con un respiro proporcional al largo.
  function runStatic() {
    textEl.textContent = pickNext();
    setTimeout(runStatic, HOLD_MS + 1200);
  }

  function typePhrase(phrase, pos) {
    if (pos > phrase.length) {
      setTimeout(swapOut, HOLD_MS);
      return;
    }
    textEl.textContent = phrase.slice(0, pos);
    setTimeout(function () { typePhrase(phrase, pos + 1); }, TYPE_MS);
  }

  function swapOut() {
    textEl.classList.add('glitch');
    setTimeout(function () {
      textEl.classList.remove('glitch');
      textEl.textContent = '';
      typePhrase(pickNext(), 0);
    }, GLITCH_MS);
  }

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    runStatic();
  } else {
    typePhrase(pickNext(), 0);
  }
})();
