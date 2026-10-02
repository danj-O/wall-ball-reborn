// The controller bundle never imports the arena, Three.js, or game simulation.
if (new URLSearchParams(location.search).get('controller') === '1') void import('./remote/controllerMain.ts');
else void import('./main.ts');
