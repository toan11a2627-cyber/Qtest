import '../config.js';
import * as scriptMethods from '../script.js';

if (typeof window !== 'undefined') {
  Object.assign(window, scriptMethods);
  if (scriptMethods.navigate) {
    window.navigate = scriptMethods.navigate;
    window._fullNavigate = scriptMethods.navigate;
  }
}

console.log('[MathExam Pro] app.js initialized with Firebase backend qtest-ac4d3');

