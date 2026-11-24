const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");

const exportFormat = "ps5ceviri-interchange";
const fields = "id,game,lang,source,translated,engine,created,version,context,curated";
const validGame = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
const bounded = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

class Archive {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.revision = 0;
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      INSERT OR IGNORE INTO games VALUES ('general','Genel arşiv');
      CREATE TABLE IF NOT EXISTS records(
        id INTEGER PRIMARY KEY, game TEXT NOT NULL REFERENCES games(id), lang TEXT NOT NULL,
        source TEXT NOT NULL, normalized TEXT NOT NULL, translated TEXT NOT NULL, engine TEXT NOT NULL,
        created INTEGER NOT NULL, version TEXT NOT NULL, context TEXT, curated INTEGER NOT NULL DEFAULT 0,
        UNIQUE(game, lang, normalized, engine, version)
      );
      CREATE INDEX IF NOT EXISTS records_game_recent ON records(game, id DESC);
      CREATE INDEX IF NOT EXISTS records_lookup ON records(game, lang, normalized, curated DESC, id DESC);
      CREATE TABLE IF NOT EXISTS usage(period TEXT PRIMARY KEY, chars INTEGER NOT NULL, requests INTEGER NOT NULL);
    `);
    this.insert = this.db.prepare(`INSERT OR IGNORE INTO records
      (game,lang,source,normalized,translated,engine,created,version,context,curated) VALUES (?, 'en', ?, ?, ?, ?, ?, ?, ?, ?)`);
  }

  transaction(action) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  lookup(key, policy) {
    const games = policy.generalArchive && key.gameId !== "general" ? [key.gameId, "general"] : [key.gameId];
    const filter = policy.shareEngines ? "" : " AND (engine=? OR engine='package')";
    const query = this.db.prepare(`SELECT translated FROM records WHERE game=? AND lang='en'
      AND normalized=? AND (curated=1 OR version=?)${filter}
      ORDER BY curated DESC, engine=? DESC, id DESC LIMIT 1`);
    for (const game of games) {
      const result = query.get(game, key.normalized, key.version, ...(policy.shareEngines ? [] : [key.engine]), key.engine);
      if (result) return result.translated;
    }
    return null;
  }

  store(key, translated) {
    this.insert.run(key.gameId, key.source, key.normalized, translated, key.engine, Date.now(), key.version, null, 0);
  }

  games() {
    return this.db.prepare(`SELECT g.id,g.name,(SELECT COUNT(*) FROM records r WHERE r.game=g.id) AS count
      FROM games g ORDER BY g.id!='general', g.name COLLATE NOCASE`).all();
  }

  createGame(name) {
    if (!bounded(name, 100)) throw new Error("Oyun adı 1–100 karakter olmalıdır.");
    const id = randomUUID();
    this.db.prepare("INSERT INTO games VALUES(?, ?)").run(id, name.trim());
    return id;
  }

  records(game, search, before) {
    if (!validGame(game) || typeof search !== "string") throw new Error("Geçersiz arşiv sorgusu.");
    const needle = "%" + search.slice(0, 120).replace(/[\\%_]/g, "\\$&") + "%";
    return this.db.prepare(`SELECT ${fields} FROM records WHERE game=? AND id<?
      AND (source LIKE ? ESCAPE '\\' OR translated LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT 50`)
      .all(game, Number.isSafeInteger(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER, needle, needle);
  }

  edit(id, text) {
    if (!Number.isSafeInteger(id) || !bounded(text, 1200)) throw new Error("Çeviri 1–1200 karakter olmalıdır.");
    if (this.db.prepare("UPDATE records SET translated=?, curated=1 WHERE id=?").run(text.trim(), id).changes !== 1) {
      throw new Error("Arşiv kaydı bulunamadı.");
    }
    this.revision++;
  }

  delete(id) {
    if (!Number.isSafeInteger(id)) throw new Error("Geçersiz kayıt.");
    this.db.prepare("DELETE FROM records WHERE id=?").run(id);
    this.revision++;
  }

  reserve(engine, count, daily, monthly) {
    const date = new Date().toISOString().slice(0, 10);
    const day = engine + ":" + date;
    const month = day.slice(0, -3);
    this.transaction(() => {
      const get = this.db.prepare("SELECT chars FROM usage WHERE period=?");
      if ((get.get(day)?.chars ?? 0) + count > daily || (get.get(month)?.chars ?? 0) + count > monthly) {
        throw new Error("Yerel günlük veya aylık API karakter sınırına ulaşıldı.");
      }
      const update = this.db.prepare(`INSERT INTO usage VALUES(?,?,1) ON CONFLICT(period)
        DO UPDATE SET chars=chars+excluded.chars, requests=requests+1`);
      update.run(day, count);
      update.run(month, count);
    });
  }

  usage(engine) {
    const day = engine + ":" + new Date().toISOString().slice(0, 10);
    const get = this.db.prepare("SELECT chars,requests FROM usage WHERE period=?");
    return { daily: get.get(day) ?? { chars: 0, requests: 0 }, monthly: get.get(day.slice(0, -3)) ?? { chars: 0, requests: 0 } };
  }

  export(game) {
    const args = game ? [game] : [];
    const games = this.db.prepare("SELECT id,name FROM games" + (game ? " WHERE id=?" : "")).all(...args);
    const records = this.db.prepare(`SELECT ${fields} FROM records` + (game ? " WHERE game=?" : "") + " ORDER BY id").all(...args)
      .map(({ id, ...item }) => ({ ...item, curated: !!item.curated }));
    return { format: exportFormat, version: 1, games, records };
  }

  async import(data, v3) {
    if (data?.format !== exportFormat || data.version !== 1 || !Array.isArray(data.games) || !Array.isArray(data.records)
      || data.games.length > 10000 || data.records.length > 100000) throw new Error("Arşiv biçimi desteklenmiyor.");
    const games = new Set();
    for (const game of data.games) {
      if (!validGame(game?.id) || !bounded(game.name, 100) || games.has(game.id)) throw new Error("Arşivde geçersiz oyun bilgisi.");
      games.add(game.id);
    }
    const normalized = [];
    for (let start = 0; start < data.records.length; start += 500) {
      const values = data.records.slice(start, start + 500).map((row) => {
        if (!games.has(row?.game) || row.lang !== "en" || !bounded(row.source, 1200) || !bounded(row.translated, 1200)
          || !bounded(row.version, 100) || !["offline", "google_cloud", "ai", "package"].includes(row.engine)
          || !Number.isSafeInteger(row.created)) throw new Error("Arşivde geçersiz çeviri kaydı.");
        return row.source.trim();
      });
      normalized.push(...await v3.call("normalize", { values }));
    }
    return this.transaction(() => {
      const addGame = this.db.prepare("INSERT OR IGNORE INTO games VALUES(?, ?)");
      for (const game of data.games) addGame.run(game.id, game.name.trim());
      let added = 0;
      for (const [index, row] of data.records.entries()) {
        added += this.insert.run(row.game, row.source.trim(), normalized[index], row.translated.trim(), row.engine,
          row.created, row.version, typeof row.context === "string" ? row.context.slice(0, 1000) : null,
          row.curated === true || row.engine === "package" ? 1 : 0).changes;
      }
      this.revision++;
      return { added, skipped: data.records.length - added };
    });
  }
}

module.exports = { Archive };
