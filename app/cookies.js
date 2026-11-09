function parseCookies(text) {
  if (!/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)/.test(text)) throw new Error('Use um arquivo cookies.txt no formato Netscape.');
  const cookies = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw || (raw.startsWith('#') && !raw.startsWith('#HttpOnly_'))) continue;
    const httpOnly = raw.startsWith('#HttpOnly_');
    const fields = (httpOnly ? raw.slice(10) : raw).split('\t');
    if (fields.length !== 7) throw new Error('O arquivo de cookies é inválido.');
    const [domain, includeSubdomains, path, secure, expiry, name, value] = fields;
    if (!/^\.?youtube\.com$/i.test(domain)) continue;
    if (!['TRUE', 'FALSE'].includes(includeSubdomains) || !['TRUE', 'FALSE'].includes(secure) || !path.startsWith('/') || !/^\d+$/.test(expiry) || !name) throw new Error('O arquivo de cookies é inválido.');
    cookies.push({ domain, path, name, value, secure: secure === 'TRUE', httpOnly, expires: Number(expiry) || -1 });
  }
  if (!cookies.length) throw new Error('O arquivo não contém cookies do YouTube.');
  return cookies;
}
module.exports = { parseCookies };
