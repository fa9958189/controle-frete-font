// ================== CONFIG ==================
const BASE_URL = "http://localhost:3001"; // troque pelo seu domínio quando hospedar

// ================== ESTADO ==================
let registros = []; // viagens exibidas
let chart;

// ================== UTILITÁRIAS ==================
function toNumber(txt = "") {
  const n = String(txt).replace(/\./g, '').replace(',', '.').match(/[\d.]+/g);
  return n ? parseFloat(n.join('')) : 0;
}

// ================== DOM ELEMENTS ==================
const placaSelect = document.getElementById("placaSelect");
const viagemSelect = document.getElementById("viagemSelect");
const statusInfo = document.getElementById("statusInfo");

// ================== API HELPERS ==================
async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) throw new Error(`Erro API ${path}: ${res.status}`);
  return res.json();
}

async function importarArquivos(files) {
  const fd = new FormData();
  [...files].forEach(f => fd.append("files", f));
  return api("/api/import", { method: "POST", body: fd });
}

async function getTrips(placa = "") {
  if (placa) {
    return api(`/api/trips?placa=${encodeURIComponent(placa)}`);
  }
  return api("/api/trips");
}

async function getSummary() {
  return api("/api/summary");
}

async function deleteTrip(id) {
  return api(`/api/trips/${id}`, { method: "DELETE" });
}

async function deleteAll() {
  return api("/api/all", { method: "DELETE" });
}

// ================== RENDER ==================
function renderTabelaCom(data) {
  const tbody = document.querySelector("#tabela tbody");
  tbody.innerHTML = "";
  for (const r of data) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.placa}</td>
      <td>${r.dispositivo || "—"}</td>
      <td>${Number(r.kmPercurso || 0).toFixed(2)} km</td>
      <td>${(r.inicio || "—")} → ${(r.fim || "—")}</td>
      <td>${Number(r.kmPercurso || 0).toFixed(2)} km</td> <!-- KM rodado por viagem -->
      <td>Viagem ${r.numero || "—"}</td>
    `;
    // Anexa ID interno pra exclusão
    tr.dataset.tripId = r.id;
    tbody.appendChild(tr);
  }
}

function renderGraficoCom(data) {
  const porPlaca = {};
  for (const r of data) {
    porPlaca[r.placa] = (porPlaca[r.placa] || 0) + (r.kmPercurso || 0);
  }
  const labels = Object.keys(porPlaca);
  const values = Object.values(porPlaca).map(v => Number(v.toFixed(2)));

  const ctx = document.getElementById("kmChart");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "KM rodado", data: values }] },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

function popularSelectsCom(data) {
  // Placas distintas
  const placas = [...new Set(data.map(d => d.placa))];
  placaSelect.innerHTML = "";
  if (!placas.length) {
    placaSelect.innerHTML = `<option value="">—</option>`;
    viagemSelect.innerHTML = `<option value="">—</option>`;
    return;
  }
  placas.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    placaSelect.appendChild(opt);
  });

  // Viagens da primeira placa por padrão
  preencherViagensParaPlaca(placas[0], data);
}

function preencherViagensParaPlaca(placa, data) {
  const viagens = data
    .filter(d => d.placa === placa)
    .sort((a, b) => a.numero - b.numero);

  viagemSelect.innerHTML = "";
  viagens.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = String(v.id); // guardo o ID real aqui pra exclusão
    opt.textContent = `Viagem ${v.numero}`;
    viagemSelect.appendChild(opt);
  });
}

// ================== DASHBOARD MASTER ==================
async function atualizarDashboard(placasDoUltimoRelatorio = null) {
  // 1) Carrega TODAS as trips
  const trips = await getTrips();

  // Gera numeração por placa
  const map = {};
  trips.forEach(t => {
    map[t.placa] = map[t.placa] || 0;
    map[t.placa]++;
    t.numero = map[t.placa];
  });

  registros = trips;
  renderTabelaCom(registros);
  renderGraficoCom(registros);
  popularSelectsCom(registros);

  // Cards
  if (placasDoUltimoRelatorio?.length) {
    document.getElementById("totalPlacas").textContent = String(placasDoUltimoRelatorio.length);
    const totalKm = registros.reduce((s, r) => s + (r.kmPercurso || 0), 0);
    document.getElementById("totalKm").textContent = `${totalKm.toFixed(2)} km`;
  } else {
    const sum = await getSummary();
    document.getElementById("totalPlacas").textContent = String(sum.totalPlacas);
    document.getElementById("totalKm").textContent = `${Number(sum.totalKm).toFixed(2)} km`;
  }

  const ultimoComOdo = [...registros].reverse().find(r => r.odometro);
  document.getElementById("odometro").textContent = ultimoComOdo
    ? Number(ultimoComOdo.odometro).toLocaleString('pt-BR')
    : "—";

  // Status
  const temDados = registros.length > 0;
  statusInfo.textContent = temDados
    ? "Selecione Placa e Viagem para carregar ou excluir. Você também pode importar novos relatórios."
    : "Nenhuma viagem salva ainda.";
}

// ================== EVENTOS ==================
document.getElementById("fileInput").addEventListener("change", async (ev) => {
  const files = ev.target.files;
  if (!files.length) return;

  try {
    const resp = await importarArquivos(files);
    // resp.placasDoLote = placas únicas do relatório recém-importado
    await atualizarDashboard(resp.placasDoLote || null);
  } catch (e) {
    console.error(e);
    statusInfo.textContent = "Falha ao importar arquivo. Verifique o formato.";
  } finally {
    ev.target.value = ""; // limpa input
  }
});

// Quando a placa mudar, recarrega select de viagens daquela placa
placaSelect?.addEventListener("change", () => {
  preencherViagensParaPlaca(placaSelect.value, registros);
});

// Botão: Carregar viagem (apenas visual: filtra a tela)
document.getElementById("btnCarregar")?.addEventListener("click", () => {
  const id = Number(viagemSelect.value);
  if (!id) { statusInfo.textContent = "Selecione uma viagem válida."; return; }
  const v = registros.find(x => x.id === id);
  if (!v) { statusInfo.textContent = "Viagem não encontrada."; return; }

  renderTabelaCom([{ ...v }]);
  renderGraficoCom([{ ...v }]);
  document.getElementById("totalKm").textContent = `${Number(v.kmPercurso || 0).toFixed(2)} km`;
  document.getElementById("totalPlacas").textContent = "1";
  document.getElementById("odometro").textContent = v.odometro
    ? Number(v.odometro).toLocaleString('pt-BR')
    : "—";

  statusInfo.textContent = `Exibindo ${v.placa} – Viagem ${v.numero}.`;
});

// Botão: Excluir viagem (deleta no banco via ID real)
document.getElementById("btnExcluir")?.addEventListener("click", async () => {
  const id = Number(viagemSelect.value);
  if (!id) { statusInfo.textContent = "Selecione uma viagem para excluir."; return; }
  await deleteTrip(id);
  statusInfo.textContent = "Viagem excluída.";
  await atualizarDashboard();
});

// Botão: Limpar TUDO
document.getElementById("btnLimpar")?.addEventListener("click", async () => {
  if (!confirm("Tem certeza que deseja apagar TUDO?")) return;
  await deleteAll();
  statusInfo.textContent = "Histórico totalmente limpo.";
  await atualizarDashboard();
});

// ================== BOOT ==================
atualizarDashboard().catch(err => {
  console.error(err);
  statusInfo.textContent = "Erro ao carregar dados da API.";
});
