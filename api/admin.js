import { adminConfigured, checkPassword, clearCookie, isAdmin, readJson, registerFail, sessionCookie, tooManyFails } from '../lib/auth.js';
import { readStats } from '../lib/stats.js';
import { listArchive } from '../lib/archive.js';
import { addAviso, readMudancasLog, readRegistros, removeAviso, saveRegistro } from '../lib/registro.js';
import { REPORT_MIN, approveReport, dropReport, listReports } from '../lib/reports.js';

// /api/admin?action=login|logout|stats|session|menus|registro|aviso|reports|report
export default async function handler(req, res) {
  const action = new URL(req.url, 'http://x').searchParams.get('action') || 'stats';

  if (action === 'session') {
    res.status(200).json({ configured: adminConfigured(), authed: isAdmin(req) });
    return;
  }

  if (action === 'login') {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    if (!adminConfigured()) { res.status(503).json({ error: 'ADMIN_PASSWORD não configurada no servidor.' }); return; }
    if (await tooManyFails(req)) { res.status(429).json({ error: 'Muitas tentativas. Espere alguns minutos.' }); return; }
    const { password } = await readJson(req).catch(() => ({}));
    if (!checkPassword(password)) {
      await registerFail(req);
      res.status(401).json({ error: 'Senha incorreta.' });
      return;
    }
    res.setHeader('Set-Cookie', sessionCookie());
    res.status(200).json({ ok: true });
    return;
  }

  if (action === 'logout') {
    res.setHeader('Set-Cookie', clearCookie());
    res.status(200).json({ ok: true });
    return;
  }

  // daqui pra baixo exige sessão
  if (!isAdmin(req)) { res.status(401).json({ error: 'não autenticado' }); return; }

  if (action === 'menus') {
    try {
      const archive = await listArchive();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="bandecos-${new Date().toISOString().slice(0, 10)}.json"`);
      res.status(200).end(JSON.stringify({ geradoEm: new Date().toISOString(), total: archive.length, cardapios: archive }, null, 2));
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) });
    }
    return;
  }

  // registro da refeição (sabor do suco, saladas): GET lê os do restaurante, POST grava
  if (action === 'registro') {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method === 'POST') {
        const registro = await saveRegistro(await readJson(req));
        res.status(200).json({ ok: true, registro });
      } else {
        res.status(200).json({ registros: await readRegistros(new URL(req.url, 'http://x').searchParams.get('id') || '2') });
      }
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) });
    }
    return;
  }

  // aviso de prato que mudou, marcado direto pelo admin: { acao: 'marcar' | 'remover', restaurant, date, meal, grupo, item, novo, motivo }
  // reports: GET lista os reports em aberto e as últimas mudanças da USP; POST { acao: 'aprovar' | 'descartar', field, novo, motivo }
  if (action === 'aviso' || action === 'reports' || action === 'report') {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (action === 'reports') {
        const [reports, mudancas] = await Promise.all([listReports(), readMudancasLog()]);
        res.status(200).json({ reports, minimo: REPORT_MIN, mudancas });
        return;
      }
      if (req.method !== 'POST') { res.status(405).end(); return; }
      const body = await readJson(req);
      let registro = null;
      if (action === 'aviso') registro = body.acao === 'remover' ? await removeAviso(body) : await addAviso({ ...body, tipo: 'admin' });
      else if (body.acao === 'aprovar') registro = await approveReport(body);
      else if (body.acao === 'descartar') await dropReport(body.field);
      else throw new Error('ação inválida');
      res.status(200).json({ ok: true, registro });
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) });
    }
    return;
  }

  try {
    const days = Math.min(90, Math.max(7, Number(new URL(req.url, 'http://x').searchParams.get('days')) || 30));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(await readStats(days));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
