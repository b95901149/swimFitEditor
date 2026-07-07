// build.js — assemble a self-contained index.html from template + engine + ui.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const tpl = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
const core = fs.readFileSync(path.join(dir, 'fit_core.js'), 'utf8');
const ui = fs.readFileSync(path.join(dir, 'ui.js'), 'utf8');

if (core.includes('</script>') || ui.includes('</script>')) {
  throw new Error('source contains </script>; would break inlining');
}
let out = tpl.replace('/* __FIT_CORE__ */', () => core).replace('/* __UI__ */', () => ui);
fs.writeFileSync(path.join(dir, 'index.html'), out);
console.log('built index.html (' + out.length + ' bytes)');
