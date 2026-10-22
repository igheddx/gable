/** Forward-only migrations. Each runs in its own transaction. Never edit a shipped one. */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'foundation',
    sql: `
      CREATE TABLE setting (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: 'companies-and-properties',
    sql: `
      CREATE TABLE company (
        id           INTEGER PRIMARY KEY,
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
        name_key     TEXT NOT NULL UNIQUE,
        legal_name   TEXT,
        address      TEXT,
        phone        TEXT,
        email        TEXT,
        logo_file    TEXT,
        is_archived  INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      ) STRICT;

      CREATE TABLE property (
        id                   INTEGER PRIMARY KEY,
        company_id           INTEGER NOT NULL REFERENCES company(id),
        address1             TEXT NOT NULL CHECK (length(address1) > 0),
        address2             TEXT,
        city                 TEXT NOT NULL CHECK (length(city) > 0),
        state                TEXT NOT NULL CHECK (length(state) = 2),
        zip                  TEXT NOT NULL CHECK (length(zip) > 0),
        search_text          TEXT NOT NULL,
        purchase_date        TEXT NOT NULL CHECK (purchase_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        purchase_price_cents INTEGER NOT NULL CHECK (purchase_price_cents >= 0),
        status               TEXT NOT NULL CHECK (status IN ('Held', 'Renovating', 'Listed', 'Sold')),
        sale_date            TEXT CHECK (sale_date IS NULL OR sale_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        sale_price_cents     INTEGER CHECK (sale_price_cents IS NULL OR sale_price_cents >= 0),
        description          TEXT,
        notes                TEXT,
        is_archived          INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL,
        -- Sold requires a sale; anything else must have no sale. Sale cannot precede purchase.
        CHECK ((status = 'Sold') = (sale_date IS NOT NULL AND sale_price_cents IS NOT NULL)),
        CHECK ((sale_date IS NULL) = (sale_price_cents IS NULL)),
        CHECK (sale_date IS NULL OR sale_date >= purchase_date)
      ) STRICT;

      CREATE INDEX property_company_status ON property (company_id, status);
      CREATE INDEX property_company_purchase ON property (company_id, purchase_date);
      CREATE INDEX property_company_sale ON property (company_id, sale_date);
      CREATE INDEX property_archived ON property (is_archived);

      -- A property belongs to one company for life (v1): the company can never be changed.
      CREATE TRIGGER property_company_immutable
      BEFORE UPDATE OF company_id ON property
      WHEN NEW.company_id <> OLD.company_id
      BEGIN
        SELECT RAISE(ABORT, 'property company cannot be changed');
      END;

      -- No new properties under an archived company, enforced in storage.
      CREATE TRIGGER property_company_active_insert
      BEFORE INSERT ON property
      WHEN (SELECT is_archived FROM company WHERE id = NEW.company_id) = 1
      BEGIN
        SELECT RAISE(ABORT, 'company is archived');
      END;
    `,
  },
];
