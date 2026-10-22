import { REPORTING_GROUPS, STARTER_CATEGORIES } from '../../shared/categories';
import { normalizeSearch } from '../../shared/search';

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
  {
    version: 3,
    name: 'expenses-categories-vendors',
    sql: `
      CREATE TABLE category (
        id              INTEGER PRIMARY KEY,
        company_id      INTEGER NOT NULL REFERENCES company(id),
        name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        name_key        TEXT NOT NULL,
        reporting_group TEXT NOT NULL CHECK (reporting_group IN (${REPORTING_GROUPS.map((g) => `'${g}'`).join(', ')})),
        is_archived     INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        UNIQUE (company_id, name_key)
      ) STRICT;

      CREATE TABLE vendor (
        id         INTEGER PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES company(id),
        name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
        name_key   TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (company_id, name_key)
      ) STRICT;

      CREATE TABLE expense (
        id              INTEGER PRIMARY KEY,
        company_id      INTEGER NOT NULL REFERENCES company(id),
        property_id     INTEGER REFERENCES property(id),
        vendor_id       INTEGER NOT NULL REFERENCES vendor(id),
        expense_date    TEXT NOT NULL CHECK (expense_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        total_cents     INTEGER NOT NULL CHECK (total_cents > 0),
        notes           TEXT,
        status          TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'voided')),
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        voided_at       TEXT,
        CHECK ((status = 'voided') = (voided_at IS NOT NULL))
      ) STRICT;
      CREATE INDEX expense_company_date ON expense (company_id, expense_date);
      CREATE INDEX expense_property_date ON expense (property_id, expense_date);
      CREATE INDEX expense_vendor ON expense (vendor_id);

      CREATE TABLE expense_allocation (
        id           INTEGER PRIMARY KEY,
        expense_id   INTEGER NOT NULL REFERENCES expense(id),
        category_id  INTEGER NOT NULL REFERENCES category(id),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        UNIQUE (expense_id, category_id)
      ) STRICT;
      CREATE INDEX allocation_category ON expense_allocation (category_id);

      CREATE TABLE expense_attachment (
        id            INTEGER PRIMARY KEY,
        expense_id    INTEGER NOT NULL REFERENCES expense(id),
        original_name TEXT NOT NULL,
        stored_name   TEXT NOT NULL UNIQUE,
        sha256        TEXT NOT NULL,
        size_bytes    INTEGER NOT NULL,
        mime          TEXT NOT NULL,
        created_at    TEXT NOT NULL
      ) STRICT;
      CREATE INDEX attachment_expense ON expense_attachment (expense_id);

      CREATE TABLE expense_event (
        id         INTEGER PRIMARY KEY,
        expense_id INTEGER NOT NULL REFERENCES expense(id),
        type       TEXT NOT NULL CHECK (type IN ('created', 'edited', 'voided', 'unvoided')),
        detail     TEXT NOT NULL,
        at         TEXT NOT NULL
      ) STRICT;
      CREATE INDEX event_expense ON expense_event (expense_id);

      -- Ownership rules enforced in storage, not only in the UI.
      CREATE TRIGGER expense_insert_checks BEFORE INSERT ON expense
      BEGIN
        SELECT RAISE(ABORT, 'company is archived') WHERE (SELECT is_archived FROM company WHERE id = NEW.company_id) = 1;
        SELECT RAISE(ABORT, 'property belongs to a different company')
          WHERE NEW.property_id IS NOT NULL AND (SELECT company_id FROM property WHERE id = NEW.property_id) IS NOT NEW.company_id;
        SELECT RAISE(ABORT, 'property is archived')
          WHERE NEW.property_id IS NOT NULL AND (SELECT is_archived FROM property WHERE id = NEW.property_id) = 1;
        SELECT RAISE(ABORT, 'vendor belongs to a different company') WHERE (SELECT company_id FROM vendor WHERE id = NEW.vendor_id) IS NOT NEW.company_id;
      END;
      CREATE TRIGGER expense_update_checks BEFORE UPDATE ON expense
      BEGIN
        SELECT RAISE(ABORT, 'expense company cannot be changed') WHERE NEW.company_id <> OLD.company_id;
        SELECT RAISE(ABORT, 'property belongs to a different company')
          WHERE NEW.property_id IS NOT NULL AND (SELECT company_id FROM property WHERE id = NEW.property_id) IS NOT NEW.company_id;
        SELECT RAISE(ABORT, 'vendor belongs to a different company') WHERE (SELECT company_id FROM vendor WHERE id = NEW.vendor_id) IS NOT NEW.company_id;
      END;
      CREATE TRIGGER expense_no_delete BEFORE DELETE ON expense
      BEGIN
        SELECT RAISE(ABORT, 'expenses are voided, never deleted');
      END;
      CREATE TRIGGER allocation_company_check BEFORE INSERT ON expense_allocation
      BEGIN
        SELECT RAISE(ABORT, 'category belongs to a different company')
          WHERE (SELECT company_id FROM category WHERE id = NEW.category_id) IS NOT (SELECT company_id FROM expense WHERE id = NEW.expense_id);
      END;
      CREATE TRIGGER allocation_company_check_update BEFORE UPDATE ON expense_allocation
      BEGIN
        SELECT RAISE(ABORT, 'category belongs to a different company')
          WHERE (SELECT company_id FROM category WHERE id = NEW.category_id) IS NOT (SELECT company_id FROM expense WHERE id = NEW.expense_id);
      END;

      -- Every existing company gets the starter categories.
      ${STARTER_CATEGORIES.map(
        (c, i) => `INSERT INTO category (company_id, name, name_key, reporting_group, sort_order, created_at, updated_at)
        SELECT id, '${c.name.replace(/'/g, "''")}', '${normalizeSearch(c.name)}', '${c.group}', ${i}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM company;`,
      ).join('\n      ')}
    `,
  },
];
