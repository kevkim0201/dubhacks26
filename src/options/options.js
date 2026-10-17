import { getSettings, setSettings } from '../lib/storage.js';

const fields = ['enabled', 'highlightColor'];
const status = document.getElementById('status');

init();

async function init() {
  const settings = await getSettings();

  for (const name of fields) {
    const el = document.getElementById(name);
    if (el.type === 'checkbox') el.checked = settings[name];
    else el.value = settings[name];

    el.addEventListener('change', async () => {
      const value = el.type === 'checkbox' ? el.checked : el.value;
      await setSettings({ [name]: value });
      flash('Saved.');
    });
  }
}

let timer;
function flash(text) {
  status.textContent = text;
  clearTimeout(timer);
  timer = setTimeout(() => { status.textContent = ''; }, 1500);
}
