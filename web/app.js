const $ = (id) => document.getElementById(id);
const DOWN = 'API unavailable: the cluster is healing';

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function loadList() {
  const rows = await api(`/api/clinics/${encodeURIComponent($('clinic').value)}/appointments`);
  $('list').replaceChildren(...rows.map((a) => {
    const li = document.createElement('li');
    li.textContent = `${new Date(a.at).toLocaleString()} · ${a.patient}${a.reminded ? ' · reminded' : ''}`;
    return li;
  }));
}

async function loadClinics() {
  const clinics = await api('/api/clinics');
  $('clinic').replaceChildren(...clinics.map((c) => new Option(c.name, c.slug)));
  await loadList();
}

async function whoami() {
  try {
    const w = await api('/api/whoami');
    $('pod').textContent = `Served by ${w.pod} · ${w.version}`;
    if ($('clinic').options.length === 0) await loadClinics(); // page opened mid-outage: recover once the API is back
  } catch {
    $('pod').textContent = DOWN;
  }
}

$('clinic').addEventListener('change', () => loadList().catch(() => { $('pod').textContent = DOWN; }));
$('book').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/clinics/${encodeURIComponent($('clinic').value)}/appointments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patient: $('patient').value, at: new Date($('at').value).toISOString() }),
    });
    $('patient').value = '';
    await loadList();
  } catch {
    $('pod').textContent = DOWN;
  }
});

loadClinics().catch(() => { $('pod').textContent = DOWN; });
whoami();
setInterval(whoami, 2000);
